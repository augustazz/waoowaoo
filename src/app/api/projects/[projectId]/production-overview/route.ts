import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { readProductionOverview } from '@/lib/workspace-resource/production-overview-service'

/**
 * GET /api/projects/[projectId]/production-overview
 * Grouped Stage counts for the Canvas stage rail. A read-only projection; it
 * never implies a required order or advances the project's stage.
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const overview = await readProductionOverview({
    projectId,
    userId: auth.session.user.id,
  })
  return NextResponse.json({ success: true, overview })
})
