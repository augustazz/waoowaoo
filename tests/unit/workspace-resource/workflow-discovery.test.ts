import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ resources: vi.fn(), resource: vi.fn(), versions: vi.fn(), lineage: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  workspaceResource: { findMany: mocks.resources, findFirst: mocks.resource },
  workspaceResourceVersion: { findMany: mocks.versions },
  workspaceResourceLineage: { findMany: mocks.lineage },
} }))
vi.mock('@/lib/workspace-resource/projection-revision', () => ({ readWorkspaceResourceRevision: vi.fn().mockResolvedValue(1) }))
import { projectWorkspaceResourceCard } from '@/features/project-workspace/canvas/projection/workspace-node-resource-projection'
import { listAllWorkspaceResourcesForRuntime, listWorkspaceResourceTreePage, readWorkspaceResource } from '@/lib/workspace-resource/view-service'

const scope = { userId: 'owner', projectId: 'project' }
const imageRow = (id: string, workspacePath = id) => ({
  id, projectId: scope.projectId, resourceKind: 'file', mediaType: 'image', schemaId: 'project.character_image',
  workspacePath, name: id, status: 'ready', workflowEnabled: true, currentVersion: 0,
  taskId: null, task: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
  prompt: 'Portrait', modelKey: 'openai-compatible:custom::gpt-image-2', generationOptions: {},
  operationId: 'create_image', alternativeGroupExecutionId: null, memberIndex: null,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resources.mockResolvedValue([])
  mocks.versions.mockResolvedValue([])
  mocks.lineage.mockResolvedValue([])
})

describe('regeneration participation projection', () => {
  it.each([[true, true, true], [false, true, false], [true, false, false]])('source=%s reference=%s enables regeneration=%s', async (sourceEnabled, referenceEnabled, enabled) => {
    mocks.resource.mockResolvedValue({ ...imageRow('output'), workflowEnabled: sourceEnabled, currentVersion: 1 })
    mocks.versions.mockResolvedValue(['output', 'reference'].map((resourceId) => ({
      resourceId, version: 1, contentKind: 'media', sha256: null, sizeBytes: BigInt(10), createdAt: new Date(),
      media: { id: resourceId, publicId: resourceId, mimeType: 'image/png', width: 100, height: 100, durationMs: null },
    })))
    mocks.lineage.mockResolvedValue([{ outputResourceId: 'output', outputVersion: 1, inputResourceId: 'reference', inputVersion: 1, role: 'reference_image', position: 0 }])
    mocks.resources.mockImplementation(async ({ where }) => where.id ? [{ ...imageRow('reference'), workflowEnabled: referenceEnabled }] : [])
    const view = await readWorkspaceResource({ ...scope, resourceId: 'output' })
    expect(view.inputSummaries[0].workflowEnabled).toBe(referenceEnabled)
    expect(view.actions.find((action) => action.kind === 'regenerate')?.enabled).toBe(enabled)
    expect(projectWorkspaceResourceCard(view).canvasOperations.some((action) => action.kind === 'regenerate')).toBe(enabled)
  })
})

describe('search pagination with folder-first step ownership', () => {
  it('scans past an entirely filtered window and keeps later owned matches pageable', async () => {
    const rows = [imageRow('wrong-a', '视频/匹配A'), imageRow('wrong-b', '视频/匹配B'), imageRow('owned-a', '资源匹配A'), imageRow('owned-b', '资源匹配B')]
    mocks.resources.mockImplementation(async ({ where, take }) => {
      if (!where.AND) return []
      const cursor = where.AND[0].OR?.[0].workspacePath.gt
      return rows.filter((row) => !cursor || row.workspacePath > cursor).slice(0, take)
    })
    const first = await listWorkspaceResourceTreePage({ ...scope, search: '匹配', step: 'assets', limit: 1 })
    expect(first.items.map((item) => item.resourceId)).toEqual(['owned-a'])
    expect(first.nextCursor).not.toBeNull()
    const second = await listWorkspaceResourceTreePage({ ...scope, search: '匹配', step: 'assets', limit: 1, cursor: first.nextCursor })
    expect(second.items.map((item) => item.resourceId)).toEqual(['owned-b'])
    expect(second.nextCursor).toBeNull()
    expect(mocks.resources.mock.calls.filter(([query]) => query.where.AND)).toHaveLength(3)
  })

  it('finishes after exhausting windows that all belong to other steps', async () => {
    mocks.resources.mockResolvedValueOnce([imageRow('a', '视频/A'), imageRow('b', '视频/B')]).mockResolvedValueOnce([])
    const page = await listWorkspaceResourceTreePage({ ...scope, search: '视频', step: 'assets', limit: 1 })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
    expect(mocks.resources).toHaveBeenCalledTimes(2)
  })
})
describe('disabled resource discovery boundaries', () => {
  it('excludes disabled resources from the default assistant listing and automatic context', async () => {
    await listWorkspaceResourceTreePage(scope)
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...scope, workflowEnabled: true }) }))
    await listAllWorkspaceResourcesForRuntime(scope)
    expect(mocks.resources).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ ...scope, workflowEnabled: true }) }))
  })
  it('includes disabled resources when the canvas requests them explicitly', async () => {
    await listWorkspaceResourceTreePage({ ...scope, includeDisabled: true })
    expect(mocks.resources.mock.calls[0][0].where).not.toHaveProperty('workflowEnabled')
  })
  it('still reads a disabled resource and its status by exact identity', async () => {
    mocks.resource.mockResolvedValue({
      id: 'image', projectId: scope.projectId, resourceKind: 'file', mediaType: 'image',
      schemaId: 'generic.image', workspacePath: '旧图', name: 'Old', status: 'ready',
      workflowEnabled: false, currentVersion: 0, taskId: null, task: null, deletedAt: null,
      createdAt: new Date(), updatedAt: new Date(), prompt: null, modelKey: null,
      generationOptions: null, operationId: null, alternativeGroupExecutionId: null, memberIndex: null,
    })
    const view = await readWorkspaceResource({ ...scope, resourceId: 'image' })
    expect(view).toMatchObject({ resourceId: 'image', workflowEnabled: false, status: 'ready' })
    expect(view.actions).toContainEqual(expect.objectContaining({ kind: 'toggle_workflow', enabled: true, input: { resourceId: 'image', workflowEnabled: true } }))
    expect(mocks.resource).toHaveBeenCalledWith(expect.objectContaining({ where: { ...scope, id: 'image' } }))
  })
})


describe('failed merge recovery projection', () => {
  it.each([
    ['failed', true, true], ['canceled', true, true], ['pending', true, false],
    ['ready', true, false], ['failed', false, false],
  ])('projects %s / workflow=%s as an in-place assembly retry: %s', async (status, workflowEnabled, enabled) => {
    mocks.resource.mockResolvedValue({
      id: 'merge', projectId: scope.projectId, resourceKind: 'file', mediaType: 'video',
      schemaId: 'project.composite_video', workspacePath: 'Final', name: 'Final', status,
      workflowEnabled, currentVersion: 0, taskId: 'failed-attempt', task: { payload: null, failure: null }, deletedAt: null,
      createdAt: new Date(), updatedAt: new Date(), prompt: null, modelKey: null,
      generationOptions: null, operationId: 'merge_videos', alternativeGroupExecutionId: null, memberIndex: null,
    })
    const view = await readWorkspaceResource({ ...scope, resourceId: 'merge' })
    expect(view.actions.find((action) => action.kind === 'retry')?.enabled).toBe(enabled)
    const card = projectWorkspaceResourceCard(view)
    expect(card.canvasOperations.filter((operation) => operation.kind === 'retry')).toEqual(enabled ? [{
      kind: 'retry', operationId: 'merge_videos', confirmation: 'none',
      input: { request: { kind: 'retry', resourceId: 'merge', expectedTaskId: 'failed-attempt' } },
    }] : [])
    expect(card.canvasOperations.some((operation) => operation.kind === 'regenerate')).toBe(false)
  })
})

describe('merged video posters', () => {
  it('projects the poster from the exact current version through full reads and canvas summaries', async () => {
    const createdAt = new Date()
    mocks.resource.mockResolvedValue({
      id: 'merge', projectId: scope.projectId, resourceKind: 'file', mediaType: 'video',
      schemaId: 'project.composite_video', workspacePath: '完成', name: '完成', status: 'ready',
      workflowEnabled: true, currentVersion: 2, taskId: 'task', task: null, deletedAt: null,
      createdAt, updatedAt: createdAt, prompt: null, modelKey: null,
      generationOptions: null, operationId: 'merge_videos', alternativeGroupExecutionId: null, memberIndex: null,
    })
    mocks.versions.mockResolvedValue([{
      resourceId: 'merge', version: 2, contentKind: 'media', sha256: null, sizeBytes: BigInt(10), createdAt,
      posterMedia: { publicId: 'poster-v2' },
      media: { id: 'video-media', publicId: 'video-v2', mimeType: 'video/mp4', width: 720, height: 1280, durationMs: 24000 },
    }])
    const view = await readWorkspaceResource({ ...scope, resourceId: 'merge' })
    expect(mocks.versions).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ resourceId: 'merge', version: 2 }] }, include: expect.objectContaining({ posterMedia: { select: { publicId: true } } }),
    }))
    expect(view.current?.content).toMatchObject({ kind: 'media', url: '/m/video-v2', posterUrl: '/m/poster-v2' })
    expect(view.summary).toMatchObject({ kind: 'media', posterUrl: '/m/poster-v2' })
    expect(projectWorkspaceResourceCard(view).presentation.summary).toMatchObject({ url: '/m/video-v2', posterUrl: '/m/poster-v2' })
  })
})
