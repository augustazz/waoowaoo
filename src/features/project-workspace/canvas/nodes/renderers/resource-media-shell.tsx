'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type {
  WorkspaceCanvasResourceFileView,
  WorkspaceCanvasResourceSummaryView,
} from '../../contracts/workspace-canvas-interactions'
import { useEstimatedTaskProgress } from '@/lib/query/hooks/useEstimatedTaskProgress'
import {
  workspaceCanvasGenerationStage,
  workspaceCanvasLifecycleTaskState,
  type WorkspaceCanvasLifecycle,
} from '../../lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasMediaShell } from '../../node-canvas-types'
import { workspaceCanvasScrollableRegionProps } from '../../canvas-scroll-lock'
import { LoadingSpinner, PreviewableImage, SELECTABLE_TEXT_CLASS } from './renderer-shared'

const OVERTIME_MINIMUM_MINUTES = 1

/**
 * Generation feedback inside the media shell: stage label plus the simulated
 * progress percent during the normal window. Once the curve runs overtime the
 * percent is replaced by the waited time — the card never shows a pinned 99%.
 */
function GeneratingIndicator({ lifecycle }: { readonly lifecycle: WorkspaceCanvasLifecycle }) {
  const t = useTranslations('projectWorkflow.canvas.workspace.generation')
  const progress = useEstimatedTaskProgress(workspaceCanvasLifecycleTaskState(lifecycle))
  const stage = workspaceCanvasGenerationStage(lifecycle)
  // A reserved-but-unmaterialized Resource whose lifecycle is not generating
  // (e.g. its Task attempt failed and awaits retry) shows the neutral shell.
  if (!stage) return <EmptyMediaBody />

  const detail = progress?.isRunning
    ? progress.isOvertime
      ? t('waitedMinutes', {
          minutes: Math.max(OVERTIME_MINIMUM_MINUTES, Math.floor(progress.elapsedSeconds / 60)),
        })
      : t('progressPercent', { percent: Math.floor(Math.min(99, Math.max(0, progress.percent))) })
    : null
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--glass-text-secondary)]">
        <LoadingSpinner />
        <span className={SELECTABLE_TEXT_CLASS}>{t(`stage.${stage}`)}</span>
      </div>
      {detail ? (
        <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-medium tabular-nums text-[var(--glass-text-tertiary)]`}>
          {detail}
        </p>
      ) : null}
    </div>
  )
}

function EmptyMediaBody() {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">—</div>
  )
}

function FailedBody() {
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  return (
    <div className="flex h-full w-full items-center justify-center gap-2 text-sm font-medium text-[var(--glass-tone-danger-fg)]">
      <AppIcon name="alertSolid" className="h-4 w-4" />
      <span className={SELECTABLE_TEXT_CLASS}>{statusLabels('failed')}</span>
    </div>
  )
}

function MediaBody({
  resource,
  summary,
  fit,
}: {
  readonly resource: WorkspaceCanvasResourceFileView
  readonly summary: WorkspaceCanvasResourceSummaryView
  readonly fit: WorkspaceCanvasMediaShell['fit']
}) {
  if (summary.kind === 'media' && summary.url) {
    if (summary.mediaType === 'image') {
      return (
        <PreviewableImage
          sourceImageUrl={summary.url}
          alt={resource.name}
          buttonClassName="h-full w-full"
          imageClassName={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
        />
      )
    }
    if (summary.mediaType === 'video') {
      return (
        <video
          src={summary.url}
          poster={summary.posterUrl ?? undefined}
          aria-label={resource.name}
          controls
          preload="metadata"
          className="nodrag nowheel h-full w-full bg-black object-contain"
        />
      )
    }
    if (summary.mediaType === 'audio') {
      return (
        <div className="flex h-full w-full items-center px-2">
          <audio
            src={summary.url}
            aria-label={resource.name}
            controls
            preload="metadata"
            className="nodrag nowheel w-full"
          />
        </div>
      )
    }
  }
  if (summary.kind === 'text') {
    return (
      <p
        {...workspaceCanvasScrollableRegionProps<HTMLParagraphElement>()}
        className={`${SELECTABLE_TEXT_CLASS} nowheel h-full w-full overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-slate-700`}
      >
        {summary.text}
      </p>
    )
  }
  if (summary.kind === 'structured') {
    return <StructuredBody entryCount={summary.entryCount} preview={summary.preview} />
  }
  return <EmptyMediaBody />
}

function StructuredBody({
  entryCount,
  preview,
}: {
  readonly entryCount: number | null
  readonly preview: string | null
}) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  if (preview) {
    return (
      <p
        {...workspaceCanvasScrollableRegionProps<HTMLParagraphElement>()}
        className={`${SELECTABLE_TEXT_CLASS} nowheel h-full w-full overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-slate-700`}
      >
        {preview}
      </p>
    )
  }
  const text = entryCount === null
    ? labels('structuredSummaryUnknown')
    : labels('structuredSummary', { count: entryCount })
  return (
    <p className={`${SELECTABLE_TEXT_CLASS} flex h-full w-full items-center p-4 text-sm leading-6 text-slate-600`}>
      {text}
    </p>
  )
}

export interface ResourceMediaShellItem {
  readonly resource: WorkspaceCanvasResourceFileView
  readonly summary: WorkspaceCanvasResourceSummaryView
}

function itemBody(
  item: ResourceMediaShellItem,
  lifecycle: WorkspaceCanvasLifecycle,
  fit: WorkspaceCanvasMediaShell['fit'],
) {
  if (item.resource.status === 'ready') {
    return <MediaBody resource={item.resource} summary={item.summary} fit={fit} />
  }
  if (item.resource.status === 'pending') {
    return <GeneratingIndicator lifecycle={lifecycle} />
  }
  if (item.resource.status === 'failed') {
    return <FailedBody />
  }
  return <EmptyMediaBody />
}

/**
 * The card's media area. Its size comes only from the declared media shell,
 * so the pending state and the finished media occupy the exact same box.
 */
export function ResourceMediaShell({
  shell,
  lifecycle,
  items,
  moreCount,
  moreLabel,
}: {
  readonly shell: WorkspaceCanvasMediaShell
  readonly lifecycle: WorkspaceCanvasLifecycle
  readonly items: readonly ResourceMediaShellItem[]
  readonly moreCount: number
  readonly moreLabel: string | null
}) {
  const generating = workspaceCanvasGenerationStage(lifecycle) !== null
    && items.some((item) => item.resource.status === 'pending')
  const surfaceClass = generating ? 'workspace-node-loading-surface' : ''
  const frameStyle = { width: shell.width, height: shell.height } as const
  if (items.length <= 1) {
    const item = items[0]
    return (
      <div
        className={`${surfaceClass} overflow-hidden rounded-2xl bg-slate-100`}
        style={frameStyle}
        data-media-shell-form={shell.form}
      >
        {item ? itemBody(item, lifecycle, shell.fit) : <EmptyMediaBody />}
      </div>
    )
  }
  return (
    <div style={{ width: shell.width }} data-media-shell-form={shell.form}>
      <div
        className={`${surfaceClass} grid auto-rows-fr grid-cols-2 gap-2 overflow-hidden rounded-2xl`}
        style={{ height: shell.height }}
      >
        {items.map((item) => (
          <div
            key={item.resource.resourceId}
            className="overflow-hidden rounded-xl bg-slate-100"
          >
          {itemBody(item, lifecycle, shell.fit)}
          </div>
        ))}
      </div>
      {moreCount > 0 && moreLabel ? (
        <p className={`${SELECTABLE_TEXT_CLASS} mt-2 text-xs text-slate-500`}>{moreLabel}</p>
      ) : null}
    </div>
  )
}
