import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  let input: unknown
  try {
    input = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'BODY_PARSE_FAILED', field: 'body' })
  }
  const result = await executeProjectAgentOperationFromApi({
    request,
    projectId,
    userId: auth.session.user.id,
    operationId: 'update_project_config',
    input,
    source: 'project-ui',
    responseContract: 'operation_mutation_response_v1',
  })
  return NextResponse.json(result)
})
