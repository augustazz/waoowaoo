import type { CanvasGenerationIntent } from '@/lib/workspace-resource/canvas-generation-intent'
import type {
  WorkspaceResourceInputSummary,
  WorkspaceResourceJsonObject,
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
  WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'

export interface WorkspaceCanvasPathFocusRequest {
  readonly requestId: string
  readonly workspacePath: string
}

export type WorkspaceCanvasResourceOperationKind = 'retry' | 'regenerate' | 'delete'

export type WorkspaceCanvasNodeActionKey =
  | 'discuss'
  | 'download'
  | 'preview_alternatives'
  | 'regenerate'
  | 'animate'
  | 'toggle_workflow'
  | 'use_as_reference'
  | 'retry'
  | 'delete'

/**
 * Exact server-owned action input for a Resource card. Keeping the normalized
 * Operation input in the View prevents the renderer from rebuilding frozen
 * references, scope, or retry facts.
 */
export interface WorkspaceCanvasBillableOperationView {
  readonly kind: Exclude<WorkspaceCanvasResourceOperationKind, 'delete'>
  readonly operationId: string
  readonly confirmation: 'billable_media'
  readonly input: WorkspaceResourceJsonObject
}

export interface WorkspaceCanvasMergeRetryOperationView {
  readonly kind: 'retry'
  readonly operationId: 'merge_videos'
  readonly confirmation: 'none'
  readonly input: WorkspaceResourceJsonObject
}

export interface WorkspaceCanvasDeleteOperationView {
  readonly kind: 'delete'
  readonly operationId: string
  readonly confirmation: 'destructive'
  readonly input: {
    readonly resourceId: string
    readonly workspacePath: string
  }
  readonly approvalInputHash: string
}

export type WorkspaceCanvasResourceOperationView =
  | WorkspaceCanvasBillableOperationView
  | WorkspaceCanvasDeleteOperationView
  | WorkspaceCanvasMergeRetryOperationView

/**
 * Client extension point for the Resource Card View. These optional fields are
 * absent on older servers; the UI then hides only the affected actions instead
 * of inventing capability or candidate facts.
 */
export type WorkspaceCanvasResourceFileView = WorkspaceResourceView & {
  readonly resourceKind: 'file'
  readonly mediaType: WorkspaceResourceMediaType
}

export interface WorkspaceCanvasResourcePreviewView {
  readonly resourceId: string
  readonly name: string
  readonly status: WorkspaceResourceStatus
  readonly workflowEnabled?: boolean
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: string
  readonly error: { readonly code: string } | null
}

export type WorkspaceCanvasResourceSummaryView =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'structured'
      readonly entryCount: number | null
      readonly preview: string | null
    }
  | {
      readonly kind: 'media'
      readonly mediaType: WorkspaceResourceMediaType
      readonly url: string | null
      readonly mimeType: string | null
      readonly width: number | null
      readonly height: number | null
      readonly durationMs: number | null
      readonly posterUrl?: string | null
    }
  | { readonly kind: 'empty' }

export interface WorkspaceResourceCardMemberView {
  readonly resource: WorkspaceCanvasResourcePreviewView
  readonly inputSummaries: readonly WorkspaceResourceInputSummary[]
  readonly download: { readonly href: string; readonly fileName: string } | null
  readonly presentation: {
    readonly rendererKey: string
    readonly fallbackMediaType: WorkspaceResourceMediaType
    readonly summary: WorkspaceCanvasResourceSummaryView
  }
}

export interface WorkspaceResourceCardView
  extends WorkspaceResourceCardMemberView {
  readonly resource: WorkspaceCanvasResourceFileView
  readonly alternativeGroup: {
    readonly groupId: string
    readonly total: number
    readonly members: readonly WorkspaceResourceCardMemberView[]
  } | null
  readonly canvasOperations: readonly WorkspaceCanvasResourceOperationView[]
}


export interface WorkspaceCanvasSelection {
  readonly nodeId: string
  readonly targetType: 'workspaceResource'
  readonly targetId: string
  readonly selectedScopeRef: string
  readonly selectedAssetId: string | null
  readonly name: string
  readonly mediaType: WorkspaceResourceMediaType
  readonly previewUrl: string | null
}

/** Prefills the assistant composer (the "discuss" bridge); nothing is sent. */
export interface WorkspaceAssistantDraftPrefillRequest {
  readonly kind: 'prefill'
  readonly requestId: string
  readonly text: string | null
  readonly focus: boolean
}

/**
 * Sends one message through the assistant's single send authority on behalf
 * of a Canvas draft. `sourceKey` makes the user message identity
 * deterministic, so the Canvas can later recognise the Turn this message
 * started without guessing from recency.
 */
export interface WorkspaceAssistantDraftSubmitRequest {
  readonly canvasGenerationIntent?: CanvasGenerationIntent
  readonly expectedProductionConfigurationVersion: string
  readonly kind: 'submit'
  readonly requestId: string
  readonly sourceKey: string
  readonly text: string
  /** Image Resources delivered as real media attachments (signed receipts). */
  readonly imageReferences: readonly {
    readonly resourceId: string
    readonly previewUrl: string | null
  }[]
  /** Called when the send did not happen; the Canvas releases its draft. */
  readonly onFailed: () => void
}

export type WorkspaceAssistantDraftRequest =
  | WorkspaceAssistantDraftPrefillRequest
  | WorkspaceAssistantDraftSubmitRequest

export interface WorkspaceCanvasUploadPlacement {
  readonly resourceId: string
  readonly position: { readonly x: number; readonly y: number }
}
