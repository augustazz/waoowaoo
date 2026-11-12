import type {
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
} from './contracts'
import { WORKSPACE_RESOURCE_SCHEMA } from './schema-registry'
import { resolveProductionStepStatus } from './step-status'

/**
 * The production steps shown on the Workspace Canvas. A step is a derived,
 * read-only projection over existing Resources; it is never a persisted
 * workflow state and never advances itself.
 *
 * Steps have a phase, an optional/required marker, and explicit prerequisites
 * so the UI can answer "what am I doing now, what is missing, what can I do
 * next". Prerequisites are a *soft* gate: `blocked` explains what is missing,
 * but the UI may still let the user enter the step. Only billable or
 * irreversible actions should ever hard-block.
 *
 * The seven canonical keys are stable. Extending semantics here must not
 * rename keys or reintroduce a second source of truth for progress.
 *
 * Scope: the product's mainline is AI 漫剧 / 短剧. This registry intentionally
 * models one story-to-final-cut pipeline. Do not add per-format branches
 * (ads, brand films, image-only projects) until they become a real use case.
 */
export const PRODUCTION_STAGE_KEYS = [
  'script',
  'direction',
  'assets',
  'storyboard',
  'video',
  'audio',
  'final',
] as const

export type ProductionStageKey = typeof PRODUCTION_STAGE_KEYS[number]

/** Alias used by step-oriented APIs; the keys are intentionally identical. */
export type ProductionStepKey = ProductionStageKey

export function isProductionStageKey(
  value: string | null | undefined,
): value is ProductionStageKey {
  return typeof value === 'string'
    && (PRODUCTION_STAGE_KEYS as readonly string[]).includes(value)
}

/**
 * Legacy Resource-level status used by the Canvas stage rail. A Resource set
 * is pending whenever any Resource is pending, so a step containing a failed
 * row can still be described as "in progress".
 */
export type ProductionStageStatus = 'empty' | 'pending' | 'ready' | 'failed'

/**
 * Derived step gate status. This is the status the step navigation should show.
 * It is computed from Resources and never written back to the database.
 */
export type ProductionStepStatus =
  | 'blocked'
  | 'empty'
  | 'in_progress'
  | 'failed'
  | 'needs_review'
  | 'ready'

/** Groups the seven steps into the three visible workflow phases. */
export type ProductionStepPhase = 'pre' | 'production' | 'post'

/**
 * How the step view groups its artifacts.
 *
 * - `episode`: one row per episode file (`剧本/第01集.json`); scenes stay a
 *   display-level concept inside that file.
 * - `asset_type`: one row per asset category (`角色 / 场景 / 道具`) because an
 *   asset step owns many small files rather than one episode document.
 */
export type ProductionContentGrouping = 'episode' | 'asset_type'

export interface ProductionStepAssistantPrompts {
  /** Full i18n key for "start this step with the assistant". */
  readonly startPromptKey: string
  /** Full i18n key for "review the current result of this step". */
  readonly reviewPromptKey: string
}

export interface ProductionStageDefinition {
  readonly key: ProductionStageKey
  /** 1-based position in the canonical step order. */
  readonly order: number
  readonly phase: ProductionStepPhase
  /** Whether the overall workflow expects this step. Optional steps can be skipped. */
  readonly required: boolean
  /**
   * Hard prerequisites for *starting* the step. Optional steps never appear
   * here, so skipping them cannot block downstream work.
   */
  readonly dependsOn: readonly ProductionStageKey[]
  /** Recommended but skippable prerequisites, surfaced as "suggested" hints. */
  readonly recommendedDependsOn: readonly ProductionStageKey[]
  /** The step's main artifact(s). Used for the focused workbench view. */
  readonly primarySchemaIds: readonly string[]
  /**
   * Artifacts that make the step usable. One ready Resource from this list is
   * enough; the list therefore also expresses alternatives (composite OR
   * rendered final cut).
   */
  readonly requiredSchemaIds: readonly string[]
  /** Supporting artifacts: they count toward progress but never block a step. */
  readonly optionalSchemaIds: readonly string[]
  /**
   * Canonical project-relative folder owned by this step. Placement defaults
   * here so documents and media land in the same directory the step view reads.
   * This is a convention over the shared Resource tree, not a second filesystem.
   */
  readonly defaultFolderPath: string
  /** Grouping used by the step content view. */
  readonly contentGrouping: ProductionContentGrouping
  readonly assistant: ProductionStepAssistantPrompts
  /** Union of primary/required/optional schemas, used for narrow DB queries. */
  readonly schemaIds: readonly string[]
}

type ProductionStageDefinitionInput = Omit<
  ProductionStageDefinition,
  'schemaIds' | 'assistant'
>

const STAGES_I18N_NAMESPACE = 'projectWorkflow.canvas.workspace.stages'

export const PRODUCTION_STAGES_I18N_NAMESPACE = STAGES_I18N_NAMESPACE

function assistantPrompts(key: ProductionStageKey): ProductionStepAssistantPrompts {
  return {
    startPromptKey: `${STAGES_I18N_NAMESPACE}.prompts.${key}`,
    reviewPromptKey: `${STAGES_I18N_NAMESPACE}.reviewPrompts.${key}`,
  }
}

function defineProductionStage(
  input: ProductionStageDefinitionInput,
): ProductionStageDefinition {
  return {
    ...input,
    assistant: assistantPrompts(input.key),
    schemaIds: [...new Set([
      ...input.primarySchemaIds,
      ...input.requiredSchemaIds,
      ...input.optionalSchemaIds,
    ])],
  }
}

export const PRODUCTION_STAGE_DEFINITIONS: readonly ProductionStageDefinition[] = [
  defineProductionStage({
    key: 'script',
    order: 1,
    phase: 'pre',
    required: true,
    dependsOn: [],
    recommendedDependsOn: [],
    primarySchemaIds: [WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY],
    requiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY],
    optionalSchemaIds: [],
    defaultFolderPath: '剧本',
    contentGrouping: 'episode',
  }),
  defineProductionStage({
    key: 'direction',
    order: 2,
    phase: 'pre',
    required: false,
    dependsOn: ['script'],
    recommendedDependsOn: [],
    primarySchemaIds: [WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION],
    requiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION],
    optionalSchemaIds: [],
    defaultFolderPath: '方向',
    contentGrouping: 'episode',
  }),
  defineProductionStage({
    key: 'assets',
    order: 3,
    phase: 'production',
    required: true,
    dependsOn: ['script'],
    recommendedDependsOn: ['direction'],
    primarySchemaIds: [WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH],
    requiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH],
    optionalSchemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
      WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
      WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
    ],
    defaultFolderPath: '资产',
    contentGrouping: 'asset_type',
  }),
  defineProductionStage({
    key: 'storyboard',
    order: 4,
    phase: 'production',
    required: false,
    dependsOn: ['script', 'assets'],
    recommendedDependsOn: ['direction'],
    primarySchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH],
    requiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH],
    optionalSchemaIds: [],
    defaultFolderPath: '分镜',
    contentGrouping: 'episode',
  }),
  defineProductionStage({
    key: 'video',
    order: 5,
    phase: 'production',
    required: true,
    dependsOn: ['script', 'assets'],
    // Storyboarding is optional, so it can only ever be a recommendation here.
    recommendedDependsOn: ['storyboard'],
    primarySchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT],
    requiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT],
    optionalSchemaIds: [],
    defaultFolderPath: '视频',
    contentGrouping: 'episode',
  }),
  defineProductionStage({
    key: 'audio',
    order: 6,
    phase: 'post',
    required: false,
    dependsOn: ['script'],
    recommendedDependsOn: ['storyboard', 'video'],
    primarySchemaIds: [WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH],
    requiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH],
    optionalSchemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
      WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    ],
    defaultFolderPath: '音频',
    contentGrouping: 'episode',
  }),
  defineProductionStage({
    key: 'final',
    order: 7,
    phase: 'post',
    required: true,
    dependsOn: ['video'],
    recommendedDependsOn: ['audio'],
    primarySchemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO,
      WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO,
    ],
    // Either a composite or a rendered cut satisfies the final step.
    requiredSchemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO,
      WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO,
    ],
    optionalSchemaIds: [],
    defaultFolderPath: '成片',
    contentGrouping: 'episode',
  }),
]

const STAGE_BY_SCHEMA_ID = new Map<string, ProductionStageKey>(
  PRODUCTION_STAGE_DEFINITIONS.flatMap((definition) => (
    definition.schemaIds.map((schemaId) => [schemaId, definition.key] as const)
  )),
)

const STAGE_DEFINITION_BY_KEY = new Map<ProductionStageKey, ProductionStageDefinition>(
  PRODUCTION_STAGE_DEFINITIONS.map((definition) => [definition.key, definition]),
)

export function productionStageForSchemaId(schemaId: string): ProductionStageKey | null {
  return STAGE_BY_SCHEMA_ID.get(schemaId) ?? null
}

/**
 * Asset schemas keep a type subfolder so the asset step can be browsed both by
 * category and as one `资产` subtree. Everything else uses the step folder.
 */
const SCHEMA_FOLDER_OVERRIDES: Readonly<Record<string, string>> = {
  [WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE]: '资产/角色',
  [WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE]: '资产/场景',
  [WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE]: '资产/道具',
}

/**
 * Default directory for a schema's artifacts, or `null` for schemas that do not
 * belong to a production step. Placement code uses this so a document or media
 * file can never drift outside the folder its step view reads.
 */
export function defaultProductionFolderPathForSchemaId(schemaId: string): string | null {
  const override = SCHEMA_FOLDER_OVERRIDES[schemaId]
  if (override) return override
  const stage = productionStageForSchemaId(schemaId)
  return stage ? productionStageDefinition(stage).defaultFolderPath : null
}

/**
 * Resolves a caller-supplied destination folder against the placement
 * convention.
 *
 * - `undefined` means "no preference", so the schema's step folder is used.
 * - `null` is an explicit request for the project root and must be preserved.
 *
 * Treating `null` as "unset" silently relocated files that asked for the root.
 */
export function resolveProductionFolderPath(
  folderPath: string | null | undefined,
  schemaId: string,
): string | null {
  return folderPath === undefined
    ? defaultProductionFolderPathForSchemaId(schemaId)
    : folderPath
}

export function productionStageDefinition(
  key: ProductionStageKey,
): ProductionStageDefinition {
  const definition = STAGE_DEFINITION_BY_KEY.get(key)
  if (!definition) throw new Error(`PRODUCTION_STAGE_UNKNOWN:${key}`)
  return definition
}

/** Schema IDs that participate in the stage rail, for narrow database queries. */
export const PRODUCTION_STAGE_SCHEMA_IDS: readonly string[] = [...STAGE_BY_SCHEMA_ID.keys()]

/** Keep existing files readable under the former directory name. */
const STAGE_FOLDER_ALIASES: Partial<Record<ProductionStageKey, readonly string[]>> = {
  direction: ['创作方向'],
}

export function productionStageFolderPaths(key: ProductionStageKey): readonly string[] {
  return [productionStageDefinition(key).defaultFolderPath, ...(STAGE_FOLDER_ALIASES[key] ?? [])]
}

/** Step folders including aliases, for queries over folder-owned Resources. */
export const PRODUCTION_STAGE_FOLDER_PATHS: readonly string[] = PRODUCTION_STAGE_DEFINITIONS
  .flatMap((definition) => productionStageFolderPaths(definition.key))

/**
 * Folders of steps that group their files by episode. The asset step groups by
 * asset type instead, so its nested episode folders must not seed the episode
 * skeleton of other steps.
 */
export const PRODUCTION_EPISODE_FOLDER_PATHS: readonly string[] = PRODUCTION_STAGE_DEFINITIONS
  .filter((definition) => definition.contentGrouping === 'episode')
  .flatMap((definition) => productionStageFolderPaths(definition.key))

/**
 * Folder-first ownership: a Resource inside a step folder belongs to that step
 * regardless of its schema. This is what makes user uploads and generic media
 * visible to the step view even though they have no step schema.
 */
export function productionStageForWorkspacePath(workspacePath: string): ProductionStageKey | null {
  for (const definition of PRODUCTION_STAGE_DEFINITIONS) {
    if (productionStageFolderPaths(definition.key).some((path) => workspacePath.startsWith(`${path}/`))) {
      return definition.key
    }
  }
  return null
}

/**
 * Step owning a folder, including the canonical step folder itself. Folder
 * navigation needs the exact-or-descendant form because
 * `productionStageForWorkspacePath` only matches descendants.
 */
export function productionStageForFolderPath(folderPath: string): ProductionStageKey | null {
  const normalized = folderPath.replace(/\/+$/, '')
  return normalized ? productionStageForWorkspacePath(`${normalized}/`) : null
}

/**
 * Single ownership rule shared by the step navigation and the step content
 * view: directory first, schema as the fallback for legacy Resources that were
 * saved before the folder convention existed.
 */
export function productionStageForResource(row: {
  readonly workspacePath: string
  readonly schemaId: string
}): ProductionStageKey | null {
  return productionStageForWorkspacePath(row.workspacePath)
    ?? productionStageForSchemaId(row.schemaId)
}

export interface ProductionStageResourceRow {
  readonly id: string
  readonly name: string
  readonly workspacePath: string
  readonly status: WorkspaceResourceStatus
  readonly workflowEnabled?: boolean
  readonly schemaId: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly currentVersion: number
  readonly updatedAt: Date
}

export interface ProductionStageCounts {
  readonly total: number
  readonly ready: number
  readonly pending: number
  readonly failed: number
  readonly canceled: number
}

export interface ProductionStageResourceView {
  readonly resourceId: string
  readonly name: string
  readonly workspacePath: string
  readonly status: WorkspaceResourceStatus
  readonly workflowEnabled?: boolean
  readonly schemaId: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly contentVersion: number
  readonly updatedAt: string
}

export interface ProductionStageView {
  readonly key: ProductionStageKey
  readonly order: number
  readonly phase: ProductionStepPhase
  readonly stepRequired: boolean
  readonly dependsOn: readonly ProductionStageKey[]
  readonly recommendedDependsOn: readonly ProductionStageKey[]
  readonly primarySchemaIds: readonly string[]
  readonly requiredSchemaIds: readonly string[]
  readonly optionalSchemaIds: readonly string[]
  readonly defaultFolderPath: string
  readonly contentGrouping: ProductionContentGrouping
  readonly assistant: ProductionStepAssistantPrompts
  /** Legacy Resource-level status; kept for the existing Canvas rail. */
  readonly status: ProductionStageStatus
  /** Derived step gate status. Never persisted. */
  readonly stepStatus: ProductionStepStatus
  /** True when the step has a usable required artifact. */
  readonly requiredArtifactsReady: boolean
  readonly blockers: readonly ProductionStageKey[]
  readonly recommendedMissingStepKeys: readonly ProductionStageKey[]
  readonly missingRequiredSchemaIds: readonly string[]
  readonly counts: ProductionStageCounts
  /** Latest ready Resource for this step, otherwise the latest Resource. */
  readonly primaryResourceId: string | null
  readonly primaryWorkspacePath: string | null
  readonly items: readonly ProductionStageResourceView[]
}

export interface ProductionOverviewView {
  readonly revision: number
  readonly stages: readonly ProductionStageView[]
}

const DEFAULT_STAGE_ITEM_LIMIT = 24

const EMPTY_COUNTS: ProductionStageCounts = {
  total: 0,
  ready: 0,
  pending: 0,
  failed: 0,
  canceled: 0,
}

function stageStatus(counts: ProductionStageCounts): ProductionStageStatus {
  if (counts.total === 0) return 'empty'
  if (counts.pending > 0) return 'pending'
  if (counts.failed > 0) return 'failed'
  if (counts.ready > 0) return 'ready'
  return 'empty'
}

function countStatus(
  counts: ProductionStageCounts,
  status: WorkspaceResourceStatus,
): ProductionStageCounts {
  if (status === 'ready') return { ...counts, ready: counts.ready + 1 }
  if (status === 'pending') return { ...counts, pending: counts.pending + 1 }
  if (status === 'failed') return { ...counts, failed: counts.failed + 1 }
  return { ...counts, canceled: counts.canceled + 1 }
}

function countRows(rows: readonly ProductionStageResourceRow[]): ProductionStageCounts {
  let counts = EMPTY_COUNTS
  for (const row of rows) {
    counts = countStatus({ ...counts, total: counts.total + 1 }, row.status)
  }
  return counts
}

/**
 * Empty step view used by client fallbacks before the overview query resolves.
 * Keeping it here guarantees the fallback stays in sync with the registry.
 */
export function emptyProductionStageView(key: ProductionStageKey): ProductionStageView {
  const definition = productionStageDefinition(key)
  return {
    key,
    order: definition.order,
    phase: definition.phase,
    stepRequired: definition.required,
    dependsOn: definition.dependsOn,
    recommendedDependsOn: definition.recommendedDependsOn,
    primarySchemaIds: definition.primarySchemaIds,
    requiredSchemaIds: definition.requiredSchemaIds,
    optionalSchemaIds: definition.optionalSchemaIds,
    defaultFolderPath: definition.defaultFolderPath,
    contentGrouping: definition.contentGrouping,
    assistant: definition.assistant,
    status: 'empty',
    stepStatus: 'empty',
    requiredArtifactsReady: definition.requiredSchemaIds.length === 0,
    blockers: [],
    recommendedMissingStepKeys: [],
    missingRequiredSchemaIds: definition.requiredSchemaIds.length === 0
      ? []
      : [...definition.requiredSchemaIds],
    counts: EMPTY_COUNTS,
    primaryResourceId: null,
    primaryWorkspacePath: null,
    items: [],
  }
}

/**
 * Aggregates Resource rows into the step rail. Rows must already be scoped to
 * the project and ordered newest-first; this function only groups, counts, and
 * derives step status from prerequisite readiness.
 */
export function summarizeProductionStages(
  rows: readonly ProductionStageResourceRow[],
  options?: { readonly itemLimit?: number },
): ProductionStageView[] {
  const itemLimit = Math.max(0, options?.itemLimit ?? DEFAULT_STAGE_ITEM_LIMIT)
  const rowsByStage = new Map<ProductionStageKey, ProductionStageResourceRow[]>()
  for (const row of rows) {
    if (row.workflowEnabled === false) continue
    const stage = productionStageForResource(row)
    if (!stage) continue
    const bucket = rowsByStage.get(stage)
    if (bucket) bucket.push(row)
    else rowsByStage.set(stage, [row])
  }

  const stats = new Map<ProductionStageKey, {
    readonly stageRows: readonly ProductionStageResourceRow[]
    readonly counts: ProductionStageCounts
    readonly readySchemaIds: ReadonlySet<string>
    readonly hasReadyFolderArtifact: boolean
  }>()
  for (const definition of PRODUCTION_STAGE_DEFINITIONS) {
    const stageRows = rowsByStage.get(definition.key) ?? []
    const readyRows = stageRows.filter((row) => row.status === 'ready')
    stats.set(definition.key, {
      stageRows,
      counts: countRows(stageRows),
      readySchemaIds: new Set(readyRows.map((row) => row.schemaId)),
      // Folder ownership is the primary signal: a ready file inside the step
      // folder makes the step usable even without a step-specific schema.
      hasReadyFolderArtifact: readyRows.some((row) => (
        productionStageForWorkspacePath(row.workspacePath) === definition.key
      )),
    })
  }

  // Definitions are ordered, so every prerequisite is resolved before its
  // dependants. A dependency adds no implicit graph traversal or persistence.
  const dependencyReadiness = new Map<ProductionStageKey, boolean>()
  return PRODUCTION_STAGE_DEFINITIONS.map((definition) => {
    const { stageRows, counts, readySchemaIds, hasReadyFolderArtifact } = stats.get(definition.key) ?? {
      stageRows: [],
      counts: EMPTY_COUNTS,
      readySchemaIds: new Set<string>(),
      hasReadyFolderArtifact: false,
    }
    const step = resolveProductionStepStatus({
      definition,
      counts,
      readySchemaIds,
      hasReadyFolderArtifact,
      dependencyReadiness,
    })
    dependencyReadiness.set(definition.key, step.requiredArtifactsReady)
    const primary = stageRows.find((row) => row.status === 'ready') ?? stageRows[0] ?? null
    return {
      key: definition.key,
      order: definition.order,
      phase: definition.phase,
      stepRequired: definition.required,
      dependsOn: definition.dependsOn,
      recommendedDependsOn: definition.recommendedDependsOn,
      primarySchemaIds: definition.primarySchemaIds,
      requiredSchemaIds: definition.requiredSchemaIds,
      optionalSchemaIds: definition.optionalSchemaIds,
      defaultFolderPath: definition.defaultFolderPath,
      contentGrouping: definition.contentGrouping,
      assistant: definition.assistant,
      status: stageStatus(counts),
      stepStatus: step.status,
      requiredArtifactsReady: step.requiredArtifactsReady,
      blockers: step.blockers,
      recommendedMissingStepKeys: step.recommendedMissingStepKeys,
      missingRequiredSchemaIds: step.missingRequiredSchemaIds,
      counts,
      primaryResourceId: primary?.id ?? null,
      primaryWorkspacePath: primary?.workspacePath ?? null,
      items: stageRows.slice(0, itemLimit).map((row) => ({
        resourceId: row.id,
        name: row.name,
        workspacePath: row.workspacePath,
        status: row.status,
        schemaId: row.schemaId,
        mediaType: row.mediaType,
        contentVersion: row.currentVersion,
        updatedAt: row.updatedAt.toISOString(),
      })),
    }
  })
}
