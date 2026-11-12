import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { hasProviderFailureEvidence, parseFailureRecord } from '@/lib/errors/failure'
import { resolvePublicModelName } from '@/lib/ai-exec/model-presentation'
import { readWorkspaceResourceTextContent } from './content-store'
import type {
  WorkspaceResourceActionView,
  WorkspaceResourceAlternativeGroupView,
  WorkspaceResourceAlternativeMemberView,
  WorkspaceResourceAncestorView,
  WorkspaceResourceContent,
  WorkspaceResourceInputRef,
  WorkspaceResourceInputSummary,
  WorkspaceResourceJsonObject,
  WorkspaceResourceJsonValue,
  WorkspaceResourceKind,
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
  WorkspaceResourceSummaryView,
  WorkspaceResourceTreePage,
  WorkspaceResourceTreeScope,
  WorkspaceResourceVersionView,
  WorkspaceResourceView,
} from './contracts'
import {
  isWorkspaceResourceKind,
  isWorkspaceResourceMediaType,
  isWorkspaceResourceStatus,
} from './contracts'
import {
  isWorkspaceSubtreePath,
  parentWorkspacePath,
  validateWorkspaceResourceFolderPath,
  workspaceResourceDisplayName,
  workspacePathAncestors,
} from './path'
import { resolveActiveWorkspaceResourceByPath } from './persistence'
import {
  productionStageDefinition,
  productionStageFolderPaths,
  productionStageForResource,
  type ProductionStageKey,
} from './production-stages'
import { readWorkspaceResourceRevision } from './projection-revision'
import { projectWorkspaceResourceRegenerationAction } from './regeneration-projection'
import { projectOrderedReferenceInputs } from './reference-projection'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 200
const MAX_RUNTIME_RESOURCES = 5_000

const resourceSelect = {
  id: true,
  projectId: true,
  workspacePath: true,
  resourceKind: true,
  mediaType: true,
  schemaId: true,
  name: true,
  status: true,
  workflowEnabled: true,
  currentVersion: true,
  prompt: true,
  modelKey: true,
  generationOptions: true,
  operationId: true,
  memberIndex: true,
  alternativeGroupExecutionId: true,
  taskId: true,
  task: { select: { failure: true, payload: true } },
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkspaceResourceSelect

type ResourceRow = Prisma.WorkspaceResourceGetPayload<{ select: typeof resourceSelect }>

const versionInclude = {
  posterMedia: { select: { publicId: true } },
  media: {
    select: {
      id: true,
      publicId: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
} satisfies Prisma.WorkspaceResourceVersionInclude

type VersionRow = Prisma.WorkspaceResourceVersionGetPayload<{ include: typeof versionInclude }>

function requireResourceKind(value: string): WorkspaceResourceKind {
  if (!isWorkspaceResourceKind(value)) throw new Error(`WORKSPACE_RESOURCE_KIND_INVALID:${value}`)
  return value
}

function requireMediaType(value: string | null): WorkspaceResourceMediaType | null {
  if (value === null) return null
  if (!isWorkspaceResourceMediaType(value)) throw new Error(`WORKSPACE_RESOURCE_MEDIA_TYPE_INVALID:${value}`)
  return value
}

function requireStatus(value: string): WorkspaceResourceStatus {
  if (!isWorkspaceResourceStatus(value)) throw new Error(`WORKSPACE_RESOURCE_STATUS_INVALID:${value}`)
  return value
}

function safeNumber(value: bigint | null): number {
  if (value === null) return 0
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error('WORKSPACE_RESOURCE_SIZE_INVALID')
  return number
}

function jsonProjection(value: Prisma.JsonValue | null): WorkspaceResourceJsonValue | null {
  if (value === null) return null
  return value as WorkspaceResourceJsonValue
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
      posterUrl: row.posterMedia ? `/m/${encodeURIComponent(row.posterMedia.publicId)}` : null,
    }
  }
  const content = await readWorkspaceResourceTextContent(row.media.storageKey)
  if (row.contentKind === 'text') return { kind: 'text', text: content }
  if (row.contentKind === 'structured') {
    return { kind: 'structured', data: JSON.parse(content) as WorkspaceResourceJsonValue }
  }
  throw new Error(`WORKSPACE_RESOURCE_CONTENT_KIND_INVALID:${row.contentKind}`)
}

function previewUrl(version: VersionRow | undefined): string | null {
  return version?.contentKind === 'media'
    ? `/m/${encodeURIComponent(version.media.publicId)}`
    : null
}

function projectActions(input: {
  readonly resource: ResourceRow
  readonly current: VersionRow | undefined
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly inputs: readonly WorkspaceResourceInputSummary[]
}): readonly WorkspaceResourceActionView[] {
  const deleteAction: WorkspaceResourceActionView = {
    kind: 'delete',
    enabled: input.resource.status !== 'pending',
    operationId: 'delete_resource',
    input: {
      resourceId: input.resource.id,
      workspacePath: input.resource.workspacePath,
    },
    href: null,
    approvalInputHash: stableArgsFingerprint({
      resourceId: input.resource.id,
      workspacePath: input.resource.workspacePath,
    }),
  }
  if (input.resource.resourceKind === 'folder') return [deleteAction]
  const downloadHref = previewUrl(input.current)
  const failed = (
    input.resource.status === 'failed'
    || input.resource.status === 'canceled'
  )
  const retryOperationId = !failed ? null
    : input.resource.operationId === 'generate_voice'
      || input.resource.operationId === 'create_image'
      || input.resource.operationId === 'create_audio'
      || input.resource.operationId === 'create_video'
      || input.resource.operationId === 'merge_videos'
      ? input.resource.operationId
      : input.resource.operationId === 'rerun_failed_production_items'
        ? 'rerun_failed_production_items'
        : null
  const retryInput: WorkspaceResourceJsonObject | null = retryOperationId === 'rerun_failed_production_items'
    ? { resourceIds: [input.resource.id] }
    : retryOperationId === 'merge_videos'
      ? { request: { kind: 'retry', resourceId: input.resource.id, expectedTaskId: input.resource.taskId } }
    : retryOperationId
      ? { request: { kind: 'retry', resourceIds: [input.resource.id] } }
      : null
  return [
    {
      kind: 'toggle_workflow',
      enabled: input.resource.status !== 'pending' && input.resource.deletedAt === null,
      operationId: 'set_resource_workflow',
      input: { resourceId: input.resource.id, workflowEnabled: !input.resource.workflowEnabled },
      href: null,
      approvalInputHash: null,
    },
    {
      kind: 'retry',
      enabled: retryOperationId !== null && input.resource.workflowEnabled && input.resource.deletedAt === null && Boolean(input.resource.taskId),
      operationId: retryOperationId,
      input: retryInput,
      href: null,
      approvalInputHash: null,
    },
    (() => {
      const regenerate = projectWorkspaceResourceRegenerationAction({
        resourceId: input.resource.id,
        workspacePath: input.resource.workspacePath,
        mediaType: input.mediaType,
        schemaId: input.resource.schemaId,
        status: input.resource.status,
        workflowEnabled: input.resource.workflowEnabled && input.resource.deletedAt === null,
        currentVersion: input.resource.currentVersion,
        prompt: input.resource.prompt,
        modelKey: input.resource.modelKey,
        generationOptions: jsonProjection(input.resource.generationOptions),
        inputs: input.inputs.map((reference) => ({
          resourceId: reference.resourceId,
          workflowEnabled: reference.workflowEnabled,
          contentVersion: reference.contentVersion,
          role: reference.role,
          mediaType: reference.mediaType,
          position: reference.position,
          channel: reference.channel,
          purpose: reference.purpose,
        })),
        taskPayload: input.resource.task?.payload ?? null,
      })
      return {
        kind: 'regenerate' as const,
        enabled: regenerate !== null,
        operationId: regenerate?.operationId ?? null,
        input: regenerate?.input ?? null,
        href: null,
        approvalInputHash: null,
      }
    })(),
    {
      kind: 'download',
      enabled: downloadHref !== null,
      operationId: null,
      input: null,
      href: downloadHref,
      approvalInputHash: null,
    },
    deleteAction,
  ]
}

function projectAncestors(
  workspacePath: string,
  folderByPath: ReadonlyMap<string, ResourceRow>,
): readonly WorkspaceResourceAncestorView[] {
  return workspacePathAncestors(workspacePath).map((ancestorPath) => {
    const folder = folderByPath.get(ancestorPath)
    if (!folder) throw new Error(`WORKSPACE_RESOURCE_ANCESTOR_FOLDER_MISSING:${ancestorPath}`)
    return {
      resourceId: folder.id,
      name: workspaceResourceDisplayName({
        workspacePath: folder.workspacePath,
        resourceId: folder.id,
        resourceKind: 'folder',
      }),
      workspacePath: folder.workspacePath,
    }
  })
}

async function loadViews(
  rows: readonly ResourceRow[],
  options: { readonly includeContent: boolean },
): Promise<WorkspaceResourceView[]> {
  if (rows.length === 0) return []
  const versionKeys = rows
    .filter((row) => row.resourceKind === 'file' && row.currentVersion > 0)
    .map((row) => ({ resourceId: row.id, version: row.currentVersion }))
  const lineage = versionKeys.length === 0 ? [] : await prisma.workspaceResourceLineage.findMany({
    where: { OR: versionKeys.map((entry) => ({ outputResourceId: entry.resourceId, outputVersion: entry.version })) },
    orderBy: [{ outputResourceId: 'asc' }, { outputVersion: 'asc' }, { position: 'asc' }],
  })
  const inputVersionKeys = lineage.map((entry) => ({ resourceId: entry.inputResourceId, version: entry.inputVersion }))
  const alternativeGroupIds = Array.from(new Set(
    rows.map((row) => row.alternativeGroupExecutionId).filter((value): value is string => Boolean(value)),
  ))
  const siblings = alternativeGroupIds.length === 0 ? [] : await prisma.workspaceResource.findMany({
    where: { alternativeGroupExecutionId: { in: alternativeGroupIds } },
    orderBy: [{ alternativeGroupExecutionId: 'asc' }, { memberIndex: 'asc' }, { id: 'asc' }],
    select: resourceSelect,
  })
  const siblingVersionKeys = siblings
    .filter((row) => row.resourceKind === 'file' && row.currentVersion > 0)
    .map((row) => ({ resourceId: row.id, version: row.currentVersion }))
  const allVersionKeys = [...versionKeys, ...inputVersionKeys, ...siblingVersionKeys]
  const versionIdentity = new Map(allVersionKeys.map((entry) => [`${entry.resourceId}:${String(entry.version)}`, entry]))
  const versions = versionIdentity.size === 0 ? [] : await prisma.workspaceResourceVersion.findMany({
    where: { OR: [...versionIdentity.values()] },
    include: versionInclude,
  })
  const versionByKey = new Map(versions.map((version) => [`${version.resourceId}:${String(version.version)}`, version]))
  const inputIds = Array.from(new Set(lineage.map((entry) => entry.inputResourceId)))
  const inputResources = inputIds.length === 0 ? [] : await prisma.workspaceResource.findMany({
    where: { id: { in: inputIds } },
    select: resourceSelect,
  })
  const inputById = new Map(inputResources.map((resource) => [resource.id, resource]))
  const projectIds = Array.from(new Set(rows.map((row) => row.projectId)))
  const folders = await prisma.workspaceResource.findMany({
    where: { projectId: { in: projectIds }, resourceKind: 'folder' },
    orderBy: [{ deletedAt: 'asc' }, { updatedAt: 'desc' }],
    select: resourceSelect,
  })
  const folderByProjectPath = new Map<string, ResourceRow>()
  for (const folder of folders) {
    const key = `${folder.projectId}:${folder.workspacePath}`
    if (!folderByProjectPath.has(key) || folder.deletedAt === null) folderByProjectPath.set(key, folder)
  }
  const summariesByOutput = new Map<string, WorkspaceResourceInputSummary[]>()
  for (const entry of lineage) {
    const key = `${entry.outputResourceId}:${String(entry.outputVersion)}`
    const source = inputById.get(entry.inputResourceId)
    if (!source || source.resourceKind !== 'file') {
      throw new Error(`WORKSPACE_RESOURCE_LINEAGE_INPUT_INVALID:${entry.inputResourceId}`)
    }
    const mediaType = requireMediaType(source.mediaType)
    if (!mediaType) throw new Error(`WORKSPACE_RESOURCE_LINEAGE_INPUT_MEDIA_MISSING:${source.id}`)
    const ref: WorkspaceResourceInputRef = {
      resourceId: entry.inputResourceId,
      contentVersion: entry.inputVersion,
      workspacePath: source.workspacePath,
      role: entry.role,
      position: entry.position,
    }
    const inputVersion = versionByKey.get(`${entry.inputResourceId}:${String(entry.inputVersion)}`)
    summariesByOutput.set(key, [
      ...(summariesByOutput.get(key) ?? []),
      {
        ...ref,
        resourceKind: 'file',
        workflowEnabled: source.workflowEnabled,
        mediaType,
        schemaId: source.schemaId,
        name: workspaceResourceDisplayName({
          workspacePath: source.workspacePath,
          resourceId: source.id,
        }),
        previewUrl: previewUrl(inputVersion),
        posterUrl: inputVersion?.posterMedia ? `/m/${encodeURIComponent(inputVersion.posterMedia.publicId)}` : null,
        durationMs: inputVersion?.contentKind === 'media' ? inputVersion.media.durationMs : null,
      },
    ])
  }
  const alternativeMembersByGroup = new Map<string, WorkspaceResourceAlternativeMemberView[]>()
  for (const sibling of siblings) {
    const groupId = sibling.alternativeGroupExecutionId
    if (!groupId || sibling.memberIndex === null) continue
    const member: WorkspaceResourceAlternativeMemberView = {
      resourceId: sibling.id,
      workspacePath: sibling.workspacePath,
      name: workspaceResourceDisplayName({
        workspacePath: sibling.workspacePath,
        resourceId: sibling.id,
      }),
      schemaId: sibling.schemaId,
      mediaType: requireMediaType(sibling.mediaType),
      status: requireStatus(sibling.status),
      workflowEnabled: sibling.workflowEnabled,
      memberIndex: sibling.memberIndex,
      previewUrl: previewUrl(versionByKey.get(`${sibling.id}:${String(sibling.currentVersion)}`)),
      posterUrl: (() => {
        const poster = versionByKey.get(`${sibling.id}:${String(sibling.currentVersion)}`)?.posterMedia
        return poster ? `/m/${encodeURIComponent(poster.publicId)}` : null
      })(),
    }
    alternativeMembersByGroup.set(groupId, [...(alternativeMembersByGroup.get(groupId) ?? []), member])
  }
  return await Promise.all(rows.map(async (row): Promise<WorkspaceResourceView> => {
    const resourceKind = requireResourceKind(row.resourceKind)
    const mediaType = requireMediaType(row.mediaType)
    if ((resourceKind === 'folder') !== (mediaType === null)) {
      throw new Error(`WORKSPACE_RESOURCE_KIND_MEDIA_MISMATCH:${row.id}`)
    }
    const folderByPath = new Map<string, ResourceRow>()
    for (const ancestorPath of workspacePathAncestors(row.workspacePath)) {
      const folder = folderByProjectPath.get(`${row.projectId}:${ancestorPath}`)
      if (folder) folderByPath.set(ancestorPath, folder)
    }
    const ancestors = projectAncestors(row.workspacePath, folderByPath)
    const version = resourceKind === 'file' && row.currentVersion > 0
      ? versionByKey.get(`${row.id}:${String(row.currentVersion)}`)
      : undefined
    if (resourceKind === 'file' && row.currentVersion > 0 && !version) {
      throw new Error(`WORKSPACE_RESOURCE_VERSION_MISSING:${row.id}:${String(row.currentVersion)}`)
    }
    const current: WorkspaceResourceVersionView | null = version ? {
      version: version.version,
      content: options.includeContent ? await versionContent(version) : null,
      sha256: version.sha256,
      sizeBytes: safeNumber(version.sizeBytes),
      createdAt: version.createdAt.toISOString(),
    } : null
    const lineageKey = `${row.id}:${String(row.currentVersion)}`
    const inputSummaries = projectOrderedReferenceInputs(summariesByOutput.get(lineageKey) ?? [], row.task?.payload, row.generationOptions)
    const groupMembers = row.alternativeGroupExecutionId
      ? alternativeMembersByGroup.get(row.alternativeGroupExecutionId) ?? []
      : []
    const alternativeGroup: WorkspaceResourceAlternativeGroupView | null = row.alternativeGroupExecutionId
      ? { groupId: row.alternativeGroupExecutionId, total: groupMembers.length, members: groupMembers }
      : null
    const summary: WorkspaceResourceSummaryView = resourceKind === 'folder'
      ? { kind: 'folder' }
      : !version
        ? { kind: 'empty' }
        : version.contentKind === 'media'
          ? {
              kind: 'media',
              url: `/m/${encodeURIComponent(version.media.publicId)}`,
              mimeType: version.media.mimeType,
              width: version.media.width,
              height: version.media.height,
              durationMs: version.media.durationMs,
              posterUrl: version.posterMedia ? `/m/${encodeURIComponent(version.posterMedia.publicId)}` : null,
            }
          : version.contentKind === 'structured'
            ? { kind: 'structured', preview: version.contentPreview }
            : { kind: 'text', preview: version.contentPreview }
    return {
      resourceId: row.id,
      projectId: row.projectId,
      resourceKind,
      workspacePath: row.workspacePath,
      ancestors,
      mediaType,
      schemaId: row.schemaId,
      name: workspaceResourceDisplayName({
        workspacePath: row.workspacePath,
        resourceId: row.id,
        resourceKind,
      }),
      status: requireStatus(row.status),
      workflowEnabled: row.workflowEnabled,
      contentVersion: resourceKind === 'folder' ? 0 : row.currentVersion,
      current,
      summary,
      prompt: row.prompt,
      modelName: resolvePublicModelName(row.modelKey),
      generationOptions: jsonProjection(row.generationOptions),
      operationId: row.operationId,
      memberIndex: row.memberIndex,
      alternativeGroupExecutionId: row.alternativeGroupExecutionId,
      alternativeGroup,
      inputs: inputSummaries.map(({ resourceId, contentVersion, workspacePath, role, position, channel, purpose }) => ({
        resourceId, contentVersion, workspacePath, role, position, channel, ...(purpose ? { purpose } : {}),
      })),
      inputSummaries,
      actions: projectActions({
        resource: row,
        current: version,
        mediaType,
        inputs: inputSummaries,
      }),
      taskId: row.taskId,
      error: (() => {
        const failure = parseFailureRecord(row.task?.failure)
        return failure
          ? {
              code: failure.interpretation.code,
              diagnostic: hasProviderFailureEvidence(failure)
                ? failure.native.message
                : null,
            }
          : null
      })(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }))
}

function requireLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error('WORKSPACE_RESOURCE_PAGE_LIMIT_INVALID')
  }
  return limit
}

type Cursor = { readonly workspacePath: string; readonly id: string }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>
    if (typeof parsed.workspacePath === 'string' && typeof parsed.id === 'string') {
      return { workspacePath: parsed.workspacePath, id: parsed.id }
    }
  } catch {
    throw new Error('WORKSPACE_RESOURCE_CURSOR_INVALID')
  }
  throw new Error('WORKSPACE_RESOURCE_CURSOR_INVALID')
}

export async function listWorkspaceResourceTreePage(input: {
  readonly userId: string
  readonly projectId: string
  readonly prefix?: string | null
  readonly search?: string | null
  readonly cursor?: string | null
  readonly limit?: number
  readonly deleted?: boolean
  readonly includeDisabled?: boolean
  readonly scope?: WorkspaceResourceTreeScope
  /**
   * Restrict the page to one production step's artifacts. Ownership is the same
   * folder-first rule as the step content panel, so the canvas and the panel
   * always show the same files.
   */
  readonly step?: ProductionStageKey | null
}): Promise<WorkspaceResourceTreePage> {
  const revision = await readWorkspaceResourceRevision(input)
  const limit = requireLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const search = input.search?.trim() || null
  const parentPath = input.prefix?.trim()
    ? validateWorkspaceResourceFolderPath(input.prefix.trim())
    : null
  const stepDefinition = input.step ? productionStageDefinition(input.step) : null
  const stepWhere: Prisma.WorkspaceResourceWhereInput = stepDefinition ? {
    resourceKind: 'file',
    OR: [
      { schemaId: { in: [...stepDefinition.schemaIds] } },
      ...productionStageFolderPaths(stepDefinition.key).map((folderPath) => ({
        workspacePath: { startsWith: `${folderPath}/` },
      })),
    ],
  } : {}
  const cursorWhere: Prisma.WorkspaceResourceWhereInput = cursor ? {
    OR: [
      { workspacePath: { gt: cursor.workspacePath } },
      { workspacePath: cursor.workspacePath, id: { gt: cursor.id } },
    ],
  } : {}
  const baseWhere: Prisma.WorkspaceResourceWhereInput = {
    userId: input.userId,
    projectId: input.projectId,
    ...(input.deleted ? { deletedAt: { not: null } } : { deletedAt: null, activePath: { not: null } }),
    ...(search ? { workspacePath: { contains: search } } : {}),
    ...stepWhere,
    ...(input.includeDisabled ? {} : { workflowEnabled: true }),
  }
  const ownedRows = <Row extends { readonly workspacePath: string; readonly schemaId: string }>(
    rows: readonly Row[],
  ): readonly Row[] => input.step
    ? rows.filter((row) => productionStageForResource(row) === input.step)
    : rows
  if (!search) {
    const candidates = await prisma.workspaceResource.findMany({
      where: baseWhere,
      orderBy: [{ workspacePath: 'asc' }, { id: 'asc' }],
      take: MAX_RUNTIME_RESOURCES + 1,
      select: resourceSelect,
    })
    if (candidates.length > MAX_RUNTIME_RESOURCES) throw new Error('WORKSPACE_RESOURCE_RUNTIME_LIMIT_EXCEEDED')
    const ownedCandidates = ownedRows(candidates)
    const directChildren = input.scope === 'subtree'
      ? ownedCandidates.filter((row) => (
          parentPath === null
            ? true
            : isWorkspaceSubtreePath(row.workspacePath, parentPath) && row.workspacePath !== parentPath
        ))
      : ownedCandidates.filter((row) => parentWorkspacePath(row.workspacePath) === parentPath)
    const afterCursor = cursor ? directChildren.filter((row) => (
      row.workspacePath > cursor.workspacePath
      || (row.workspacePath === cursor.workspacePath && row.id > cursor.id)
    )) : directChildren
    const pageRows = afterCursor.slice(0, limit)
    const last = pageRows.at(-1)
    return {
      items: await loadViews(pageRows, { includeContent: false }),
      nextCursor: afterCursor.length > limit && last
        ? encodeCursor({ workspacePath: last.workspacePath, id: last.id })
        : null,
      revision,
    }
  }
  // Step ownership is folder-first and cannot be expressed by stepWhere's
  // broad schema/folder union. Keep scanning until the filtered page has a
  // lookahead row, even when an entire database window belongs to another step.
  const matchingRows: ResourceRow[] = []
  let scanWhere = cursorWhere
  while (matchingRows.length <= limit) {
    const rows = await prisma.workspaceResource.findMany({
      where: { ...baseWhere, AND: [scanWhere] },
      orderBy: [{ workspacePath: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      select: resourceSelect,
    })
    matchingRows.push(...ownedRows(rows))
    const scannedLast = rows.at(-1)
    if (rows.length <= limit || !scannedLast) break
    scanWhere = { OR: [
      { workspacePath: { gt: scannedLast.workspacePath } },
      { workspacePath: scannedLast.workspacePath, id: { gt: scannedLast.id } },
    ] }
  }
  const pageRows = matchingRows.slice(0, limit)
  const last = pageRows.at(-1)
  return {
    items: await loadViews(pageRows, { includeContent: false }),
    nextCursor: matchingRows.length > limit && last
      ? encodeCursor({ workspacePath: last.workspacePath, id: last.id })
      : null,
    revision,
  }
}

export async function listAllWorkspaceResourcesForRuntime(input: {
  readonly userId: string
  readonly projectId: string
}): Promise<readonly WorkspaceResourceView[]> {
  const rows = await prisma.workspaceResource.findMany({
    where: { userId: input.userId, projectId: input.projectId, deletedAt: null, activePath: { not: null }, workflowEnabled: true },
    orderBy: [{ workspacePath: 'asc' }, { id: 'asc' }],
    take: MAX_RUNTIME_RESOURCES + 1,
    select: resourceSelect,
  })
  if (rows.length > MAX_RUNTIME_RESOURCES) throw new Error('WORKSPACE_RESOURCE_RUNTIME_LIMIT_EXCEEDED')
  return await loadViews(rows, { includeContent: true })
}

export async function readWorkspaceResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
}): Promise<WorkspaceResourceView> {
  const row = await prisma.workspaceResource.findFirst({
    where: {
      userId: input.userId,
      projectId: input.projectId,
      id: input.resourceId,
    },
    select: resourceSelect,
  })
  if (!row) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
  const [view] = await loadViews([row], { includeContent: true })
  if (!view) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
  return view
}

export async function readWorkspaceResourceByPath(input: {
  readonly userId: string
  readonly projectId: string
  readonly workspacePath: string
}): Promise<WorkspaceResourceView> {
  const resource = await resolveActiveWorkspaceResourceByPath(prisma, input)
  return await readWorkspaceResource({
    userId: input.userId,
    projectId: input.projectId,
    resourceId: resource.resourceId,
  })
}
