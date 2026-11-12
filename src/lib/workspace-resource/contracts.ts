export const WORKSPACE_RESOURCE_ROOT_FOLDER_KEY = '@root' as const

const WORKSPACE_RESOURCE_MAX_PATH_BYTES = 512
const WORKSPACE_RESOURCE_RESERVED_ROOTS = new Set(['system', '.wao'])

export function isWorkspaceResourceReservedRootName(value: string): boolean {
  return WORKSPACE_RESOURCE_RESERVED_ROOTS.has(value)
}

/** Browser-safe grammar for every project-relative WorkspaceResource path. */
export function isCanonicalWorkspaceResourcePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (
    value === WORKSPACE_RESOURCE_ROOT_FOLDER_KEY
    || value !== value.trim()
    || value !== value.normalize('NFC')
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || new TextEncoder().encode(value).byteLength > WORKSPACE_RESOURCE_MAX_PATH_BYTES
  ) {
    return false
  }
  const segments = value.split('/')
  return segments.length > 0
    && !isWorkspaceResourceReservedRootName(segments[0] ?? '')
    && segments.every((segment) => (
      segment.length > 0
      && segment !== '.'
      && segment !== '..'
      && !segment.startsWith('.')
    ))
}

/**
 * Pure Catalog path relations. Server listing and client canvas projection
 * must share these instead of re-deriving parent/subtree semantics locally.
 */
export function workspaceResourceParentPath(workspacePath: string): string | null {
  const separator = workspacePath.lastIndexOf('/')
  return separator === -1 ? null : workspacePath.slice(0, separator)
}

export function isWorkspaceResourceSubtreePath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}

export const WORKSPACE_RESOURCE_TREE_SCOPES = ['children', 'subtree'] as const
export type WorkspaceResourceTreeScope = (typeof WORKSPACE_RESOURCE_TREE_SCOPES)[number]

export const WORKSPACE_RESOURCE_KINDS = ['file', 'folder'] as const
export type WorkspaceResourceKind = (typeof WORKSPACE_RESOURCE_KINDS)[number]

export const WORKSPACE_RESOURCE_MEDIA_TYPES = ['text', 'image', 'audio', 'video'] as const
export type WorkspaceResourceMediaType = (typeof WORKSPACE_RESOURCE_MEDIA_TYPES)[number]

export type WorkspaceResourceAlternativeMediaKind = 'image' | 'video' | 'music' | 'voice'

export interface WorkspaceResourceAlternativeGenerationCapability {
  readonly kind: 'request_count'
  readonly mediaKind: WorkspaceResourceAlternativeMediaKind
  readonly requestKind: 'new'
  /** The one Resource semantic used by the compact Canvas create form. */
  readonly defaultSchemaId: string
  readonly minCount: 1
  readonly maxCount: 6
  readonly inputLimits?: {
    readonly durationSeconds?: { readonly min: number; readonly max: number }
    readonly promptMaxLength?: number
    readonly previewTextMaxLength?: number
  }
}

export const WORKSPACE_RESOURCE_STATUSES = ['pending', 'ready', 'failed', 'canceled'] as const
export type WorkspaceResourceStatus = (typeof WORKSPACE_RESOURCE_STATUSES)[number]

export const WORKSPACE_RESOURCE_CONTENT_KINDS = ['text', 'structured', 'media'] as const
export type WorkspaceResourceContentKind = (typeof WORKSPACE_RESOURCE_CONTENT_KINDS)[number]

export type WorkspaceResourceJsonObject = {
  readonly [key: string]: WorkspaceResourceJsonValue
}

export type WorkspaceResourceJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkspaceResourceJsonValue[]
  | WorkspaceResourceJsonObject

export interface WorkspaceResourceRef {
  readonly resourceId: string
  readonly contentVersion: number
  /** Frozen display/provenance path. Identity is resourceId + contentVersion. */
  readonly workspacePath: string
}

export interface WorkspaceResourceInputRef extends WorkspaceResourceRef {
  readonly role: string
  readonly position: number
  readonly channel?: 'context' | 'image' | 'audio' | 'video'
  readonly purpose?: 'identity' | 'scene' | 'continuity' | 'prop' | 'style'
}

export type WorkspaceResourceContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'structured'; readonly data: WorkspaceResourceJsonValue }
  | {
      readonly kind: 'media'
      readonly mediaId: string
      readonly url: string
      readonly mimeType: string | null
      readonly width: number | null
      readonly height: number | null
      readonly durationMs: number | null
      readonly posterUrl?: string | null
    }

/** Full text of a version's content for display; null for media content. */
export function workspaceResourceContentText(
  content: WorkspaceResourceContent | null | undefined,
): string | null {
  if (!content) return null
  if (content.kind === 'text') return content.text
  if (content.kind === 'structured') return JSON.stringify(content.data, null, 2)
  return null
}

export interface WorkspaceResourceVersionView {
  readonly version: number
  /** Null in tree/search projections; read_resource returns the full content. */
  readonly content: WorkspaceResourceContent | null
  readonly sha256: string | null
  readonly sizeBytes: number
  readonly createdAt: string
}

/** Lightweight version row for history lists; never includes full content. */
export interface WorkspaceResourceVersionSummaryView {
  readonly version: number
  readonly contentKind: 'text' | 'structured' | 'media'
  readonly contentPreview: string | null
  readonly sha256: string | null
  readonly sizeBytes: number
  readonly sourceTurnId: string | null
  readonly createdAt: string
}

export interface WorkspaceResourceVersionDetailView extends WorkspaceResourceVersionSummaryView {
  readonly content: WorkspaceResourceContent | null
}

export type WorkspaceResourceSummaryView =
  | { readonly kind: 'folder' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly preview: string | null }
  | { readonly kind: 'structured'; readonly preview: string | null }
  | {
      readonly kind: 'media'
      readonly url: string
      readonly mimeType: string | null
      readonly width: number | null
      readonly height: number | null
      readonly durationMs: number | null
      readonly posterUrl?: string | null
    }

export interface WorkspaceResourceAncestorView {
  readonly resourceId: string
  readonly name: string
  readonly workspacePath: string
}

export interface WorkspaceResourceInputSummary extends WorkspaceResourceInputRef {
  readonly workflowEnabled: boolean
  readonly durationMs: number | null
  readonly resourceKind: 'file'
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: string
  readonly name: string
  readonly previewUrl: string | null
  readonly posterUrl?: string | null
}

export interface WorkspaceResourceActionView {
  readonly kind: 'retry' | 'regenerate' | 'download' | 'delete' | 'toggle_workflow'
  readonly enabled: boolean
  readonly operationId: string | null
  readonly input: WorkspaceResourceJsonObject | null
  readonly href: string | null
  /** Stable hash of the exact normalized destructive input, otherwise null. */
  readonly approvalInputHash: string | null
}

export interface WorkspaceResourceAlternativeMemberView {
  readonly resourceId: string
  readonly workspacePath: string
  readonly name: string
  readonly schemaId: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly status: WorkspaceResourceStatus
  /** Disabled resources stay visible for comparison but cannot feed new workflow work. */
  readonly workflowEnabled?: boolean
  readonly memberIndex: number
  readonly previewUrl: string | null
  readonly posterUrl?: string | null
}

export interface WorkspaceResourceAlternativeGroupView {
  readonly groupId: string
  readonly total: number
  readonly members: readonly WorkspaceResourceAlternativeMemberView[]
}

export interface WorkspaceResourceView {
  readonly resourceId: string
  readonly projectId: string
  readonly resourceKind: WorkspaceResourceKind
  readonly workspacePath: string
  readonly ancestors: readonly WorkspaceResourceAncestorView[]
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly schemaId: string
  readonly name: string
  readonly status: WorkspaceResourceStatus
  /** Disabled resources stay visible for comparison but cannot feed new workflow work. */
  readonly workflowEnabled?: boolean
  /** Folders are versionless and always expose 0. */
  readonly contentVersion: number
  readonly current: WorkspaceResourceVersionView | null
  readonly summary: WorkspaceResourceSummaryView
  readonly prompt: string | null
  /** Public model label. Provider-qualified routing identity is never exposed. */
  readonly modelName: string | null
  readonly generationOptions: WorkspaceResourceJsonValue | null
  readonly operationId: string | null
  readonly memberIndex: number | null
  readonly alternativeGroupExecutionId: string | null
  readonly alternativeGroup: WorkspaceResourceAlternativeGroupView | null
  readonly inputs: readonly WorkspaceResourceInputRef[]
  readonly inputSummaries: readonly WorkspaceResourceInputSummary[]
  /** Server-owned action projection. Canvas must not infer capabilities. */
  readonly actions: readonly WorkspaceResourceActionView[]
  readonly taskId: string | null
  readonly error: {
    readonly code: string
    readonly diagnostic: string | null
  } | null
  readonly deletedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface WorkspaceResourceTreePage {
  readonly items: readonly WorkspaceResourceView[]
  readonly nextCursor: string | null
  /** Lower-bound revision read before this page was projected. */
  readonly revision: number
}

export interface WorkspaceResourceGenerationProvenance {
  readonly operationId: string | null
  readonly inputHash: string | null
  readonly taskId: string | null
  readonly operationExecutionId: string | null
  readonly toolCallId: string | null
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly generationOptions: WorkspaceResourceJsonValue | null
}

export type WorkspaceResourceOperationContract =
  | { readonly kind: 'none'; readonly reason: string }
  | {
      readonly kind: 'resource'
      readonly assistantPresentation: 'none' | 'created_resources'
      readonly acceptsReferences: boolean
      readonly outputResourceKinds: readonly WorkspaceResourceKind[]
      readonly outputMediaTypes: readonly WorkspaceResourceMediaType[]
      readonly outputSchemaIds: readonly string[]
      readonly placement: 'required'
      readonly alternativeGeneration?: WorkspaceResourceAlternativeGenerationCapability
    }

export function isWorkspaceResourceKind(value: unknown): value is WorkspaceResourceKind {
  return typeof value === 'string' && WORKSPACE_RESOURCE_KINDS.some((candidate) => candidate === value)
}

export function isWorkspaceResourceMediaType(value: unknown): value is WorkspaceResourceMediaType {
  return typeof value === 'string'
    && WORKSPACE_RESOURCE_MEDIA_TYPES.some((candidate) => candidate === value)
}

export function isWorkspaceResourceStatus(value: unknown): value is WorkspaceResourceStatus {
  return typeof value === 'string'
    && WORKSPACE_RESOURCE_STATUSES.some((candidate) => candidate === value)
}
