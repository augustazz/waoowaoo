'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import type { ProductionOverviewView } from '@/lib/workspace-resource/production-stages'

/**
 * Derived production Stage counts. Kept under the workspaceResources key
 * prefix so the existing refresh/invalidation path also refreshes the rail.
 */
export function useProductionOverview(projectId: string) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(projectId),
      'production-overview',
    ] as const,
    queryFn: async (): Promise<ProductionOverviewView> => {
      const response = await apiFetch(`/api/projects/${projectId}/production-overview`)
      if (!response.ok) throw new Error('PRODUCTION_OVERVIEW_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly overview: ProductionOverviewView
      }
      return body.overview
    },
    enabled: Boolean(projectId),
    staleTime: 3_000,
  })
}
