'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import type { WorkspaceResourceTreePage, WorkspaceResourceTreeScope } from '@/lib/workspace-resource/contracts'
import type { ProductionStageKey } from '@/lib/workspace-resource/production-stages'
import { queryKeys } from '@/lib/query/keys'

export function useWorkspaceResources(input: {
  readonly projectId: string
  readonly prefix: string | null
  readonly search: string | null
  readonly scope?: WorkspaceResourceTreeScope
  readonly enabled?: boolean
  /** Restrict the page to one production step's owned artifacts. */
  readonly step?: ProductionStageKey | null
  /** Optional one-shot UI identity when the caller must bypass a prior cached lookup. */
  readonly refreshToken?: string | null
}) {
  return useInfiniteQuery({
    queryKey: [
      ...queryKeys.project.workspaceResources(input.projectId),
      input.prefix,
      input.search,
      input.scope ?? 'children',
      input.step ?? null,
      input.refreshToken ?? null,
    ] as const,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<WorkspaceResourceTreePage> => {
      const search = new URLSearchParams({ limit: '200', includeDisabled: 'true' })
      if (input.prefix) search.set('prefix', input.prefix)
      if (input.search) search.set('search', input.search)
      if (input.scope) search.set('scope', input.scope)
      if (input.step) search.set('step', input.step)
      if (pageParam) search.set('cursor', pageParam)
      const response = await apiFetch(`/api/projects/${input.projectId}/resources?${search.toString()}`)
      if (!response.ok) throw new Error('WORKSPACE_RESOURCES_LOAD_FAILED')
      const body = await response.json() as {
        readonly success: true
        readonly page: WorkspaceResourceTreePage
      }
      return body.page
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(input.projectId) && (input.enabled ?? true),
    staleTime: 2_000,
  })
}
