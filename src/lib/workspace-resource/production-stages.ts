import type {
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
} from './contracts'
import { WORKSPACE_RESOURCE_SCHEMA } from './schema-registry'

/**
 * The production stages shown on the Workspace Canvas. Stages are a derived
 * read-only projection over existing Resources; they never gate or advance a
 * workflow. A project may legitimately skip, revisit, or run stages in any
 * order, so every stage is always present in the projection even when empty.
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

export type ProductionStageStatus = 'empty' | 'pending' | 'ready' | 'failed'

export interface ProductionStageDefinition {
  readonly key: ProductionStageKey
  readonly schemaIds: readonly string[]
}

export const PRODUCTION_STAGE_DEFINITIONS: readonly ProductionStageDefinition[] = [
  {
    key: 'script',
    schemaIds: [WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY],
  },
  {
    key: 'direction',
    schemaIds: [WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION],
  },
  {
    key: 'assets',
    schemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH,
      WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
      WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
      WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
    ],
  },
  {
    key: 'storyboard',
    schemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH],
  },
  {
    key: 'video',
    schemaIds: [WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT],
  },
  {
    key: 'audio',
    schemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH,
      WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
      WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    ],
  },
  {
    key: 'final',
    schemaIds: [
      WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO,
      WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO,
    ],
  },
]

const STAGE_BY_SCHEMA_ID = new Map<string, ProductionStageKey>(
  PRODUCTION_STAGE_DEFINITIONS.flatMap((definition) => (
    definition.schemaIds.map((schemaId) => [schemaId, definition.key] as const)
  )),
)

export function productionStageForSchemaId(schemaId: string): ProductionStageKey | null {
  return STAGE_BY_SCHEMA_ID.get(schemaId) ?? null
}

/** Schema IDs that participate in the stage rail, for narrow database queries. */
export const PRODUCTION_STAGE_SCHEMA_IDS: readonly string[] = [...STAGE_BY_SCHEMA_ID.keys()]

export interface ProductionStageResourceRow {
  readonly id: string
  readonly name: string
  readonly workspacePath: string
  readonly status: WorkspaceResourceStatus
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
  readonly schemaId: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly contentVersion: number
  readonly updatedAt: string
}

export interface ProductionStageView {
  readonly key: ProductionStageKey
  readonly status: ProductionStageStatus
  readonly counts: ProductionStageCounts
  /** Latest ready Resource for this stage, otherwise the latest Resource. */
  readonly primaryResourceId: string | null
  readonly primaryWorkspacePath: string | null
  readonly items: readonly ProductionStageResourceView[]
}

export interface ProductionOverviewView {
  readonly revision: number
  readonly stages: readonly ProductionStageView[]
}

const DEFAULT_STAGE_ITEM_LIMIT = 24

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

/**
 * Aggregates Resource rows into the stage rail. Rows must already be scoped to
 * the project and ordered newest-first; this function only groups and counts.
 */
export function summarizeProductionStages(
  rows: readonly ProductionStageResourceRow[],
  options?: { readonly itemLimit?: number },
): ProductionStageView[] {
  const itemLimit = Math.max(0, options?.itemLimit ?? DEFAULT_STAGE_ITEM_LIMIT)
  const rowsByStage = new Map<ProductionStageKey, ProductionStageResourceRow[]>()
  for (const row of rows) {
    const stage = productionStageForSchemaId(row.schemaId)
    if (!stage) continue
    const bucket = rowsByStage.get(stage)
    if (bucket) bucket.push(row)
    else rowsByStage.set(stage, [row])
  }
  return PRODUCTION_STAGE_DEFINITIONS.map((definition) => {
    const stageRows = rowsByStage.get(definition.key) ?? []
    let counts: ProductionStageCounts = {
      total: 0,
      ready: 0,
      pending: 0,
      failed: 0,
      canceled: 0,
    }
    for (const row of stageRows) {
      counts = {
        ...counts,
        total: counts.total + 1,
      }
      counts = countStatus(counts, row.status)
    }
    const primary = stageRows.find((row) => row.status === 'ready') ?? stageRows[0] ?? null
    return {
      key: definition.key,
      status: stageStatus(counts),
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
