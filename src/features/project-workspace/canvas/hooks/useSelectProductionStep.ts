'use client'

import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePathname, useRouter } from '@/i18n/navigation'
import type { ProductionStageKey } from '@/lib/workspace-resource/production-stages'
import {
  PRODUCTION_STEP_QUERY_PARAM,
  writeLastProductionStep,
} from '@/lib/workspace-resource/step-navigation'

/**
 * Single entry point for an explicit step selection. Both the step pills and
 * folder navigation that lands inside a step folder use it, so the URL, the
 * remembered step, and every canvas consumer agree on the active step.
 */
export function useSelectProductionStep(projectId: string) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsValue = searchParams?.toString() ?? ''

  return useCallback((stepKey: ProductionStageKey) => {
    writeLastProductionStep(projectId, stepKey)
    const next = new URLSearchParams(searchParamsValue)
    next.set(PRODUCTION_STEP_QUERY_PARAM, stepKey)
    router.replace({
      pathname,
      query: Object.fromEntries(next.entries()),
    }, { scroll: false })
  }, [pathname, projectId, router, searchParamsValue])
}
