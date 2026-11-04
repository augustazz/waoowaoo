#!/usr/bin/env sh
set -eu

# Start only the waoowaoo application processes (Web and Temporal Worker).
# This script never starts MySQL, Redis, Temporal, or MinIO. Point the
# environment at external services, or configure MySQL/S3 from the setup/admin
# page.
#
# Usage:
#   scripts/start-service.sh [prod|dev|web|worker]
#
#   prod    Build-backed Web + Temporal Worker (default)
#   dev     Next.js dev server + Temporal Worker
#   web     Web only
#   worker  Temporal Worker only
#
# Environment is read from .env by Next.js, the Temporal Worker, and Prisma.
# The page-based MySQL/S3 configuration lives in data/config/*.json and wins
# over the corresponding environment variables.

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

MODE=${1:-prod}

usage() {
  cat <<'EOF'
Start only the waoowaoo application processes (Web and Temporal Worker).
This script never starts MySQL, Redis, Temporal, or MinIO.

Usage:
  scripts/start-service.sh [prod|dev|web|worker]

  prod    Build-backed Web + Temporal Worker (default)
  dev     Next.js dev server + Temporal Worker
  web     Web only
  worker  Temporal Worker only

Environment is read from .env by Next.js, the Temporal Worker, and Prisma.
The page-based MySQL/S3 configuration lives in data/config/*.json and wins
over the corresponding environment variables.
EOF
  exit 2
}

case "$MODE" in
  prod|dev|web|worker) ;;
  -h|--help|help) usage ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage
    ;;
esac

warn_external_dependencies() {
  if [ ! -f .env ]; then
    echo "[start] No .env found; relying on the current process environment." >&2
    return
  fi

  node --env-file=.env -e '
    const fs = require("node:fs")
    const hasDb = !!process.env.DATABASE_URL?.trim() || fs.existsSync("data/config/database.json")
    const hasS3 = (
      !!process.env.S3_ENDPOINT?.trim()
      && !!process.env.S3_BUCKET?.trim()
      && !!process.env.S3_ACCESS_KEY_ID?.trim()
      && !!process.env.S3_SECRET_ACCESS_KEY?.trim()
    ) || fs.existsSync("data/config/storage.json")
    const redisHost = process.env.REDIS_HOST?.trim() || "127.0.0.1"
    const redisPort = process.env.REDIS_PORT?.trim() || "6379"
    const temporalAddress = process.env.TEMPORAL_ADDRESS?.trim() || "127.0.0.1:17233"

    if (!hasDb) {
      console.warn("[start] MySQL is not configured. The Web app will start, but open /<locale>/setup to configure it.")
    }
    if (!hasS3) {
      console.warn("[start] S3 is not configured. The Web app will start, but media storage is unavailable until it is configured.")
    }
    console.log(`[start] Redis: ${redisHost}:${redisPort}`)
    console.log(`[start] Temporal: ${temporalAddress}`)
    console.log("[start] This script does not start MySQL, Redis, Temporal, or MinIO.")
  '
}

prepare_source_run() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[start] Node.js is required." >&2
    exit 1
  fi
  if [ ! -d node_modules ]; then
    echo "[start] node_modules is missing. Run: npm ci" >&2
    exit 1
  fi
  if [ ! -f .env ]; then
    echo "[start] .env is required. Copy .env.example to .env and configure external services." >&2
    exit 1
  fi

  npm run edition:prepare
  npm run db:push
}

warn_external_dependencies

case "$MODE" in
  dev)
    prepare_source_run
    npm run storage:init
    exec npx concurrently --kill-others \
      "npm run dev:next" \
      "npm run dev:temporal-worker"
    ;;
  web)
    if [ ! -d .next ]; then
      echo "[start] .next is missing. Run: npm run build" >&2
      exit 1
    fi
    prepare_source_run
    npm run storage:init
    exec npm run start:next
    ;;
  worker)
    prepare_source_run
    npm run storage:init
    exec npm run start:temporal-worker
    ;;
  prod)
    if [ ! -d .next ]; then
      echo "[start] .next is missing. Run: npm run build" >&2
      exit 1
    fi
    prepare_source_run
    exec npm run start
    ;;
esac
