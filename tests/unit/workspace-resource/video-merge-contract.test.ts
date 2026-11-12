import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import Ajv from 'ajv'

const mocks = vi.hoisted(() => ({
  inputs: vi.fn(), media: vi.fn(), placement: vi.fn(), submit: vi.fn(),
  materialize: vi.fn(), settleFailure: vi.fn(), resource: vi.fn(),
  reserve: vi.fn(), retry: vi.fn(), bind: vi.fn(), workflow: vi.fn(), versions: vi.fn(),
  scores: vi.fn(), lineage: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  workspaceResource: { findFirst: mocks.resource, findMany: mocks.scores },
  workspaceResourceLineage: { findMany: mocks.lineage },
} }))
vi.mock('@/lib/workspace-resource/persistence', () => ({
  resolveWorkspaceResourceInputs: mocks.inputs,
  resolveGeneratedWorkspaceResourcePlacement: mocks.placement,
  materializeWorkspaceResourceInTransaction: mocks.materialize,
  settleWorkspaceResourceFailureInTransaction: mocks.settleFailure,
  createWorkspaceResourceFolderInTransaction: vi.fn(),
  reserveWorkspaceResourceInTransaction: mocks.reserve,
  retryWorkspaceResourcesInTransaction: mocks.retry,
  bindWorkspaceResourceTasksInTransaction: mocks.bind,
  validateWorkspaceResourceWorkflowInputsInTransaction: mocks.workflow,
  validateWorkspaceResourceInputReferencesInTransaction: mocks.versions,
}))
vi.mock('@/lib/workspace-resource/input-media', () => ({ resolveWorkspaceResourceInputMedia: mocks.media }))
vi.mock('@/lib/operations/submit-operation-task', () => ({ submitOperationTask: mocks.submit }))

import { createWorkspaceResourceVideoMergeOperations } from '@/lib/operations/domains/workspace-resource/video-merge-ops'
import { parseWorkspaceResourceVideoMergeTaskPayload } from '@/lib/workspace-resource/video-merge-contract'
import { materializeWorkspaceResourceTaskTerminalInTransaction } from '@/lib/workspace-resource/task-materializer'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { TASK_TYPE } from '@/lib/task/types'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { invokeProjectAgentOperation, prepareProjectAgentOperationInput } from '@/lib/operations/invocation'
import { createWaoMcpServer } from '@/lib/wao-mcp/server'
import { productionContextFixture } from '../../../scripts/lib/production-context-fixture'
import type { JsonObject } from '@/lib/operations/types'

const references = [9, 15].map((duration, position) => ({
  resourceId: `segment-${position}`, contentVersion: 1, workspacePath: `视频/S0${position + 1}`,
  role: 'source_video', position, duration,
}))
const frozenReferences = references.map(({ resourceId, contentVersion, workspacePath, role, position }) => ({
  resourceId, contentVersion, workspacePath, role, position,
}))

describe('merge producer, worker and materializer resource contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inputs.mockResolvedValue(frozenReferences)
    mocks.media.mockResolvedValue(references.map(({ duration, ...reference }) => ({
      reference, durationMs: duration * 1000, mediaType: 'video', schemaId: WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
    })))
    mocks.placement.mockResolvedValue('成片/S01-S02')
    mocks.submit.mockResolvedValue({
      success: true, async: true, taskId: 'merge-task', taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
      status: 'queued', deduped: false,
    })
    mocks.materialize.mockResolvedValue({ resourceId: 'output', contentVersion: 1 })
  })

  async function execute(input: unknown) {
    const operation = createWorkspaceResourceVideoMergeOperations().merge_videos
    const parsed = operation.inputSchema.safeParse(input)
    if (!parsed.success) throw parsed.error
    if (!operation.execute) throw new Error('Merge execution handler is missing')
    return await operation.execute({
      request: null, userId: 'user', projectId: 'project', source: 'test',
      context: { locale: 'zh', turnId: 'turn' }, toolCallId: 'merge-call',
    }, parsed.data)
  }

  async function produce() {
    await execute({
      name: 'S01-S02', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion })),
    })
    return mocks.submit.mock.calls[0][0].payload
  }

  it('freezes a selected retained clip first frame and an offset into the rendered timeline', async () => {
    const input = {
      name: 'Cover', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion, trim: { startSeconds: 2, endSeconds: 5 } })),
    }
    for (const [offsetSeconds, frame, timestampFrame] of [[undefined, 0, 90], [1.5, 45, 135]] as const) {
      await execute({ ...input, cover: { videoIndex: 1, offsetSeconds } })
      const payload = parseWorkspaceResourceVideoMergeTaskPayload(mocks.submit.mock.calls.at(-1)![0].payload)
      expect(payload.resource.edit.cover).toEqual({ videoIndex: 1, frame, timestampFrame })
      expect(payload.resource.edit.clips[1]).toMatchObject({ startFrame: 60, frameCount: 90 })
    }
  })

  it('defaults the poster to the first rendered frame and reads old frozen payloads without a cover', async () => {
    const payload = await produce()
    expect(payload.resource.edit.cover).toEqual({ videoIndex: 0, frame: 0, timestampFrame: 0 })
    delete payload.resource.edit.cover
    expect(parseWorkspaceResourceVideoMergeTaskPayload(payload).resource.edit.cover).toBeNull()
  })

  it('rejects a poster offset at the retained clip end before creating any task', async () => {
    await expect(execute({
      name: 'Cover', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion })),
      cover: { videoIndex: 1, offsetSeconds: 15 },
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS', details: {
      corrections: [expect.objectContaining({ fieldPath: '$input.cover.offsetSeconds' })],
    } })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('preserves the selected cover through exact retry and recompiles it for a revised merge', async () => {
    const { resource, payload } = await failedMerge()
    payload.resource.edit.cover = { videoIndex: 1, frame: 30, timestampFrame: 300 }
    await execute({ request: { kind: 'retry', resourceId: resource.id } })
    expect(mocks.submit.mock.calls[0][0].payload.resource.edit.cover).toEqual(payload.resource.edit.cover)
    await execute({ request: {
      kind: 'revise_failed', resourceId: resource.id, cover: { videoIndex: 1, offsetSeconds: 2 },
      output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion })),
    } })
    expect(mocks.submit.mock.calls[1][0].payload.resource.edit.cover).toEqual({ videoIndex: 1, frame: 60, timestampFrame: 330 })
  })

  it('carries folder placement from the public tool envelope through the durable invocation to task submission', async () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const context = {
      request: null, userId: 'user', projectId: 'project', source: 'test', requestId: 'durable-request',
      operationExecutionId: 'execution', context: { locale: 'zh', turnId: 'turn' }, toolCallId: 'merge-call',
    }
    const prepared = await prepareProjectAgentOperationInput({
      channel: 'tool', operation: registry.merge_videos, context,
      input: { request: {
        kind: 'new', folderPath: '成片', name: 'S01-S02',
        output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
        videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion, trim: null })),
        musicCues: null,
      } },
    })
    expect(prepared.input).toMatchObject({ folderPath: '成片', name: 'S01-S02' })
    const result = await invokeProjectAgentOperation({
      registry, operationId: 'merge_videos', channel: 'tool', context,
      input: JSON.parse(JSON.stringify(prepared.input)), invocationMode: 'durable_operation_execution',
    })
    expect(result.kind).toBe('executed')
    expect(mocks.placement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ folderPath: '成片', name: 'S01-S02' }))
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    const payload = parseWorkspaceResourceVideoMergeTaskPayload(mocks.submit.mock.calls[0][0].payload)
    expect(payload.resource.edit.clips.map((clip) => clip.frameCount)).toEqual([270, 450])
    expect(payload.resource.inputs).toEqual(frozenReferences)
    expect(payload.resource.edit.audioMode).toBe('preserve')
  })

  it('submits segment inputs as a composite output that worker parsing and terminal materialization both accept', async () => {
    const produced = await produce()
    expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({ expectedMediaType: 'video' }))
    const frozen = parseWorkspaceResourceVideoMergeTaskPayload({ ...produced, stage: 'workspace_resource_video_merge_prepare' })
    expect(frozen.resource.schemaId).toBe(WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO)
    expect(frozen.resource.edit.clips.map((clip) => clip.frameCount)).toEqual([270, 450])
    expect(frozen.resource.inputs).toEqual(frozenReferences)
    expect(frozen.lifecycleProjection.resources[0].schemaId).toBe(frozen.resource.schemaId)
    await materializeWorkspaceResourceTaskTerminalInTransaction({} as Prisma.TransactionClient, {
      kind: 'completed',
      task: {
        id: 'merge-task', userId: 'user', projectId: 'project', type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
        targetType: 'WorkspaceResource', targetId: frozen.resource.resourceId,
        operationId: 'merge_videos', operationExecutionId: null, payload: produced,
      },
      result: { mediaId: 'merged-video', posterMediaId: 'merged-poster' },
    })
    expect(mocks.materialize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      schemaId: WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO, content: { kind: 'media', mediaId: 'merged-video' },
      posterMediaId: 'merged-poster',
      inputs: frozen.resource.inputs,
    }))
  })

  it('preserves legacy generic outputs without relabeling them', async () => {
    const payload = await produce()
    payload.resource.schemaId = WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO
    payload.lifecycleProjection.resources[0].schemaId = WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO
    expect(parseWorkspaceResourceVideoMergeTaskPayload(payload).resource.schemaId).toBe(WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO)
  })

  it('rejects segment and non-video output identities rather than weakening the output contract', async () => {
    const payload = await produce()
    for (const schemaId of [WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT, WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE, 'unknown.video']) {
      expect(() => parseWorkspaceResourceVideoMergeTaskPayload({
        ...payload, resource: { ...payload.resource, schemaId },
      })).toThrow()
    }
  })

  async function failedMerge() {
    const payload = await produce()
    vi.clearAllMocks()
    const resource = {
      id: payload.resource.resourceId, userId: 'user', projectId: 'project', workspacePath: '成片/S01-S02',
      schemaId: payload.resource.schemaId, mediaType: 'video', operationId: 'merge_videos', status: 'failed',
      workflowEnabled: true, taskId: 'failed-task',
      task: { id: 'failed-task', type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE, status: 'failed',
        targetId: payload.resource.resourceId, payload },
    }
    mocks.resource.mockResolvedValue(resource)
    return { resource, payload }
  }

  it.each(['new', 'retry', 'revise_failed'] as const)('carries %s through real MCP transport, canonical replay, domain execution and worker parsing', async (kind) => {
    const existing = kind === 'new' ? null : await failedMerge()
    const registry = createProjectAgentOperationRegistryForApi()
    const context = {
      request: null, userId: 'user', projectId: 'project', source: 'test', requestId: 'durable-request',
      operationExecutionId: 'execution', context: { locale: 'zh', turnId: 'turn' }, toolCallId: 'merge-call',
    }
    const selection = {
      output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion, trim: null })),
      musicCues: null,
      cover: { videoIndex: 1, offsetSeconds: null },
    }
    const args = { request: kind === 'new'
      ? { kind, folderPath: '成片', name: 'S01-S02', ...selection }
      : kind === 'retry'
        ? { kind, resourceId: existing!.resource.id, expectedTaskId: null }
        : { kind, resourceId: existing!.resource.id, expectedTaskId: 'failed-task', ...selection } }
    const executor = vi.fn(async ({ operationId, input }: { operationId: string; input: Readonly<Record<string, unknown>> }) => {
      const prepared = await prepareProjectAgentOperationInput({ channel: 'tool', operation: registry[operationId], context, input })
      const result = await invokeProjectAgentOperation({
        registry, operationId, channel: 'tool', context,
        input: JSON.parse(JSON.stringify(prepared.input)), invocationMode: 'durable_operation_execution',
      })
      return { text: 'Queued test assembly', structuredContent: { ok: true, data: result.data as JsonObject } }
    })
    const server = createWaoMcpServer({
      productionContext: productionContextFixture(), executor: { execute: executor },
      contextResolver: { resolve: async () => ({
        threadId: 'thread', turnId: 'turn', callId: 'merge-call', requestId: 'durable-request',
        executionOwnerId: 'owner', userId: 'user', projectId: 'project', source: 'test',
      }) },
    })
    const client = new Client({ name: 'merge-audit', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const tool = (await client.listTools()).tools.find((entry) => entry.name === 'merge_videos')!
      const validate = new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', logger: false }).compile(tool.inputSchema)
      expect(validate(args), JSON.stringify(validate.errors)).toBe(true)
      const result = await client.callTool({ name: tool.name, arguments: args })
      expect(result.isError, JSON.stringify(result)).toBeUndefined()
      expect(executor).toHaveBeenCalledWith(expect.objectContaining({ input: args }))
      const submitted = mocks.submit.mock.calls[0][0]
      const payload = parseWorkspaceResourceVideoMergeTaskPayload(submitted.payload)
      expect(payload.resource.edit.clips.map((clip) => clip.frameCount)).toEqual([270, 450])
      expect(payload.resource.edit.cover).toEqual(kind === 'retry'
        ? { videoIndex: 0, frame: 0, timestampFrame: 0 }
        : { videoIndex: 1, frame: 0, timestampFrame: 270 })
      expect(result.structuredContent).toMatchObject({ ok: true, data: {
        success: true, taskId: 'merge-task', resourceId: payload.resource.resourceId, workspacePath: '成片/S01-S02',
      } })
      await submitted.onTaskCreatedInTransaction({}, { id: 'merge-task' })
      expect(kind === 'new' ? mocks.reserve : mocks.retry).toHaveBeenCalledTimes(1)
    } finally {
      await Promise.allSettled([client.close(), server.close()])
    }
  })

  it.each([
    ['16:9', '480p', 854, 480], ['9:16', '720p', 720, 1280],
    ['1:1', '1080p', 1080, 1080], ['21:9', '720p', 1680, 720], ['9:21', '480p', 480, 1120],
  ])('freezes explicit output %s %s into worker dimensions', async (aspectRatio, resolution, width, height) => {
    await execute({ name: 'Output', output: { aspectRatio, resolution, audioMode: 'mute' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion })) })
    const payload = parseWorkspaceResourceVideoMergeTaskPayload(mocks.submit.mock.calls[0][0].payload)
    expect(payload.resource.edit).toMatchObject({ width, height, aspectRatio, audioMode: 'mute' })
    expect(payload.resource.musicCues).toEqual([])
  })

  it('preserves repeated uses of the same frozen source version by position, up to 50 clips', async () => {
    const repeated = Array.from({ length: 50 }, (_, position) => ({ ...frozenReferences[0], position }))
    mocks.inputs.mockResolvedValue(repeated)
    mocks.media.mockResolvedValue(repeated.map((reference) => ({ reference, durationMs: 9_000 })))
    await execute({ name: 'Repeat', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: repeated.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion })) })
    const payload = parseWorkspaceResourceVideoMergeTaskPayload(mocks.submit.mock.calls[0][0].payload)
    expect(payload.resource.edit.clips).toHaveLength(50)
    expect(payload.resource.inputs.map((input) => input.position)).toEqual(repeated.map((input) => input.position))
  })

  it.each([false, true])('reports a source-duration error as an input correction (tool=%s)', async (tool) => {
    const input = { name: 'Trim', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: [{ resourceId: 'segment-0', contentVersion: 1, trim: { startSeconds: 0, endSeconds: 10 } }] }
    const registry = createProjectAgentOperationRegistryForApi()
    await expect(invokeProjectAgentOperation({ registry, operationId: 'merge_videos',
      channel: tool ? 'tool' : 'api', invocationMode: 'durable_operation_execution',
      context: { request: null, userId: 'user', projectId: 'project', source: 'test', requestId: 'request',
        operationExecutionId: 'execution', context: { locale: 'zh' } },
      input: tool ? { request: { kind: 'new', ...input } } : input,
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS', details: {
      code: 'OPERATION_INPUT_INVALID', corrections: [expect.objectContaining({
        fieldPath: `$input.${tool ? 'request.' : ''}videos[0].trim.endSeconds`, action: 'fix_invalid_value',
      })],
    } })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  async function scoreSelection(count = 1) {
    const scores = Array.from({ length: count }, (_, index) => ({
      resourceId: `score-${index}`, contentVersion: 1, workspacePath: `配乐/${index}`, role: 'bgm_audio', position: index + 1,
    }))
    mocks.inputs.mockResolvedValue([frozenReferences[0], ...scores])
    mocks.media.mockResolvedValue([{ reference: frozenReferences[0], durationMs: 9_000 }])
    mocks.scores.mockResolvedValue(scores.map((score) => ({ id: score.resourceId, currentVersion: 1, generationOptions: {
      kind: 'music_score_v1', startMs: 1_000, fadeInMs: 200, fadeOutMs: 200, gainDb: -6,
      timelineInputPosition: 0, outputFormat: 'mp3', compositionPlan: { chunks: [{
        text: 'Sparse notes', durationMs: 3_000, positiveStyles: [], negativeStyles: [], contextAdherence: 'high',
      }] },
    } })))
    mocks.lineage.mockResolvedValue(scores.map((score) => ({
      outputResourceId: score.resourceId, outputVersion: 1, inputResourceId: 'segment-0', inputVersion: 1, role: 'score_timeline', position: 0,
    })))
    return { name: 'Score', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: [{ resourceId: 'segment-0', contentVersion: 1 }],
      musicCues: scores.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion })) }
  }

  it.each([1, 50])('freezes %s score cues with provenance, placement and gain into a worker-compatible payload', async (count) => {
    await execute(await scoreSelection(count))
    const payload = parseWorkspaceResourceVideoMergeTaskPayload(mocks.submit.mock.calls[0][0].payload)
    expect(payload.resource.inputs).toHaveLength(count + 1)
    expect(payload.resource.musicCues).toHaveLength(count)
    expect(payload.resource.musicCues[0]).toEqual({ inputPosition: 1, startMs: 1_000, durationMs: 3_000, fadeInMs: 200, fadeOutMs: 200, gainDb: -6 })
  })

  it.each(['version', 'timeline', 'duration'] as const)('rejects invalid score %s before submission with the selected cue path', async (failure) => {
    const input = await scoreSelection()
    if (failure === 'version') mocks.scores.mockResolvedValue([])
    if (failure === 'timeline') mocks.lineage.mockResolvedValue([])
    if (failure === 'duration') mocks.media.mockResolvedValue([{ reference: frozenReferences[0], durationMs: 3_000 }])
    await expect(execute(input)).rejects.toMatchObject({ code: 'INVALID_PARAMS', details: {
      corrections: [expect.objectContaining({ fieldPath: '$input.musicCues[0]' })],
    } })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('rejects malformed frozen identities, positions, edits and cue timing before worker execution', async () => {
    const original = parseWorkspaceResourceVideoMergeTaskPayload(await produce())
    const mutations = [
      (payload: typeof original) => { payload.lifecycleProjection.resources[0].resourceId = 'different-output' },
      (payload: typeof original) => { payload.resource.inputs[1].position = 0 },
      (payload: typeof original) => { payload.resource.edit.clips[1].inputPosition = 0 },
      (payload: typeof original) => { payload.resource.edit.clips[0].frameCount = 0 },
    ]
    for (const mutate of mutations) {
      const payload = structuredClone(original)
      mutate(payload)
      expect(() => parseWorkspaceResourceVideoMergeTaskPayload(payload)).toThrow()
    }
    await execute(await scoreSelection())
    const scored = mocks.submit.mock.calls.at(-1)![0].payload
    scored.resource.musicCues[0].startMs = 8_000
    expect(() => parseWorkspaceResourceVideoMergeTaskPayload(scored)).toThrow('Music cue exceeds the frozen output timeline.')
  })

  it('retries the exact frozen edit in place and atomically binds a fresh attempt', async () => {
    const { resource, payload } = await failedMerge()
    const result = await execute({ request: { kind: 'retry', resourceId: resource.id, expectedTaskId: 'failed-task' } })
    expect(result).toMatchObject({ resourceId: resource.id, workspacePath: resource.workspacePath })
    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.payload.resource).toEqual(payload.resource)
    expect(submitted.dedupeKey).toContain(`:retry:${resource.id}:failed-task:`)
    expect(mocks.placement).not.toHaveBeenCalled()
    expect(mocks.inputs).not.toHaveBeenCalled()
    expect(mocks.resource).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user', projectId: 'project', deletedAt: null, activePath: { not: null } }) }))
    await submitted.onTaskCreatedInTransaction({}, { id: 'fresh-task' })
    expect(mocks.workflow).toHaveBeenCalledWith({}, { userId: 'user', projectId: 'project' }, frozenReferences)
    expect(mocks.versions).toHaveBeenCalled()
    expect(mocks.retry).toHaveBeenCalledWith({}, expect.objectContaining({ resources: [expect.objectContaining({ resourceId: resource.id, expectedTaskId: 'failed-task', modelKey: null })] }))
    expect(mocks.bind).toHaveBeenCalledWith({}, expect.objectContaining({ bindings: [{ resourceId: resource.id, taskId: 'fresh-task' }] }))
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('uses the most recent failed task to distinguish consecutive recovery attempts', async () => {
    const { resource } = await failedMerge()
    await execute({ request: { kind: 'retry', resourceId: resource.id } })
    const firstKey = mocks.submit.mock.calls[0][0].dedupeKey
    resource.taskId = resource.task.id = 'second-failed-task'
    await execute({ request: { kind: 'retry', resourceId: resource.id } })
    expect(mocks.submit.mock.calls[1][0].dedupeKey).not.toBe(firstKey)
  })

  it('recompiles corrected trims without changing the failed resource identity or placement', async () => {
    const { resource, payload } = await failedMerge()
    await execute({ request: {
      kind: 'revise_failed', resourceId: resource.id,
      output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: references.map(({ resourceId, contentVersion }) => ({ resourceId, contentVersion, trim: { startSeconds: 1, endSeconds: 3 } })),
    } })
    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.targetId).toBe(resource.id)
    expect(submitted.payload.resource.edit.clips.map((clip: { startFrame: number; frameCount: number }) => [clip.startFrame, clip.frameCount])).toEqual([[30, 60], [30, 60]])
    expect(submitted.payload.resource.inputHash).not.toBe(payload.resource.inputHash)
    expect(mocks.placement).not.toHaveBeenCalled()
  })

  it.each(['ready', 'pending'])('rejects recovery of a %s output', async (status) => {
    const { resource } = await failedMerge()
    resource.status = status
    await expect(execute({ request: { kind: 'retry', resourceId: resource.id } })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_INVALID' })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('rejects stale, disabled, missing and non-merge targets before submission', async () => {
    const { resource } = await failedMerge()
    await expect(execute({ request: { kind: 'retry', resourceId: resource.id, expectedTaskId: 'older-task' } })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED' })
    resource.workflowEnabled = false
    await expect(execute({ request: { kind: 'retry', resourceId: resource.id } })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_DISABLED' })
    resource.workflowEnabled = true
    resource.task.type = TASK_TYPE.WORKSPACE_RESOURCE_VIDEO as typeof resource.task.type
    await expect(execute({ request: { kind: 'retry', resourceId: resource.id } })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_INVALID' })
    mocks.resource.mockResolvedValue(null)
    await expect(execute({ request: { kind: 'retry', resourceId: resource.id } })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_NOT_FOUND' })
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('keeps new-output path conflicts explicit instead of silently overwriting failed outputs', async () => {
    mocks.placement.mockRejectedValue(new Error('WORKSPACE_RESOURCE_PATH_CONFLICT'))
    await expect(produce()).rejects.toThrow('WORKSPACE_RESOURCE_PATH_CONFLICT')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

})
