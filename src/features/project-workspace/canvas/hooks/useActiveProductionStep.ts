'use client'

import { useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { useProductionOverview } from '@/lib/query/hooks'
import {
  emptyProductionStageView,
  PRODUCTION_STAGE_KEYS,
  type ProductionStageKey,
  type ProductionStageView,
} from '@/lib/workspace-resource/production-stages'
import {
  PRODUCTION_STEP_QUERY_PARAM,
  readLastProductionStep,
  resolveActiveProductionStep,
} from '@/lib/workspace-resource/step-navigation'

/** Stable fallback so the overview query stays the only source of metadata. */
const EMPTY_STAGES: readonly ProductionStageView[] = PRODUCTION_STAGE_KEYS
  .map((key) => emptyProductionStageView(key))

function subscribeLastProductionStep(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

/**
 * Reads the last step selected by this user for this project. `storage` keeps
 * multiple tabs in sync; same-tab changes flow through the URL update.
 */
export function useLastProductionStep(projectId: string): ProductionStageKey | null {
  return useSyncExternalStore(
    subscribeLastProductionStep,
    () => readLastProductionStep(projectId),
    () => null,
  )
}

export interface ActiveProductionStepView {
  readonly activeStep: ProductionStageKey
  readonly requestedStep: string | null
  readonly stages: readonly ProductionStageView[]
  readonly overviewFetched: boolean
  readonly searchParamsValue: string
}

/**
 * Single derivation of the active step, shared by the step navigation and the
 * canvas create/upload target. Keeping one derivation guarantees that a file
 * created in the step view lands in the same folder the step view reads.
 */
export function useActiveProductionStep(projectId: string): ActiveProductionStepView {
  const overviewQuery = useProductionOverview(projectId)
  const searchParams = useSearchParams()
  const searchParamsValue = searchParams?.toString() ?? ''
  const requestedStep = new URLSearchParams(searchParamsValue)
    .get(PRODUCTION_STEP_QUERY_PARAM)
  const preferredStep = useLastProductionStep(projectId)
  const stages = overviewQuery.data?.stages ?? EMPTY_STAGES
  const activeStep = resolveActiveProductionStep({
    stages,
    requestedStep,
    preferredStep,
  })
  return {
    activeStep,
    requestedStep,
    stages,
    overviewFetched: overviewQuery.isFetched,
    searchParamsValue,
  }
}
