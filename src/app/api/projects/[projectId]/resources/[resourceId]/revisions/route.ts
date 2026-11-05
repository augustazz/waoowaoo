import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { readOperationRequestId } from '@/lib/operations/api-request-identity'

/**
 * POST /api/projects/[projectId]/resources/[resourceId]/revisions
 * Appends one immutable version through the revise_project_document Operation.
 * The expectedContentVersion makes concurrent edits fail explicitly instead of
 * silently overwriting a newer version.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const operationRequestId = readOperationRequestId(request, {
    required: true,
    operationId: 'revise_project_document',
  })
  if (!operationRequestId.startsWith(`revise_project_document:${resourceId}:`)) {
    throw new ApiError('CONFLICT', {
      code: 'APPROVAL_GRANT_REQUEST_MISMATCH',
      operationId: 'revise_project_document',
    })
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', { field: 'body' })
  }
  if (typeof body.resourceId === 'string' && body.resourceId !== resourceId) {
    throw new ApiError('INVALID_PARAMS', { field: 'resourceId' })
  }
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'revise_project_document',
    projectId,
    userId: auth.session.user.id,
    input: { ...body, resourceId },
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
    requireIdempotencyKey: true,
  })
  return NextResponse.json(result)
})
