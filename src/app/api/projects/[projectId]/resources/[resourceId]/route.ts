import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { readWorkspaceResource } from '@/lib/workspace-resource/view-service'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { readOperationRequestId } from '@/lib/operations/api-request-identity'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'

/**
 * Single-resource read: the only place the UI may load a resource's full
 * content (WR-13 keeps tree/search bounded to summaries).
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const resource = await readWorkspaceResource({
    projectId,
    userId: auth.session.user.id,
    resourceId,
  })
  return NextResponse.json({ success: true, resource })
})

/**
 * Canvas deletion adapter. The approved Resource identity and displayed path
 * are passed unchanged into the sole soft-delete Operation; the mutation
 * receipt is the browser Query handoff.
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const operationRequestId = readOperationRequestId(request, {
    required: true,
    operationId: 'delete_resource',
  })
  const workspacePath = request.nextUrl.searchParams.get('workspacePath')
  if (!workspacePath) {
    throw new ApiError('INVALID_PARAMS', { field: 'workspacePath' })
  }
  const approvalInputHash = stableArgsFingerprint({ resourceId, workspacePath })
  if (!operationRequestId.startsWith(`delete_resource:${approvalInputHash}:`)) {
    throw new ApiError('CONFLICT', {
      code: 'APPROVAL_GRANT_REQUEST_MISMATCH',
      operationId: 'delete_resource',
    })
  }
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'delete_resource',
    projectId,
    userId: auth.session.user.id,
    input: { resourceId, workspacePath },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
    requireIdempotencyKey: true,
  })
  return NextResponse.json(result)
})

/** Reversible workflow participation through the canonical mutation authority. */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const body: unknown = await request.json().catch(() => {
    throw new ApiError('INVALID_PARAMS', { field: 'workflowEnabled' })
  })
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !('workflowEnabled' in body)
    || typeof body.workflowEnabled !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', { field: 'workflowEnabled' })
  }
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'set_resource_workflow',
    projectId,
    userId: auth.session.user.id,
    input: { resourceId, workflowEnabled: body.workflowEnabled },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
    requireIdempotencyKey: true,
  })
  return NextResponse.json(result)
})
