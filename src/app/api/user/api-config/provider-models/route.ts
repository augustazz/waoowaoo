import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const POST = apiHandler(async (request: NextRequest) => {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  let body: unknown
  try { body = await request.json() } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'BODY_PARSE_FAILED', field: 'body' })
  }
  const result = await executeProjectAgentOperationFromApi({
    request, operationId: 'api_user_api_config_list_provider_models', projectId: 'system',
    userId: auth.session.user.id, input: body, source: 'api-config',
  })
  return NextResponse.json(result)
})
