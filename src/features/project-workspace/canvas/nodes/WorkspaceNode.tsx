'use client'

import { useContext, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import { workspaceCanvasLifecycleStatusKey } from '../lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasFlowNode } from '../node-canvas-types'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'
import {
  LoadingSpinner,
  WorkspaceNodeImagePreviewContext,
  nodeIsRunning,
} from './renderers/renderer-shared'
import { FolderSectionShell } from './renderers/folder-card'
import { NodeContent } from './workspace-node-renderer-registry'
import { isWorkspaceCanvasImagePreviewTarget } from '../canvas-interaction-target'
import { WorkspaceCanvasResourceSelectionContext } from './workspace-node-selection'

const SELECTABLE_CARD_CHROME_CLASS = 'select-none cursor-grab active:cursor-grabbing'

export default function WorkspaceNode({ data, id }: NodeProps<WorkspaceCanvasFlowNode>) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  const workflowDisabled = data.kind === 'resourceCard' && data.resourceDetails.resource.workflowEnabled === false
  const nodeDefinition = getWorkspaceCanvasNodeDefinition(data.kind)
  const presentation = nodeDefinition.presentation
  const isRunning = nodeIsRunning(data)
  const statusLabel = statusLabels(workspaceCanvasLifecycleStatusKey(data.lifecycle))
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const selectResourceNode = useContext(WorkspaceCanvasResourceSelectionContext)


  if (data.kind === 'folder' && data.folder.display === 'section') {
    return <FolderSectionShell data={data} />
  }
  if (data.kind === 'resourceCard' && !selectResourceNode) {
    throw new Error('WORKSPACE_CANVAS_RESOURCE_SELECTION_CONTEXT_REQUIRED')
  }

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <div className="relative h-full overflow-visible">
        {presentation.hasTargetHandle ? (
          <Handle
            type="target"
            position={Position.Left}
            className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm"
          />
        ) : null}
        {presentation.hasSourceHandle ? (
          <Handle
            type="source"
            position={Position.Right}
            className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm"
          />
        ) : null}

        <article
          className={`workspace-canvas-node-shell relative h-full cursor-pointer overflow-visible rounded-[18px] border bg-white/92 shadow-[0_12px_36px_rgba(15,23,42,0.07)] backdrop-blur-xl transition-[border-color,box-shadow] duration-150 active:cursor-grabbing ${workflowDisabled ? 'border-dashed' : ''} ${
            data.uiSelected
              ? 'border-slate-500 shadow-[0_0_0_2px_rgba(255,255,255,0.96),0_0_0_5px_rgba(100,116,139,0.5),0_18px_48px_rgba(15,23,42,0.18)]'
              : data.uiMultiSelected
                ? 'border-sky-500 shadow-[0_0_0_2px_rgba(255,255,255,0.96),0_0_0_4px_rgba(14,165,233,0.45)]'
              : isRunning
                ? 'workspace-node-running-breathing border-sky-300'
                : 'border-slate-200/80'
          }`}
          data-node-id={data.nodeId}
          data-workflow-enabled={!workflowDisabled}
          data-lifecycle-phase={data.lifecycle.phase}
          data-lifecycle-task-id={data.lifecycle.taskId ?? ''}
          onClick={(event) => {
            if (data.kind !== 'resourceCard' || isWorkspaceCanvasImagePreviewTarget(event.target)) return
            event.stopPropagation()
            selectResourceNode?.(id, { additive: event.shiftKey || event.metaKey || event.ctrlKey })
          }}
        >
          <header className="flex min-h-[24px] items-center gap-2 px-3.5 pb-1.5 pt-2.5">
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] bg-slate-100 text-[var(--glass-text-tertiary)]"
              title={data.eyebrow}
            >
              <AppIcon name={presentation.iconName} className="h-3 w-3" />
            </span>
            <h2
              className={`${SELECTABLE_CARD_CHROME_CLASS} min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-[var(--glass-text-primary)]`}
            >
              {data.title}
            </h2>
            {workflowDisabled ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {statusLabels('disabled')}
              </span>
            ) : null}
            {data.lifecycle.phase !== 'succeeded' ? (
              <span
                className={`${SELECTABLE_CARD_CHROME_CLASS} inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  isRunning
                    ? 'border-transparent bg-[var(--glass-tone-surface)] text-[var(--glass-tone-info-fg)]'
                    : data.lifecycle.phase === 'failed'
                      ? 'border-transparent bg-[var(--glass-tone-surface)] text-[var(--glass-tone-danger-fg)]'
                      : 'border-transparent bg-[var(--glass-tone-surface)] text-[var(--glass-tone-neutral-fg)]'
                }`}
              >
                {isRunning ? <LoadingSpinner /> : null}
                {statusLabel}
              </span>
            ) : null}
          </header>

          <div className="workspace-canvas-node-content px-3.5 pb-3.5 pt-0.5">
            <NodeContent data={data} labels={labels} />
          </div>
        </article>
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </WorkspaceNodeImagePreviewContext.Provider>
  )
}
