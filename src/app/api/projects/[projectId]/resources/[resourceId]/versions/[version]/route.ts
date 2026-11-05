import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { readWorkspaceResourceVersion } from '@/lib/workspace-resource/version-service'

/**
 * GET /api/projects/[projectId]/resources/[resourceId]/versions/[version]
 * Full content of one immutable version for comparison or restore.
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string; version: string }> },
) => {
  const { projectId, resourceId, version: versionParam } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const version = Number(versionParam)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ApiError('INVALID_PARAMS', { field: 'version' })
  }
  const detail = await readWorkspaceResourceVersion({
    projectId,
    userId: auth.session.user.id,
    resourceId,
    version,
  })
  if (!detail) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_RESOURCE_VERSION_NOT_FOUND' })
  return NextResponse.json({ success: true, version: detail })
})
