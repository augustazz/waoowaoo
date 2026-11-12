#!/bin/sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  npm run temporal:worker:rollout -- status
  npm run temporal:worker:rollout -- bootstrap blue|green
  npm run temporal:worker:rollout -- promote blue|green
  npm run temporal:worker:rollout -- retire blue|green

Only for the bundled Compose Temporal at temporal:7233 via temporal-admin.
For remote Temporal / Temporal Cloud, manage versions with an authenticated
Temporal CLI connected to that server (see MULTI_DEVICE_SETUP.zh-CN.md).

bootstrap is the only supported way to activate the first explicitly profiled
Worker when a Deployment has no Current Version.

promote first proves that the selected slot is not the Current Version, then
starts only that candidate, waits until Temporal sees its pollers, and makes its
immutable build the Current Version. It then migrates legacy pinned continuous
Schedulers to AutoUpgrade. It never stops the previous slot.

retire refuses the Current Version and any version whose Temporal drainage
status is not "drained".
EOF
  exit 2
}

command_name=${1:-}
slot=${2:-}

case "$command_name" in
  status) ;;
  bootstrap|promote|retire)
    case "$slot" in
      blue|green) ;;
      *) usage ;;
    esac
    ;;
  *) usage ;;
esac

if [ "$command_name" != status ]; then
  if ! command -v flock >/dev/null 2>&1; then
    echo "Temporal Worker rollout requires flock to serialize deployment mutations" >&2
    exit 1
  fi
  rollout_lock=${TEMPORAL_WORKER_ROLLOUT_LOCK:-/tmp/waoowaoo-temporal-worker-rollout.lock}
  exec 9>"$rollout_lock"
  if ! flock -n 9; then
    echo "Another Temporal Worker rollout is already running" >&2
    exit 1
  fi
fi

compose() {
  docker compose --profile temporal-worker-rollout "$@"
}

temporal_cli() {
  compose --profile temporal-ops run --rm --no-deps temporal-admin \
    "$@" \
    --namespace "$namespace" \
    --address temporal:7233
}

legacy_pinned_scheduler_query='ExecutionStatus="Running" AND WorkflowType="userTaskSchedulerWorkflow" AND TemporalWorkflowVersioningBehavior="Pinned"'

workflow_list_json() {
  workflow_query=$1
  workflow_limit=${2:-20}
  temporal_cli workflow list \
    --query "$workflow_query" \
    --limit "$workflow_limit" \
    --output json
}

contains_workflow() {
  grep -Eq '"workflowId"[[:space:]]*:'
}

migrate_legacy_continuous_workflows() {
  legacy_json=$(workflow_list_json "$legacy_pinned_scheduler_query")
  if ! printf '%s\n' "$legacy_json" | contains_workflow; then
    echo "No legacy pinned continuous Scheduler requires migration."
    return 0
  fi

  printf '%s\n' "$legacy_json"
  temporal_cli workflow update-options \
    --query "$legacy_pinned_scheduler_query" \
    --versioning-override-behavior auto_upgrade \
    --reason "Migrate continuous Schedulers to their registry-owned AutoUpgrade policy" \
    --yes

  migration_attempt=1
  while [ "$migration_attempt" -le 30 ]; do
    legacy_json=$(workflow_list_json "$legacy_pinned_scheduler_query")
    if ! printf '%s\n' "$legacy_json" | contains_workflow; then
      echo "Migrated all legacy pinned continuous Schedulers to AutoUpgrade."
      return 0
    fi
    migration_attempt=$((migration_attempt + 1))
    sleep 2
  done

  printf '%s\n' "$legacy_json"
  echo "Legacy pinned continuous Schedulers did not finish migration" >&2
  return 1
}

container_env() {
  container_id=$1
  key=$2
  docker inspect \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "$container_id" \
    | sed -n "s/^$key=//p" \
    | head -n 1
}

service_container_ids() {
  compose ps --status running -q "$1"
}

first_service_container() {
  service_container_ids "$1" | head -n 1
}

worker_identity() {
  identity_target_service=$1
  identity_container_id=$(first_service_container "$identity_target_service")
  if [ -z "$identity_container_id" ]; then
    return 1
  fi
  worker_namespace=$(container_env "$identity_container_id" TEMPORAL_NAMESPACE)
  worker_deployment=$(container_env "$identity_container_id" TEMPORAL_WORKER_DEPLOYMENT_NAME)
  worker_build_id=$(container_env "$identity_container_id" TEMPORAL_WORKER_BUILD_ID)
  worker_versioning=$(container_env "$identity_container_id" TEMPORAL_WORKER_VERSIONING_ENABLED)
  if [ -z "$worker_namespace" ] \
    || [ -z "$worker_deployment" ] \
    || [ -z "$worker_build_id" ] \
    || [ "$worker_build_id" = local ] \
    || [ "$worker_build_id" = LOCAL ] \
    || [ "$worker_versioning" != true ]; then
    echo "Worker '$identity_target_service' does not expose a production version identity" >&2
    return 1
  fi
  namespace=$worker_namespace
  deployment=$worker_deployment
  build_id=$worker_build_id
}

require_image_digest() {
  image_reference=$1
  image_owner=$2
  case "$image_reference" in
    *@sha256:*) ;;
    *)
      echo "$image_owner must use an immutable repository@sha256 digest" >&2
      return 1
      ;;
  esac
  image_digest=${image_reference#*@sha256:}
  if [ "${#image_digest}" -ne 64 ]; then
    echo "$image_owner sha256 digest must contain exactly 64 hexadecimal characters" >&2
    return 1
  fi
  if [ "$image_digest" = "0000000000000000000000000000000000000000000000000000000000000000" ]; then
    echo "$image_owner still contains the local-development placeholder digest" >&2
    return 1
  fi
  case "$image_digest" in
    *[!0-9a-fA-F]*)
      echo "$image_owner sha256 digest contains non-hexadecimal characters" >&2
      return 1
      ;;
  esac
}

require_visibility_identity() {
  identity_value=$1
  identity_owner=$2
  case "$identity_value" in
    ''|*[!A-Za-z0-9._-]*)
      echo "$identity_owner must contain only letters, digits, dot, underscore, or hyphen" >&2
      return 1
      ;;
  esac
}

configured_environment_value() {
  target_service=$1
  target_key=$2
  compose config | awk -v target="$target_service:" -v key="$target_key:" '
    $0 == "  " target { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:$/ { exit }
    in_service && $0 == "    environment:" { in_environment = 1; next }
    in_environment && $1 == key {
      line = $0
      sub(/^[^:]+:[[:space:]]*/, "", line)
      sub(/^"/, "", line)
      sub(/"$/, "", line)
      print line
      exit
    }
  '
}

load_running_deployment_identity() {
  for identity_service in temporal-worker-blue temporal-worker-green; do
    if worker_identity "$identity_service"; then
      return 0
    fi
  done
  echo "No running production Worker identity is available for rollout preflight" >&2
  return 1
}

deployment_json() {
  temporal_cli worker deployment describe \
    --name "$deployment" \
    --output json
}

current_build_id() {
  deployment_json \
    | sed -n 's/.*"currentVersionBuildID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

has_running_build() {
  expected_build=$1
  for candidate_service in temporal-worker-blue temporal-worker-green; do
    for candidate_id in $(service_container_ids "$candidate_service"); do
      candidate_build=$(container_env "$candidate_id" TEMPORAL_WORKER_BUILD_ID)
      if [ "$candidate_build" = "$expected_build" ]; then
        return 0
      fi
    done
  done
  return 1
}

configured_replicas() {
  target_service=$1
  compose config | awk -v target="$target_service:" '
    $0 == "  " target { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:$/ { exit }
    in_service && $1 == "replicas:" { print $2; exit }
  '
}

show_status() {
  identity_found=false
  for candidate_service in temporal-worker-blue temporal-worker-green; do
    candidate_id=$(first_service_container "$candidate_service")
    if [ -z "$candidate_id" ]; then
      echo "$candidate_service: stopped"
      continue
    fi
    identity_found=true
    candidate_build=$(container_env "$candidate_id" TEMPORAL_WORKER_BUILD_ID)
    echo "$candidate_service: running build=$candidate_build"
    if [ -z "${namespace:-}" ]; then
      namespace=$(container_env "$candidate_id" TEMPORAL_NAMESPACE)
      deployment=$(container_env "$candidate_id" TEMPORAL_WORKER_DEPLOYMENT_NAME)
    fi
  done
  if [ "$identity_found" = false ]; then
    echo "No running Temporal Worker slot was found." >&2
    exit 1
  fi
  deployment_json
  legacy_json=$(workflow_list_json "$legacy_pinned_scheduler_query")
  if printf '%s\n' "$legacy_json" | contains_workflow; then
    echo "Legacy pinned continuous Schedulers require migration:"
    printf '%s\n' "$legacy_json"
  else
    echo "No legacy pinned continuous Scheduler requires migration."
  fi
}

if [ "$command_name" = status ]; then
  show_status
  exit 0
fi

service="temporal-worker-$slot"

configured_build_id=$(configured_environment_value "$service" TEMPORAL_WORKER_BUILD_ID)
configured_image=$(configured_environment_value "$service" TEMPORAL_WORKER_IMAGE)

if [ -z "$configured_build_id" ] || [ "$configured_build_id" = local ] || [ "$configured_build_id" = LOCAL ]; then
  echo "Candidate Worker '$service' requires a unique non-local build ID" >&2
  exit 1
fi
require_visibility_identity "$configured_build_id" "Candidate Worker '$service' build ID"
require_image_digest "$configured_image" "Candidate Worker '$service' image"

if [ "$command_name" = bootstrap ]; then
  case "$slot" in
    blue) other_service=temporal-worker-green ;;
    green) other_service=temporal-worker-blue ;;
  esac
  if [ -n "$(first_service_container "$other_service")" ]; then
    echo "The other Worker slot is already running; use promote for an existing Deployment" >&2
    exit 1
  fi

  if [ -z "$(first_service_container "$service")" ]; then
    compose up -d "$service"
  fi
  attempt=1
  while ! worker_identity "$service"; do
    if [ "$attempt" -ge 30 ]; then
      echo "Initial Worker '$service' did not become running" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  require_visibility_identity "$deployment" "Worker Deployment name"
  if [ "$build_id" != "$configured_build_id" ]; then
    echo "Initial Worker identity changed while starting; refusing bootstrap" >&2
    exit 1
  fi
  running_image=$(container_env "$(first_service_container "$service")" TEMPORAL_WORKER_IMAGE)
  require_image_digest "$running_image" "Running initial Worker '$service' image"
  if [ "$running_image" != "$configured_image" ]; then
    echo "Initial Worker image changed while starting; refusing bootstrap" >&2
    exit 1
  fi

  existing_build=$(current_build_id)
  if [ "$existing_build" = "$build_id" ]; then
    migrate_legacy_continuous_workflows
    echo "Worker '$build_id' is already the initial Current Version."
    exit 0
  fi
  if [ -n "$existing_build" ]; then
    echo "Worker Deployment '$deployment' already has Current Version '$existing_build'; use promote" >&2
    exit 1
  fi

  attempt=1
  while ! temporal_cli worker deployment set-current-version \
    --deployment-name "$deployment" \
    --build-id "$build_id" \
    --yes; do
    if [ "$attempt" -ge 30 ]; then
      echo "Initial Worker '$build_id' did not register every required task queue" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  activated_build=$(current_build_id)
  if [ "$activated_build" != "$build_id" ]; then
    echo "Temporal did not retain '$build_id' as the initial Current Version" >&2
    exit 1
  fi
  migrate_legacy_continuous_workflows
  echo "Bootstrapped '$build_id' as the initial Current Version."
  exit 0
fi

if [ "$command_name" = promote ]; then
  load_running_deployment_identity
  existing_namespace=$namespace
  existing_deployment=$deployment
  require_visibility_identity "$existing_deployment" "Worker Deployment name"
  previous_build=$(current_build_id)
  if [ -z "$previous_build" ]; then
    echo "Worker Deployment '$existing_deployment' has no Current Version; use rollout bootstrap" >&2
    exit 1
  fi
  if [ -n "$previous_build" ] && [ "$configured_build_id" = "$previous_build" ]; then
    echo "Refusing to replace selected slot '$service': its configured build is Current Version '$previous_build'" >&2
    exit 1
  fi

  selected_container=$(first_service_container "$service")
  if [ -n "$selected_container" ]; then
    selected_running_build=$(container_env "$selected_container" TEMPORAL_WORKER_BUILD_ID)
    if [ -n "$previous_build" ] && [ "$selected_running_build" = "$previous_build" ]; then
      echo "Refusing to replace selected slot '$service': its running build is Current Version '$previous_build'" >&2
      exit 1
    fi
  fi
  if [ -n "$previous_build" ] && ! has_running_build "$previous_build"; then
    echo "Current build '$previous_build' has no running blue/green Worker; refusing promotion" >&2
    exit 1
  fi

  compose up -d --no-deps "$service"
  attempt=1
  while ! worker_identity "$service"; do
    if [ "$attempt" -ge 30 ]; then
      echo "Candidate Worker '$service' did not become running" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  if [ "$namespace" != "$existing_namespace" ] || [ "$deployment" != "$existing_deployment" ]; then
    echo "Candidate Worker changed the namespace or Deployment identity; refusing promotion" >&2
    exit 1
  fi
  if [ "$build_id" != "$configured_build_id" ]; then
    echo "Candidate Worker identity changed while starting; refusing promotion" >&2
    exit 1
  fi
  running_image=$(container_env "$(first_service_container "$service")" TEMPORAL_WORKER_IMAGE)
  require_image_digest "$running_image" "Running candidate Worker '$service' image"
  if [ "$running_image" != "$configured_image" ]; then
    echo "Candidate Worker image changed while starting; refusing promotion" >&2
    exit 1
  fi
  if [ -n "$previous_build" ] \
    && [ "$previous_build" != "$build_id" ] \
    && ! has_running_build "$previous_build"; then
    echo "Current build '$previous_build' has no running blue/green Worker; refusing promotion" >&2
    exit 1
  fi

  attempt=1
  while ! temporal_cli worker deployment set-current-version \
    --deployment-name "$deployment" \
    --build-id "$build_id" \
    --yes; do
    if [ "$attempt" -ge 30 ]; then
      echo "Candidate '$build_id' did not register every required task queue" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  activated_build=$(current_build_id)
  if [ "$activated_build" != "$build_id" ]; then
    echo "Temporal did not retain '$build_id' as Current Version" >&2
    exit 1
  fi
  if [ -n "$previous_build" ] \
    && [ "$previous_build" != "$build_id" ] \
    && ! has_running_build "$previous_build"; then
    echo "Previous pinned Worker '$previous_build' disappeared during promotion" >&2
    exit 1
  fi
  migrate_legacy_continuous_workflows
  echo "Promoted '$build_id'. Keep '$previous_build' running until Temporal reports it drained."
  exit 0
fi

worker_identity "$service" || {
  echo "Worker '$service' is not running" >&2
  exit 1
}

current_build=$(current_build_id)
if [ "$current_build" = "$build_id" ]; then
  echo "Refusing to retire Current Version '$build_id'" >&2
  exit 1
fi

version_json=$(
  temporal_cli worker deployment describe-version \
    --deployment-name "$deployment" \
    --build-id "$build_id" \
    --output json
)
if ! printf '%s\n' "$version_json" \
  | grep -Eq '"drainageStatus"[[:space:]]*:[[:space:]]*"drained"'; then
  printf '%s\n' "$version_json"
  echo "Worker '$build_id' is not drained; keep '$service' running" >&2
  exit 1
fi

replicas=$(configured_replicas "$service")
if [ "$replicas" != 0 ]; then
  echo "Set this slot's *_REPLICAS value to 0 in .env before retirement" >&2
  exit 1
fi

compose stop "$service"
compose rm -f "$service"
echo "Retired drained Worker '$build_id'. Temporal may garbage-collect its version metadata."
