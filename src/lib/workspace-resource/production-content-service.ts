import { prisma } from '@/lib/prisma'
import type {
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
} from './contracts'
import {
  countProductionContentRows,
  productionEpisodeNumberFromPath,
  summarizeProductionStepContent,
  type ProductionContentResourceRow,
  type ProductionStepContentView,
} from './production-content'
import {
  PRODUCTION_EPISODE_FOLDER_PATHS,
  productionStageDefinition,
  productionStageForResource,
  type ProductionStageKey,
} from './production-stages'
import { readWorkspaceResourceRevision } from './projection-revision'

/**
 * A step view is a projection over the shared Resource tree. The cap keeps a
 * single project from materializing an unbounded list; the step panel is a
 * focused workspace, not a whole-project browser.
 */
const MAX_STEP_CONTENT_ROWS = 500
const MAX_EPISODE_SCAN_ROWS = 5_000

/**
 * Reads the artifacts owned by one production step.
 *
 * Ownership rule: a file belongs to the step when it lives under the step's
 * canonical folder, or when its schema is a step schema. Folder wins for
 * generic media (e.g. a generated image dropped into `资产/角色`), while the
 * schema fallback keeps existing documents visible before they are moved into
 * the convention folder.
 */
export async function readProductionStepContent(input: {
  readonly userId: string
  readonly projectId: string
  readonly stepKey: ProductionStageKey
}): Promise<ProductionStepContentView> {
  const definition = productionStageDefinition(input.stepKey)
  const folderPrefix = `${definition.defaultFolderPath}/`
  const baseWhere = {
    userId: input.userId,
    projectId: input.projectId,
    deletedAt: null,
    activePath: { not: null },
    resourceKind: 'file',
  } as const

  const [revision, rows, episodeRows] = await Promise.all([
    readWorkspaceResourceRevision(input),
    prisma.workspaceResource.findMany({
      where: {
        ...baseWhere,
        OR: [
          { schemaId: { in: [...definition.schemaIds] } },
          { workspacePath: { startsWith: folderPrefix } },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MAX_STEP_CONTENT_ROWS,
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
    definition.contentGrouping === 'episode'
      ? prisma.workspaceResource.findMany({
        where: {
          ...baseWhere,
          // Only episode-grouped step folders can name an episode. Scanning the
          // whole project pulled unrelated paths (e.g. `资产/角色/第01集/...`)
          // into the episode skeleton and was needlessly expensive.
          OR: PRODUCTION_EPISODE_FOLDER_PATHS.map((folderPath) => ({
            workspacePath: { startsWith: `${folderPath}/` },
          })),
        },
        take: MAX_EPISODE_SCAN_ROWS,
        select: { workspacePath: true },
      })
      : Promise.resolve([]),
  ])

  // Folder-first ownership: a schema match elsewhere is not enough when the
  // file lives in another step's folder.
  const ownedRows = rows.filter((row) => productionStageForResource(row) === input.stepKey)
  const versionKeys = ownedRows
    .filter((row) => row.currentVersion > 0)
    .map((row) => ({ resourceId: row.id, version: row.currentVersion }))
  const versions = versionKeys.length === 0 ? [] : await prisma.workspaceResourceVersion.findMany({
    where: { OR: versionKeys },
    select: {
      resourceId: true,
      version: true,
      contentKind: true,
      media: { select: { publicId: true } },
    },
  })
  const previewByKey = new Map(
    versions
      .filter((version) => version.contentKind === 'media')
      .map((version) => [
        `${version.resourceId}:${String(version.version)}`,
        `/m/${encodeURIComponent(version.media.publicId)}`,
      ] as const),
  )

  const contentRows: ProductionContentResourceRow[] = ownedRows.map((row) => ({
    ...row,
    status: row.status as WorkspaceResourceStatus,
    mediaType: row.mediaType as WorkspaceResourceMediaType | null,
    previewUrl: previewByKey.get(`${row.id}:${String(row.currentVersion)}`) ?? null,
  }))

  const knownEpisodeNumbers = new Set<number>()
  for (const row of episodeRows) {
    const episode = productionEpisodeNumberFromPath(row.workspacePath)
    if (episode !== null) knownEpisodeNumbers.add(episode)
  }

  return {
    stepKey: input.stepKey,
    folderPath: definition.defaultFolderPath,
    grouping: definition.contentGrouping,
    revision,
    counts: countProductionContentRows(contentRows),
    groups: summarizeProductionStepContent({
      grouping: definition.contentGrouping,
      rows: contentRows,
      knownEpisodeNumbers: [...knownEpisodeNumbers],
    }),
  }
}
