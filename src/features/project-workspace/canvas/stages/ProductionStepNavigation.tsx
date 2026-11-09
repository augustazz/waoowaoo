'use client'

import { Fragment, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useActiveProductionStep } from '../hooks/useActiveProductionStep'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import {
  emptyProductionStageView,
  PRODUCTION_STAGES_I18N_NAMESPACE,
  type ProductionStageKey,
  type ProductionStageResourceView,
  type ProductionStageView,
  type ProductionStepPhase,
  type ProductionStepStatus,
} from '@/lib/workspace-resource/production-stages'
import {
  PRODUCTION_STEP_QUERY_PARAM,
  writeLastProductionStep,
  type ProductionContentView,
} from '@/lib/workspace-resource/step-navigation'
import { ProductionStepContentPanel } from './ProductionStepContentPanel'

const STAGE_ICONS: Record<ProductionStageKey, AppIconName> = {
  script: 'fileText',
  direction: 'sparkles',
  assets: 'user',
  storyboard: 'bookOpen',
  video: 'video',
  audio: 'audioWave',
  final: 'play',
}

const PHASES: readonly ProductionStepPhase[] = ['pre', 'production', 'post']

const STAGES_NAMESPACE_PREFIX = `${PRODUCTION_STAGES_I18N_NAMESPACE}.`

function toStagesNamespaceKey(fullKey: string): string {
  return fullKey.startsWith(STAGES_NAMESPACE_PREFIX)
    ? fullKey.slice(STAGES_NAMESPACE_PREFIX.length)
    : fullKey
}

const STEP_STATUS_DOT_CLASS: Record<ProductionStepStatus, string> = {
  blocked: 'bg-slate-300 ring-2 ring-slate-200',
  empty: 'bg-slate-300',
  in_progress: 'animate-pulse bg-amber-400',
  failed: 'bg-rose-500',
  needs_review: 'bg-sky-500',
  ready: 'bg-emerald-500',
}

function resourceDotClass(status: ProductionStageResourceView['status']): string {
  if (status === 'ready') return 'bg-emerald-500'
  if (status === 'pending') return 'animate-pulse bg-amber-400'
  if (status === 'failed') return 'bg-rose-500'
  return 'bg-slate-300'
}

function stepStatusChipClass(status: ProductionStepStatus): string {
  if (status === 'ready') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (status === 'in_progress') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (status === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  if (status === 'needs_review') return 'bg-sky-50 text-sky-700 ring-sky-200'
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

function StepPopover({
  stage,
  stageLabel,
  onOpenScript,
  onOpenResourcePath,
  onStart,
  onReview,
}: {
  readonly stage: ProductionStageView
  readonly stageLabel: string
  readonly onOpenScript: (resourceId: string) => void
  readonly onOpenResourcePath: (workspacePath: string) => void
  readonly onStart: () => void
  readonly onReview: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const statusLabel = useTranslations('projectWorkflow.canvas.workspace.status')
  const moreCount = Math.max(0, stage.counts.total - stage.items.length)
  const primaryWorkspacePath = stage.primaryWorkspacePath
  const listSteps = (keys: readonly ProductionStageKey[]) => (
    keys.map((key) => t(key)).join(t('listSeparator'))
  )
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
          {!stage.stepRequired ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              {t('optionalBadge')}
            </span>
          ) : null}
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${stepStatusChipClass(stage.stepStatus)}`}>
            {t(`stepStatus.${stage.stepStatus}`)}
          </span>
        </div>
      </div>
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
      {stage.items.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-slate-500">{t('emptyHint')}</p>
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
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
        {primaryWorkspacePath ? (
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-100"
            onClick={() => onOpenResourcePath(primaryWorkspacePath)}
          >
            {t('locate')}
          </button>
        ) : null}
        <button
          type="button"
          className="glass-btn-base glass-btn-primary px-4 py-1.5 text-[12px]"
          onClick={onStart}
        >
          {t('start')}
        </button>
        {stage.items.length > 0 ? (
          <button
            type="button"
            className="rounded-full border border-slate-200 px-4 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50"
            onClick={onReview}
          >
            {t('review')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function ProductionStepNavigation({
  projectId,
  contentView,
  onContentViewChange,
  onOpenResourcePath,
  onOpenScreenplay,
  onAssistantDraft,
}: {
  readonly projectId: string
  readonly contentView: ProductionContentView
  readonly onContentViewChange: (view: ProductionContentView) => void
  readonly onOpenResourcePath: (workspacePath: string) => void
  readonly onOpenScreenplay: (resourceId: string) => void
  readonly onAssistantDraft: (text: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const {
    activeStep,
    requestedStep,
    stages,
    overviewFetched,
    searchParamsValue,
  } = useActiveProductionStep(projectId)
  const pathname = usePathname()
  const router = useRouter()

  const [openStageKey, setOpenStageKey] = useState<ProductionStageKey | null>(null)
  const openStage = stages.find((stage) => stage.key === openStageKey) ?? null

  // Keep the URL in sync once data is available so refresh and shared links
  // land on the same step. Uses replace to avoid history spam.
  useEffect(() => {
    if (!overviewFetched) return
    if (requestedStep === activeStep) return
    const next = new URLSearchParams(searchParamsValue)
    next.set(PRODUCTION_STEP_QUERY_PARAM, activeStep)
    router.replace({
      pathname,
      query: Object.fromEntries(next.entries()),
    }, { scroll: false })
  }, [
    activeStep,
    overviewFetched,
    pathname,
    requestedStep,
    router,
    searchParamsValue,
  ])

  useEffect(() => {
    if (!openStageKey) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenStageKey(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openStageKey])

  const closePopover = () => setOpenStageKey(null)

  const selectStep = (stepKey: ProductionStageKey) => {
    // The step view already shows the selected step, so the popover only makes
    // sense in the full-files view where it acts as a jump list.
    setOpenStageKey((current) => (
      contentView === 'files' ? (current === stepKey ? null : stepKey) : null
    ))
    // Only explicit selections become "resume last"; derivation is not a
    // decision and must not overwrite the user's choice.
    writeLastProductionStep(projectId, stepKey)
    const next = new URLSearchParams(searchParamsValue)
    next.set(PRODUCTION_STEP_QUERY_PARAM, stepKey)
    router.replace({
      pathname,
      query: Object.fromEntries(next.entries()),
    }, { scroll: false })
  }

  const selectContentView = (view: ProductionContentView) => {
    onContentViewChange(view)
    if (view === 'step') setOpenStageKey(null)
  }

  const openFilesAt = (workspacePath: string) => {
    setOpenStageKey(null)
    onContentViewChange('files')
    onOpenResourcePath(workspacePath)
  }

  const activeStage = stages.find((stage) => stage.key === activeStep)
    ?? emptyProductionStageView(activeStep)

  const startStage = (stage: ProductionStageView) => {
    onAssistantDraft(t(toStagesNamespaceKey(stage.assistant.startPromptKey)))
    closePopover()
  }

  const reviewStage = (stage: ProductionStageView) => {
    onAssistantDraft(t(toStagesNamespaceKey(stage.assistant.reviewPromptKey)))
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
        <div className="pointer-events-auto flex max-w-[min(100%,1200px)] items-center gap-2">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full border border-slate-200/80 bg-white/92 px-1.5 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <span className="hidden shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:inline">
            {t('label')}
          </span>
          {PHASES.map((phase, phaseIndex) => (
            <Fragment key={phase}>
              {phaseIndex > 0 ? (
                <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
              ) : null}
              <span className="hidden shrink-0 px-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400 sm:inline">
                {t(`phases.${phase}`)}
              </span>
              {stages.filter((stage) => stage.phase === phase).map((stage) => {
                const active = stage.key === activeStep
                const status = stage.stepStatus
                return (
                  <button
                    key={stage.key}
                    type="button"
                    title={t(`stepStatus.${status}`)}
                    aria-current={active ? 'step' : undefined}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition ${
                      active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    onClick={() => selectStep(stage.key)}
                  >
                    <AppIcon
                      name={STAGE_ICONS[stage.key]}
                      className={`h-3.5 w-3.5 ${active ? 'text-white' : 'text-slate-400'}`}
                    />
                    <span>{t(stage.key)}</span>
                    {!stage.stepRequired ? (
                      <span className={`text-[9px] font-semibold ${active ? 'text-white/60' : 'text-slate-400'}`}>
                        {t('optionalBadge')}
                      </span>
                    ) : null}
                    <span className={`h-1.5 w-1.5 rounded-full ${STEP_STATUS_DOT_CLASS[status]}`} />
                    {stage.counts.total > 0 ? (
                      <span className={`tabular-nums text-[10px] ${active ? 'text-white/70' : 'text-slate-400'}`}>
                        {t('count', { ready: stage.counts.ready, total: stage.counts.total })}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
        <div className="flex shrink-0 items-center rounded-full border border-slate-200/80 bg-white/92 p-1 shadow-[0_8px_28px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          {(['step', 'files'] as const).map((view) => {
            const active = contentView === view
            return (
              <button
                key={view}
                type="button"
                title={view === 'step' ? t('content.viewStepHint') : t('content.viewFilesHint')}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                  active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                }`}
                onClick={() => selectContentView(view)}
              >
                {view === 'step' ? t('content.viewStep') : t('content.viewFiles')}
              </button>
            )
          })}
        </div>
        </div>
        {openStage ? (
          <div className="pointer-events-auto mt-2">
            <StepPopover
              stage={openStage}
              stageLabel={t(openStage.key)}
              onOpenScript={(resourceId) => {
                onOpenScreenplay(resourceId)
                closePopover()
              }}
              onOpenResourcePath={(workspacePath) => {
                openFilesAt(workspacePath)
              }}
              onStart={() => startStage(openStage)}
              onReview={() => reviewStage(openStage)}
            />
          </div>
        ) : null}
      </div>
      {contentView === 'step' ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-[64px] z-[89] flex justify-end px-3"
          {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
        >
          <ProductionStepContentPanel
            projectId={projectId}
            stage={activeStage}
            onOpenScreenplay={(resourceId) => {
              onOpenScreenplay(resourceId)
            }}
            onOpenResourcePath={openFilesAt}
            onStart={() => startStage(activeStage)}
            onReview={() => reviewStage(activeStage)}
          />
        </div>
      ) : null}
    </>
  )
}
