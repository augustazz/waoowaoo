import { prisma } from '@/lib/prisma'
import type { WorkspaceResourceInputRef, WorkspaceResourceMediaType } from './contracts'

export interface ResolvedWorkspaceResourceInputMedia {
  readonly reference: WorkspaceResourceInputRef
  readonly mediaId: string
  readonly storageKey: string
  readonly mimeType: string | null
  readonly width: number | null
  readonly height: number | null
  readonly durationMs: number | null
  readonly sizeBytes: number | null
}

/**
 * Resolve provider inputs by the frozen Resource version, never by a Resource's
 * current version. Rename/move and later edits therefore cannot change an
 * already approved production plan.
 */
export async function resolveWorkspaceResourceInputMedia(input: {
  readonly userId: string
  readonly projectId: string
  readonly references: readonly WorkspaceResourceInputRef[]
  readonly expectedMediaType: WorkspaceResourceMediaType
}): Promise<readonly ResolvedWorkspaceResourceInputMedia[]> {
  if (input.references.length === 0) return []
  const versions = await prisma.workspaceResourceVersion.findMany({
    where: {
      OR: input.references.map((reference) => ({
        resourceId: reference.resourceId,
        version: reference.contentVersion,
      })),
    },
    include: {
      resource: { select: { userId: true, projectId: true, resourceKind: true, mediaType: true } },
      media: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, width: true, height: true, durationMs: true } },
    },
  })
  const byKey = new Map(versions.map((version) => [
    `${version.resourceId}:${String(version.version)}`,
    version,
  ]))
  return input.references.map((reference) => {
    const version = byKey.get(`${reference.resourceId}:${String(reference.contentVersion)}`)
    if (
      !version
      || version.resource.userId !== input.userId
      || version.resource.projectId !== input.projectId
      || version.resource.resourceKind !== 'file'
      || version.resource.mediaType !== input.expectedMediaType
      || version.contentKind !== 'media'
    ) {
      throw new Error(
        `WORKSPACE_RESOURCE_INPUT_VERSION_INVALID:${reference.resourceId}:${String(reference.contentVersion)}`,
      )
    }
    return {
      reference,
      mediaId: version.media.id,
      storageKey: version.media.storageKey,
      mimeType: version.media.mimeType,
      width: version.media.width,
      height: version.media.height,
      durationMs: version.media.durationMs,
      sizeBytes: version.media.sizeBytes == null ? null : Number(version.media.sizeBytes),
    }
  })
}
