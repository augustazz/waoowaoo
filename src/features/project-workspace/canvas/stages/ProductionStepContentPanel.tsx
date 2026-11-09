'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { useProductionStepContent } from '@/lib/query/hooks'
import type {
  ProductionAssetTypeKey,
  ProductionContentGroupView,
  ProductionContentItemView,
} from '@/lib/workspace-resource/production-content'
import type {
  ProductionStageResourceView,
  ProductionStageView,
  ProductionStepStatus,
} from '@/lib/workspace-resource/production-stages'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'

const ASSET_TYPE_ICONS: Record<ProductionAssetTypeKey, AppIconName> = {
  character: 'user',
  location: 'image',
  prop: 'folder',
  other: 'file',
}

function resourceDotClass(status: ProductionStageResourceView['status']): string {
  if (status === 'ready') return 'bg-emerald-500'
  if (status === 'pending') return 'animate-pulse bg-amber-400'
  if (status === 'failed') return 'bg-rose-500'
  return 'bg-slate-300'
}

function resourceChipClass(status: ProductionStageResourceView['status']): string {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  return 'bg-slate-50 text-slate-500 ring-slate-200'
}

function stepChipClass(status: ProductionStepStatus): string {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'in_progress') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  if (status === 'needs_review') return 'bg-sky-50 text-sky-700 ring-sky-200'
  return 'bg-slate-50 text-slate-500 ring-slate-200'
}

function episodeLabel(number: number): string {
  return String(number).padStart(2, '0')
}

function ItemThumb({ item }: { readonly item: ProductionContentItemView }) {
  if (item.previewUrl && item.mediaType === 'image') {
    return (
      <img
        src={item.previewUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
      />
    )
  }
  const icon: AppIconName = item.mediaType === 'video'
    ? 'video'
    : item.mediaType === 'audio'
      ? 'audioWave'
      : 'fileText'
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
      <AppIcon name={icon} className="h-4 w-4" />
    </span>
  )
}

function ContentItemRow({
  item,
  actionLabel,
  onAction,
}: {
  readonly item: ProductionContentItemView
  readonly actionLabel: string
  readonly onAction: () => void
}) {
  const statusLabel = useTranslations('projectWorkflow.canvas.workspace.status')
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50"
      onClick={onAction}
    >
      <ItemThumb item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-800">{item.name}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-400">{item.workspacePath}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${resourceChipClass(item.status)}`}>
        {statusLabel(item.status === 'ready' ? 'succeeded' : item.status)}
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-slate-500">{actionLabel}</span>
      <span className={`h-2 w-2 shrink-0 rounded-full ${resourceDotClass(item.status)}`} />
    </button>
  )
}

function ContentGroupCard({
  group,
  stepKey,
  onOpenScreenplay,
  onOpenResourcePath,
}: {
  readonly group: ProductionContentGroupView
  readonly stepKey: ProductionStageView['key']
  readonly onOpenScreenplay: (resourceId: string) => void
  readonly onOpenResourcePath: (workspacePath: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const label = group.assetTypeKey
    ? t(`content.assetType.${group.assetTypeKey}`)
    : group.episodeNumber === null
      ? t('content.unassigned')
      : t('content.episode', { number: episodeLabel(group.episodeNumber) })
  const icon: AppIconName = group.assetTypeKey
    ? ASSET_TYPE_ICONS[group.assetTypeKey]
    : 'fileText'
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <AppIcon name={icon} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">{label}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${stepChipClass(group.status)}`}>
          {t(`stepStatus.${group.status}`)}
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-slate-400">
          {t('count', { ready: group.counts.ready, total: group.counts.total })}
        </span>
      </header>
      {group.items.length === 0 ? (
        <p className="px-3 py-3 text-[12px] text-slate-400">{t('content.groupEmpty')}</p>
      ) : (
        <div className="p-1">
          {group.items.map((item) => {
            const openWorkbench = stepKey === 'script' && item.status === 'ready'
            return (
              <ContentItemRow
                key={item.resourceId}
                item={item}
                actionLabel={openWorkbench ? t('openScript') : t('locate')}
                onAction={() => {
                  if (openWorkbench) onOpenScreenplay(item.resourceId)
                  else onOpenResourcePath(item.workspacePath)
                }}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

export function ProductionStepContentPanel({
  projectId,
  stage,
  onOpenScreenplay,
  onOpenResourcePath,
  onStart,
  onReview,
}: {
  readonly projectId: string
  readonly stage: ProductionStageView
  readonly onOpenScreenplay: (resourceId: string) => void
  readonly onOpenResourcePath: (workspacePath: string) => void
  readonly onStart: () => void
  readonly onReview: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const contentQuery = useProductionStepContent(projectId, stage.key)
  const content = contentQuery.data
  const groups = content?.groups ?? []
  const counts = content?.counts ?? stage.counts
  const listSteps = (keys: readonly ProductionStageView['key'][]) => (
    keys.map((key) => t(key)).join(t('listSeparator'))
  )

  return (
    <div
      className="pointer-events-auto flex max-h-[calc(100vh-9rem)] w-[min(94%,380px)] flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/96 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
      {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
    >
      <header className="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{t(stage.key)}</span>
            {!stage.stepRequired ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {t('optionalBadge')}
              </span>
            ) : null}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${stepChipClass(stage.stepStatus)}`}>
              {t(`stepStatus.${stage.stepStatus}`)}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-400">
            {t('content.folder', { path: stage.defaultFolderPath })}
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="tabular-nums">{t('count', { ready: counts.ready, total: counts.total })}</span>
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label={t('content.refresh')}
          onClick={() => { void contentQuery.refetch() }}
        >
          <AppIcon name="refresh" className="h-4 w-4" />
        </button>
      </header>

      {stage.blockers.length > 0 ? (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[12px] font-medium text-amber-700">
          {t('blockedBy', { steps: listSteps(stage.blockers) })}
        </p>
      ) : null}
      {stage.recommendedMissingStepKeys.length > 0 ? (
        <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[12px] text-slate-500">
          {t('recommendedMissing', { steps: listSteps(stage.recommendedMissingStepKeys) })}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {contentQuery.isLoading ? (
          <p className="px-2 py-6 text-center text-[12px] text-slate-400">{t('content.loading')}</p>
        ) : contentQuery.isError ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
            <p className="text-[12px] text-rose-500">{t('content.loadFailed')}</p>
            <button
              type="button"
              className="text-[12px] font-semibold text-slate-600 underline"
              onClick={() => { void contentQuery.refetch() }}
            >
              {t('content.retry')}
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-sm text-slate-500">{t('content.empty')}</p>
            <p className="mt-1 text-[12px] text-slate-400">{t('content.emptyHint')}</p>
          </div>
        ) : (
          groups.map((group) => (
            <ContentGroupCard
              key={group.groupKey}
              group={group}
              stepKey={stage.key}
              onOpenScreenplay={onOpenScreenplay}
              onOpenResourcePath={onOpenResourcePath}
            />
          ))
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-3 py-2.5">
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-100"
          onClick={() => onOpenResourcePath(stage.defaultFolderPath)}
        >
          {t('locate')}
        </button>
        <button
          type="button"
          className="glass-btn-base glass-btn-primary px-4 py-1.5 text-[12px]"
          onClick={onStart}
        >
          {t('start')}
        </button>
        {counts.total > 0 ? (
          <button
            type="button"
            className="rounded-full border border-slate-200 px-4 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
            onClick={onReview}
          >
            {t('review')}
          </button>
        ) : null}
      </footer>
    </div>
  )
}
