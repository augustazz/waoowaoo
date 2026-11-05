import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readWorkspaceResourceTextContent } from './content-store'
import type {
  WorkspaceResourceContent,
  WorkspaceResourceJsonValue,
  WorkspaceResourceVersionDetailView,
  WorkspaceResourceVersionSummaryView,
} from './contracts'

const MAX_VERSIONS = 100

const versionSelect = {
  version: true,
  contentKind: true,
  contentPreview: true,
  sha256: true,
  sizeBytes: true,
  sourceTurnId: true,
  createdAt: true,
  media: {
    select: {
      id: true,
      publicId: true,
      storageKey: true,
      mimeType: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
} satisfies Prisma.WorkspaceResourceVersionSelect

type VersionRow = Prisma.WorkspaceResourceVersionGetPayload<{ select: typeof versionSelect }>

function safeSize(value: bigint | null): number {
  if (value === null) return 0
  const size = Number(value)
  if (!Number.isSafeInteger(size)) throw new Error('WORKSPACE_RESOURCE_VERSION_SIZE_INVALID')
  return size
}

function summary(row: VersionRow): WorkspaceResourceVersionSummaryView {
  if (row.contentKind !== 'text' && row.contentKind !== 'structured' && row.contentKind !== 'media') {
    throw new Error(`WORKSPACE_RESOURCE_VERSION_CONTENT_KIND_INVALID:${row.contentKind}`)
  }
  return {
    version: row.version,
    contentKind: row.contentKind,
    contentPreview: row.contentPreview,
    sha256: row.sha256,
    sizeBytes: safeSize(row.sizeBytes),
    sourceTurnId: row.sourceTurnId,
    createdAt: row.createdAt.toISOString(),
  }
}

async function versionContent(row: VersionRow): Promise<WorkspaceResourceContent> {
  if (row.contentKind === 'media') {
    return {
      kind: 'media',
      mediaId: row.media.id,
      url: `/m/${encodeURIComponent(row.media.publicId)}`,
      mimeType: row.media.mimeType,
      width: row.media.width,
      height: row.media.height,
      durationMs: row.media.durationMs,
    }
  }
  const text = await readWorkspaceResourceTextContent(row.media.storageKey)
  if (row.contentKind === 'text') return { kind: 'text', text }
  return { kind: 'structured', data: JSON.parse(text) as WorkspaceResourceJsonValue }
}

async function requireTextResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
}) {
  const resource = await prisma.workspaceResource.findFirst({
    where: {
      id: input.resourceId,
      projectId: input.projectId,
      userId: input.userId,
      deletedAt: null,
    },
    select: { id: true, mediaType: true, currentVersion: true },
  })
  if (!resource || resource.mediaType !== 'text') {
    throw new Error('WORKSPACE_RESOURCE_TEXT_NOT_FOUND')
  }
  return resource
}

export async function listWorkspaceResourceVersions(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
}): Promise<readonly WorkspaceResourceVersionSummaryView[]> {
  await requireTextResource(input)
  const rows = await prisma.workspaceResourceVersion.findMany({
    where: { resourceId: input.resourceId },
    orderBy: { version: 'desc' },
    take: MAX_VERSIONS,
    select: versionSelect,
  })
  return rows.map(summary)
}

export async function readWorkspaceResourceVersion(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
  readonly version: number
}): Promise<WorkspaceResourceVersionDetailView | null> {
  await requireTextResource(input)
  const row = await prisma.workspaceResourceVersion.findUnique({
    where: {
      resourceId_version: {
        resourceId: input.resourceId,
        version: input.version,
      },
    },
    select: versionSelect,
  })
  if (!row) return null
  return {
    ...summary(row),
    content: await versionContent(row),
  }
}
