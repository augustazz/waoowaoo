'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import type { ProductionStepKey } from '@/lib/workspace-resource/production-stages'
import type { ProductionStepContentView } from '@/lib/workspace-resource/production-content'

/**
 * Artifacts of the active production step. Shares the workspaceResources key
 * prefix so the existing refresh/invalidation path updates the step view too.
 */
export function useProductionStepContent(projectId: string, stepKey: ProductionStepKey) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(projectId),
      'production-content',
      stepKey,
    ] as const,
    queryFn: async (): Promise<ProductionStepContentView> => {
      const response = await apiFetch(
        `/api/projects/${projectId}/content?step=${encodeURIComponent(stepKey)}`,
      )
      if (!response.ok) throw new Error('PRODUCTION_CONTENT_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly content: ProductionStepContentView
      }
      return body.content
    },
    enabled: Boolean(projectId && stepKey),
    staleTime: 3_000,
  })
}
