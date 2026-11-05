import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { listWorkspaceResourceVersions } from '@/lib/workspace-resource/version-service'

/**
 * GET /api/projects/[projectId]/resources/[resourceId]/versions
 * Immutable version history for a text document, newest first.
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const versions = await listWorkspaceResourceVersions({
    projectId,
    userId: auth.session.user.id,
    resourceId,
  })
  return NextResponse.json({ success: true, versions })
})
