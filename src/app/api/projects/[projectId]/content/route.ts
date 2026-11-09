import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { readProductionStepContent } from '@/lib/workspace-resource/production-content-service'
import { isProductionStageKey } from '@/lib/workspace-resource/production-stages'

/**
 * GET /api/projects/[projectId]/content?step=script
 *
 * Read-only projection of one production step's artifacts. The same Resource
 * rows back the "all files" canvas view; this route only filters and groups
 * them, and never persists step state.
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const step = request.nextUrl.searchParams.get('step')
  if (!isProductionStageKey(step)) {
    throw new ApiError('INVALID_PARAMS', { field: 'step' })
  }
  const content = await readProductionStepContent({
    projectId,
    userId: auth.session.user.id,
    stepKey: step,
  })
  return NextResponse.json({ success: true, content })
})
