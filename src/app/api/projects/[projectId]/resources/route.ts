import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
  WORKSPACE_RESOURCE_TREE_SCOPES,
  type WorkspaceResourceTreeScope,
} from '@/lib/workspace-resource/contracts'
import {
  isProductionStageKey,
  type ProductionStageKey,
} from '@/lib/workspace-resource/production-stages'
import { listWorkspaceResourceTreePage } from '@/lib/workspace-resource/view-service'

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new ApiError('INVALID_PARAMS', { field: 'limit' })
  }
  return parsed
}

function parseScope(value: string | null): WorkspaceResourceTreeScope | undefined {
  if (value === null) return undefined
  const scope = WORKSPACE_RESOURCE_TREE_SCOPES.find((candidate) => candidate === value)
  if (!scope) throw new ApiError('INVALID_PARAMS', { field: 'scope' })
  return scope
}

function parseStep(value: string | null): ProductionStageKey | undefined {
  if (value === null) return undefined
  if (!isProductionStageKey(value)) throw new ApiError('INVALID_PARAMS', { field: 'step' })
  return value
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const page = await listWorkspaceResourceTreePage({
    projectId,
    userId: auth.session.user.id,
    prefix: request.nextUrl.searchParams.get('prefix'),
    search: request.nextUrl.searchParams.get('search'),
    cursor: request.nextUrl.searchParams.get('cursor'),
    limit: parseLimit(request.nextUrl.searchParams.get('limit')),
    includeDisabled: request.nextUrl.searchParams.get('includeDisabled') === 'true',
    deleted: request.nextUrl.searchParams.get('deleted') === 'true',
    scope: parseScope(request.nextUrl.searchParams.get('scope')),
    step: parseStep(request.nextUrl.searchParams.get('step')),
  })
  return NextResponse.json({ success: true, page })
})
