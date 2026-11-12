'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { WorkspaceResourceCardView } from '../contracts/workspace-canvas-interactions'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'
import type { WorkspaceCanvasNodeActionKey } from '../contracts/workspace-canvas-interactions'
import type { WorkspaceNodeDetailsActions } from './WorkspaceNodeDetailsCard'
import { useCanvasResourceWorkflowAction } from '../actions/useCanvasResourceWorkflowAction'

interface ActionButton {
  readonly key: WorkspaceCanvasNodeActionKey
  readonly icon: AppIconName
  readonly label: string
  readonly run: () => void
  readonly tone?: 'primary' | 'danger'
  readonly disabled?: boolean
}

export function WorkspaceNodeActionBar({
  card,
  busy,
  onDiscuss,
  onDownload,
  onPreview,
  onRegenerate,
  regenerateDisabled,
  onAnimate,
  onUseAsReference,
  onOperation,
}: {
  readonly card: WorkspaceResourceCardView
  readonly busy: boolean
  readonly onDiscuss: () => void
  readonly onDownload: (() => void) | null
  readonly onPreview: () => void
  /** Present only when the server projected a "run again" Operation for this card. */
  readonly onRegenerate: (() => void) | null
  readonly regenerateDisabled: boolean
  /** Opens a video draft seeded with this image as its first frame. */
  readonly onAnimate: (() => void) | null
  /** Present only while an open draft can take this card as a reference. */
  readonly onUseAsReference: (() => void) | null
  readonly onOperation: WorkspaceNodeDetailsActions['onOperation']
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.actions')
  const resource = card.resource
  const workflow = useCanvasResourceWorkflowAction(resource.projectId)
  const workflowDisabled = resource.workflowEnabled === false
  const hasPreview = card.presentation.summary.kind !== 'empty'
  const declared = new Set(
    getWorkspaceCanvasNodeDefinition('resourceCard').actionKeysByMediaType[resource.mediaType],
  )
  const operationByKind = new Map(
    card.canvasOperations.map((operation) => [operation.kind, operation] as const),
  )
  const actions: ActionButton[] = []
  const add = (action: ActionButton) => {
    if (declared.has(action.key)) actions.push(action)
  }

  if (onRegenerate) {
    add({ key: 'regenerate', icon: 'sparkles', label: t('regenerate'), run: onRegenerate, tone: 'primary', disabled: regenerateDisabled })
  }
  if (onAnimate && !workflowDisabled) add({ key: 'animate', icon: 'clapperboard', label: t('animate'), run: onAnimate })
  add({ key: 'discuss', icon: 'sparklesAlt', label: t('discuss'), run: onDiscuss })
  if (onUseAsReference && !workflowDisabled) add({ key: 'use_as_reference', icon: 'link', label: t('useAsReference'), run: onUseAsReference })
  if (hasPreview) add({ key: 'preview_alternatives', icon: 'searchPlus', label: t('preview'), run: onPreview })
  if (onDownload) add({ key: 'download', icon: 'download', label: t('download'), run: onDownload })
  const retryOperation = operationByKind.get('retry')
  if (retryOperation) add({ key: 'retry', icon: 'refresh', label: t('retry'), run: () => onOperation(retryOperation) })
  if (resource.actions.some((action) => action.kind === 'toggle_workflow' && action.enabled)) {
    add({
      key: 'toggle_workflow', icon: workflowDisabled ? 'play' : 'pause',
      label: t(workflowDisabled ? 'restoreWorkflow' : 'disableWorkflow'),
      run: () => { void workflow.setWorkflowEnabled(resource.resourceId, workflowDisabled) },
    })
  }
  const deleteOperation = operationByKind.get('delete')
  if (deleteOperation) {
    add({ key: 'delete', icon: 'trash', label: t('delete'), run: () => onOperation(deleteOperation), tone: 'danger' })
  }
  return (
    <div className="border-t border-slate-100 pt-2.5">
      {workflowDisabled ? <p className="mb-2 text-xs text-slate-500">{t('workflowDisabledHint')}</p> : null}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={busy || workflow.busy || action.disabled}
            className={`nodrag inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              action.tone === 'primary'
                ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                : action.tone === 'danger'
                  ? 'border-red-200 bg-white text-[var(--glass-tone-danger-fg)] hover:bg-slate-50'
                  : 'border-slate-200 bg-white text-[var(--glass-text-secondary)] hover:bg-slate-50'
            }`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={action.run}
          >
            <AppIcon name={action.icon} className="h-3.5 w-3.5" />
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
