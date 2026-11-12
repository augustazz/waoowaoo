'use client'

import { Fragment, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useActiveProductionStep } from '../hooks/useActiveProductionStep'
import { useSelectProductionStep } from '../hooks/useSelectProductionStep'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import {
  type ProductionStageKey,
  type ProductionStepPhase,
  type ProductionStepStatus,
} from '@/lib/workspace-resource/production-stages'
import {
  PRODUCTION_STEP_QUERY_PARAM,
} from '@/lib/workspace-resource/step-navigation'

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

const STEP_STATUS_DOT_CLASS: Record<ProductionStepStatus, string> = {
  blocked: 'bg-slate-300 ring-2 ring-slate-200',
  empty: 'bg-slate-300',
  in_progress: 'animate-pulse bg-amber-400',
  failed: 'bg-rose-500',
  needs_review: 'bg-sky-500',
  ready: 'bg-emerald-500',
}

export function ProductionStepNavigation({
  projectId,
  onStepSelected,
}: {
  readonly projectId: string
  readonly onStepSelected: (stepKey: ProductionStageKey) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.stages')
  const {
    activeStep,
    requestedStep,
    stages,
    overviewFetched,
    searchParamsValue,
  } = useActiveProductionStep(projectId)
  const selectStep = useSelectProductionStep(projectId)
  const pathname = usePathname()
  const router = useRouter()

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

  const selectStepAndShowCanvas = (stepKey: ProductionStageKey) => {
    // Explicitly selecting a step always updates the active step. The caller
    // decides whether this filters the canvas (step-only mode) or keeps every
    // step visible and merely focuses the selected one (all-content mode).
    selectStep(stepKey)
    onStepSelected(stepKey)
  }

  return (
      <div
        className="pointer-events-none absolute inset-x-0 top-3 z-[90] flex flex-col items-center"
        {...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}
      >
        <div className="flex w-full max-w-[1200px] justify-center px-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full border border-slate-200/80 bg-white/92 px-1.5 py-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          {PHASES.map((phase, phaseIndex) => (
            <Fragment key={phase}>
              {phaseIndex > 0 ? (
                <span className="mx-1 h-5 w-px shrink-0 bg-slate-400" aria-hidden="true" />
              ) : null}
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
                    onClick={() => selectStepAndShowCanvas(stage.key)}
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
        </div>
      </div>
  )
}
