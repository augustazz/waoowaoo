'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { useProductionOverview } from '@/lib/query/hooks'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import {
  PRODUCTION_STAGE_DEFINITIONS,
  PRODUCTION_STAGE_KEYS,
  type ProductionStageKey,
  type ProductionStageResourceView,
  type ProductionStageStatus,
  type ProductionStageView,
} from '@/lib/workspace-resource/production-stages'

const STAGE_ICONS: Record<ProductionStageKey, AppIconName> = {
  script: 'fileText',
  direction: 'sparkles',
  assets: 'user',
  storyboard: 'bookOpen',
  video: 'video',
  audio: 'audioWave',
  final: 'play',
}

const STATUS_DOT_CLASS: Record<ProductionStageStatus, string> = {
  empty: 'bg-slate-300',
  pending: 'animate-pulse bg-amber-400',
  ready: 'bg-emerald-500',
  failed: 'bg-rose-500',
}

function resourceDotClass(status: ProductionStageResourceView['status']): string {
  if (status === 'ready') return 'bg-emerald-500'
  if (status === 'pending') return 'animate-pulse bg-amber-400'
  if (status === 'failed') return 'bg-rose-500'
  return 'bg-slate-300'
}

function statusChipClass(status: ProductionStageStatus): string {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  return 'bg-slate-50 text-slate-500 ring-slate-200'
}

function resourceStatusChipClass(status: ProductionStageResourceView['status']): string {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  return 'bg-slate-50 text-slate-500 ring-slate-200'
}

function StageItemRow({
  item,
  statusLabel,
  actionLabel,
  onAction,
}: {
  readonly item: ProductionStageResourceView
  readonly statusLabel: string
  readonly actionLabel: string
  readonly onAction: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50"
      onClick={onAction}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${resourceDotClass(item.status)}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-800">{item.name}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-400">{item.workspacePath}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${resourceStatusChipClass(item.status)}`}>
        {statusLabel}
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-slate-500">{actionLabel}</span>
    </button>
  )
}

function StagePopover({
  stage,
  stageLabel,
  onOpenScript,
  onOpenResourcePath,
  onStart,
}: {
  readonly stage: ProductionStageView
  readonly stageLabel: string
  readonly onOpenScript: (resourceId: string) => void
  readonly onOpenResourcePath: (workspacePath: string) => void
  readonly onStart: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const statusLabel = useTranslations('projectWorkflow.canvas.workspace.status')
  const moreCount = Math.max(0, stage.counts.total - stage.items.length)
  return (
    <div
      className="w-[min(92vw,560px)] max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white/98 shadow-[0_24px_64px_rgba(15,23,42,0.18)] backdrop-blur-xl"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon name={STAGE_ICONS[stage.key]} className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="truncate text-sm font-semibold text-slate-900">{stageLabel}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusChipClass(stage.status)}`}>
            {t(`status.${stage.status}`)}
          </span>
        </div>
      </div>
      {stage.items.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-slate-500">{t('emptyHint')}</p>
          <button
            type="button"
            className="glass-btn-base glass-btn-primary mt-3 px-4 py-2 text-sm"
            onClick={onStart}
          >
            {t('start')}
          </button>
        </div>
      ) : (
        <div className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
          {stage.items.map((item) => {
            const openWorkbench = stage.key === 'script' && item.status === 'ready'
            return (
              <StageItemRow
                key={item.resourceId}
                item={item}
                statusLabel={statusLabel(item.status === 'ready' ? 'succeeded' : item.status)}
                actionLabel={openWorkbench ? t('openScript') : t('locate')}
                onAction={() => {
                  if (openWorkbench) onOpenScript(item.resourceId)
                  else onOpenResourcePath(item.workspacePath)
                }}
              />
            )
          })}
          {moreCount > 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-400">{t('more', { count: moreCount })}</p>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function ProductionStageRail({
  projectId,
  onOpenResourcePath,
  onOpenScreenplay,
  onAssistantDraft,
}: {
  readonly projectId: string
  readonly onOpenResourcePath: (workspacePath: string) => void
  readonly onOpenScreenplay: (resourceId: string) => void
  readonly onAssistantDraft: (text: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const overviewQuery = useProductionOverview(projectId)
  const [openStageKey, setOpenStageKey] = useState<ProductionStageKey | null>(null)
  const stages = overviewQuery.data?.stages
    ?? PRODUCTION_STAGE_KEYS.map((key): ProductionStageView => ({
      key,
      status: 'empty',
      counts: { total: 0, ready: 0, pending: 0, failed: 0, canceled: 0 },
      primaryResourceId: null,
      primaryWorkspacePath: null,
      items: [],
    }))
  const openStage = stages.find((stage) => stage.key === openStageKey) ?? null

  const closePopover = useCallback(() => setOpenStageKey(null), [])

  useEffect(() => {
    if (!openStageKey) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopover()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePopover, openStageKey])

  const startStage = (stage: ProductionStageView) => {
    onAssistantDraft(t(`prompts.${stage.key}`))
    closePopover()
  }

  return (
    <>
      {openStage ? (
        <div
          className="fixed inset-0 z-[88]"
          aria-hidden="true"
          onMouseDown={closePopover}
        />
      ) : null}
      <div
        className="pointer-events-none absolute inset-x-0 top-3 z-[90] flex flex-col items-center"
        {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
      >
        <div className="pointer-events-auto flex max-w-[min(100%,980px)] items-center gap-1 overflow-x-auto rounded-full border border-slate-200/80 bg-white/92 px-1.5 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <span className="hidden shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:inline">
            {t('label')}
          </span>
          {PRODUCTION_STAGE_DEFINITIONS.map((definition) => {
            const stage = stages.find((candidate) => candidate.key === definition.key)
              ?? null
            const status = stage?.status ?? 'empty'
            const counts = stage?.counts ?? { total: 0, ready: 0 }
            const active = openStageKey === definition.key
            return (
              <button
                key={definition.key}
                type="button"
                title={t(`status.${status}`)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition ${
                  active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                onClick={() => setOpenStageKey((current) => current === definition.key ? null : definition.key)}
              >
                <AppIcon
                  name={STAGE_ICONS[definition.key]}
                  className={`h-3.5 w-3.5 ${active ? 'text-white' : 'text-slate-400'}`}
                />
                <span>{t(definition.key)}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white/80' : STATUS_DOT_CLASS[status]}`} />
                {counts.total > 0 ? (
                  <span className={`tabular-nums text-[10px] ${active ? 'text-white/70' : 'text-slate-400'}`}>
                    {t('count', { ready: counts.ready, total: counts.total })}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {openStage ? (
          <div className="pointer-events-auto mt-2">
            <StagePopover
              stage={openStage}
              stageLabel={t(openStage.key)}
              onOpenScript={(resourceId) => {
                onOpenScreenplay(resourceId)
                closePopover()
              }}
              onOpenResourcePath={(workspacePath) => {
                onOpenResourcePath(workspacePath)
                closePopover()
              }}
              onStart={() => startStage(openStage)}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
