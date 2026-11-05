import { prisma } from '@/lib/prisma'
import type { WorkspaceResourceMediaType, WorkspaceResourceStatus } from './contracts'
import { readWorkspaceResourceRevision } from './projection-revision'
import {
  PRODUCTION_STAGE_SCHEMA_IDS,
  summarizeProductionStages,
  type ProductionOverviewView,
  type ProductionStageResourceRow,
} from './production-stages'

const STAGE_ITEM_LIMIT = 24

/**
 * Read-only stage summary for the Canvas stage rail. This intentionally reads
 * only lightweight identity/status columns instead of the full Resource View so
 * the rail stays cheap even for projects with large asset libraries.
 */
export async function readProductionOverview(input: {
  readonly userId: string
  readonly projectId: string
}): Promise<ProductionOverviewView> {
  const [revision, rows] = await Promise.all([
    readWorkspaceResourceRevision(input),
    prisma.workspaceResource.findMany({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        deletedAt: null,
        activePath: { not: null },
        resourceKind: 'file',
        schemaId: { in: [...PRODUCTION_STAGE_SCHEMA_IDS] },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        workspacePath: true,
        status: true,
        schemaId: true,
        mediaType: true,
        currentVersion: true,
        updatedAt: true,
      },
    }),
  ])
  return {
    revision,
    stages: summarizeProductionStages(rows.map((row): ProductionStageResourceRow => ({
      ...row,
      status: row.status as WorkspaceResourceStatus,
      mediaType: row.mediaType as WorkspaceResourceMediaType | null,
    })), {
      itemLimit: STAGE_ITEM_LIMIT,
    }),
  }
}
