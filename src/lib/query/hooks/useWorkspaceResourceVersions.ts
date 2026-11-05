'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { queryKeys } from '@/lib/query/keys'
import type {
  WorkspaceResourceVersionDetailView,
  WorkspaceResourceVersionSummaryView,
} from '@/lib/workspace-resource/contracts'

export function useWorkspaceResourceVersions(input: {
  readonly projectId: string
  readonly resourceId: string | null
  readonly enabled?: boolean
}) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(input.projectId),
      'versions',
      input.resourceId,
    ] as const,
    queryFn: async (): Promise<readonly WorkspaceResourceVersionSummaryView[]> => {
      const response = await apiFetch(
        `/api/projects/${input.projectId}/resources/${input.resourceId ?? ''}/versions`,
      )
      if (!response.ok) throw new Error('WORKSPACE_RESOURCE_VERSIONS_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly versions: readonly WorkspaceResourceVersionSummaryView[]
      }
      return body.versions
    },
    enabled: Boolean(input.projectId && input.resourceId) && (input.enabled ?? true),
    staleTime: 3_000,
  })
}

export function useWorkspaceResourceVersion(input: {
  readonly projectId: string
  readonly resourceId: string | null
  readonly version: number | null
  readonly enabled?: boolean
}) {
  return useQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(input.projectId),
      'versions',
      input.resourceId,
      input.version,
    ] as const,
    queryFn: async (): Promise<WorkspaceResourceVersionDetailView | null> => {
      const response = await apiFetch(
        `/api/projects/${input.projectId}/resources/${input.resourceId ?? ''}/versions/${String(input.version ?? '')}`,
      )
      if (!response.ok) throw new Error('WORKSPACE_RESOURCE_VERSION_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly version: WorkspaceResourceVersionDetailView
      }
      return body.version
    },
    enabled: Boolean(input.projectId && input.resourceId && input.version) && (input.enabled ?? true),
    staleTime: 3_000,
  })
}
