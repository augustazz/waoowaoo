import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

const inputSchema = z.object({ expectedTaskId: z.string().trim().min(1) }).strict()

/** Replay a failed assembly through its canonical durable Operation. */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw new ApiError('INVALID_PARAMS', { field: 'expectedTaskId' })
  const result = await executeProjectAgentOperationFromApi({
    request, projectId, userId: auth.session.user.id, operationId: 'merge_videos',
    input: { request: { kind: 'retry', resourceId, expectedTaskId: parsed.data.expectedTaskId } },
    source: 'project-ui', requireIdempotencyKey: true,
  })
  return NextResponse.json(result)
})
