import {
  WORKSPACE_RESOURCE_SCHEMA,
  type WorkspaceResourceSchemaId,
} from '@/lib/workspace-resource/schema-registry'

export type AssetImageKind = 'character' | 'location' | 'prop'
const ASSET_IMAGE_ASPECT_RATIO = '4:3' as const

interface AssetImageFormatPolicy {
  readonly kind: AssetImageKind
  readonly schemaId: WorkspaceResourceSchemaId
  readonly aspectRatio: typeof ASSET_IMAGE_ASPECT_RATIO
}

/** Legacy Canvas fallback when neither frozen media facts nor a project frame exist. Never a generation constraint. */
export const ASSET_IMAGE_FORMAT_POLICIES = {
  character: {
    kind: 'character',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    aspectRatio: ASSET_IMAGE_ASPECT_RATIO,
  },
  location: {
    kind: 'location',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    aspectRatio: ASSET_IMAGE_ASPECT_RATIO,
  },
  prop: {
    kind: 'prop',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
    aspectRatio: ASSET_IMAGE_ASPECT_RATIO,
  },
} as const satisfies Record<AssetImageKind, AssetImageFormatPolicy>

const ASSET_IMAGE_KIND_BY_SCHEMA_ID = new Map<WorkspaceResourceSchemaId, AssetImageKind>(
  Object.values(ASSET_IMAGE_FORMAT_POLICIES).map((policy) => [policy.schemaId, policy.kind]),
)

export function getAssetImageFormatPolicy(kind: AssetImageKind): AssetImageFormatPolicy {
  return ASSET_IMAGE_FORMAT_POLICIES[kind]
}

export function resolveAssetImageKindForSchemaId(schemaId: string): AssetImageKind | null {
  return ASSET_IMAGE_KIND_BY_SCHEMA_ID.get(schemaId as WorkspaceResourceSchemaId) ?? null
}
