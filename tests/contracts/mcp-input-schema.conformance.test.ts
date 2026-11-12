import Ajv from 'ajv'
import { describe, expect, it, vi } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { createWaoMcpOperationCatalog } from '@/lib/wao-mcp/operation-catalog'
import { productionContextFixture } from '../../scripts/lib/production-context-fixture'
import { invokeProjectAgentOperation, prepareProjectAgentOperationInput } from '@/lib/operations/invocation'

ensureAiCatalogsRegistered()
const registry = createProjectAgentOperationRegistry()

describe('production MCP schemas against the JSON Schema standard', () => {
  for (const operation of Object.values(registry).filter((entry) => entry.channels.mcp)) {
    it(`resolves every reference in ${operation.id}`, () => {
      const ajv = new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', logger: false })
      expect(() => ajv.compile(operation.toolInputSchema)).not.toThrow()
    })
  }

  it('represents nested JSON document values without discarding object keys', () => {
    const input = {
      folderPath: null,
      name: 'Document',
      content: { kind: 'structured', data: { title: 'Example', nested: [{ count: 2 }, null, false, 'text'] } },
      references: [],
    }
    const operation = registry.save_project_document
    const validate = new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', logger: false }).compile(operation.toolInputSchema)
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true)
    expect(operation.inputSchema.safeParse(input).success).toBe(true)
  })

  it('keeps complete generation contracts in the direct declaration when runtime union projection loses nested arrays', () => {
    const catalog = createWaoMcpOperationCatalog(productionContextFixture())
    const marker = 'Canonical input JSON Schema (complete; use it if the runtime projection omits nested fields):\n'
    for (const id of ['create_image', 'create_video', 'create_audio', 'merge_videos']) {
      const entry = catalog.find((candidate) => candidate.operationId === id)!
      expect(entry, id).toBeDefined()
      const description = entry.tool.description ?? ''
      expect(description, id).toContain(marker)
      expect(JSON.parse(description.slice(description.indexOf(marker) + marker.length)), id).toEqual(entry.tool.inputSchema)
      expect(() => new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', logger: false }).compile(entry.tool.inputSchema)).not.toThrow()
    }
  })

  it.each([
    {
      request: {
        kind: 'new', folderPath: null, name: 'S01-S02',
        output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
        videos: [{ resourceId: 'segment-1', contentVersion: 1, trim: null }], musicCues: null, cover: null,
      },
    },
    { request: { kind: 'retry', resourceId: 'failed-merge', expectedTaskId: null } },
    {
      request: {
        kind: 'revise_failed', resourceId: 'failed-merge', expectedTaskId: 'failed-task',
        output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
        videos: [{ resourceId: 'segment-1', contentVersion: 1, trim: { startSeconds: 1, endSeconds: 3 } }], musicCues: null, cover: null,
      },
    },
  ])('keeps merge $request.kind=$request.kind arguments through published schema and invocation normalization', async (input) => {
    const entry = createWaoMcpOperationCatalog(productionContextFixture()).find((candidate) => candidate.operationId === 'merge_videos')!
    expect(Object.keys(entry.tool.inputSchema.properties ?? {})).toEqual(['request'])
    const validate = new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', logger: false }).compile(entry.tool.inputSchema)
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true)
    const prepared = await prepareProjectAgentOperationInput({
      channel: 'tool', operation: entry.operation, input,
      context: { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' },
    })
    // The real durable Activity invokes the same authority a second time,
    // after the first boundary has frozen the canonical execution shape.
    const operation = entry.operation
    const execute = vi.spyOn(operation, 'execute').mockResolvedValue({
      success: true, async: true, taskId: 'merge-task', taskType: 'workspace_resource_video_merge',
      status: 'queued', deduped: false, resourceId: 'output', workspacePath: '成片/Output',
    })
    const result = await invokeProjectAgentOperation({
      registry: { merge_videos: operation }, channel: 'tool', operationId: 'merge_videos',
      context: {
        request: null, requestId: 'durable-request', operationExecutionId: 'durable-execution',
        userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test',
      },
      input: JSON.parse(JSON.stringify(prepared.input)), invocationMode: 'durable_operation_execution',
    })
    expect(result.kind).toBe('executed')
    expect(execute).toHaveBeenCalledExactlyOnceWith(expect.anything(), prepared.input)
    expect(entry.operation.inputSchema.safeParse(prepared.input).success).toBe(true)
    if (input.request.kind === 'new') {
      expect(prepared.input).toEqual({
        folderPath: null, name: 'S01-S02', output: input.request.output,
        videos: [{ resourceId: 'segment-1', contentVersion: 1 }],
      })
    } else if (input.request.kind === 'retry') {
      expect(prepared.input).toEqual({ request: { kind: 'retry', resourceId: 'failed-merge' } })
    } else {
      expect(prepared.input).toEqual({ request: {
        kind: 'revise_failed', resourceId: 'failed-merge', expectedTaskId: 'failed-task',
        output: input.request.output, videos: input.request.videos,
      } })
    }
  })

  it('preserves existing API new-assembly inputs while keeping missing retry IDs distinct from missing new names', async () => {
    const operation = registry.merge_videos
    const context = { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' }
    const legacy = {
      name: 'Existing API client', output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
      videos: [{ resourceId: 'segment-1', contentVersion: 1 }],
    }
    expect((await prepareProjectAgentOperationInput({ channel: 'api', operation, context, input: legacy })).input).toEqual(legacy)
    try {
      await prepareProjectAgentOperationInput({ channel: 'tool', operation, context, input: { request: { kind: 'retry', expectedTaskId: null } } })
      throw new Error('Expected missing retry target')
    } catch (error) {
      const details = (error as { details?: { corrections?: { fieldPath: string }[] } }).details
      expect(details?.corrections?.map((correction) => correction.fieldPath)).toEqual(['$input.request.resourceId'])
    }
  })

  const selection = {
    kind: 'new', name: '参数检查',
    output: { aspectRatio: '9:16', resolution: '720p', audioMode: 'preserve' },
    videos: [{ resourceId: 'segment-1', contentVersion: 1 }],
  }
  it('carries a poster selection through strict MCP fields, null normalization and frozen replay', async () => {
    const operation = registry.merge_videos
    const input = { request: { ...selection, folderPath: null, musicCues: null,
      cover: { videoIndex: 0, offsetSeconds: null }, videos: [{ ...selection.videos[0], trim: null }] } }
    const validate = new Ajv({ schemaId: 'auto', unknownFormats: 'ignore', logger: false }).compile(operation.toolInputSchema)
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true)
    const params = { channel: 'tool' as const, operation,
      context: { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' } }
    const prepared = await prepareProjectAgentOperationInput({ ...params, input })
    expect(prepared.input).toMatchObject({ cover: { videoIndex: 0 } })
    expect((await prepareProjectAgentOperationInput({ ...params, input: JSON.parse(JSON.stringify(prepared.input)) })).input).toEqual(prepared.input)
  })
  it.each([
    { label: 'nonexistent cover clip', request: { ...selection, cover: { videoIndex: 1 } }, path: '$input.request.cover.videoIndex' },
    { label: 'negative cover offset', request: { ...selection, cover: { videoIndex: 0, offsetSeconds: -1 } }, path: '$input.request.cover.offsetSeconds' },
    { label: 'fractional cover index', request: { ...selection, cover: { videoIndex: 0.5 } }, path: '$input.request.cover.videoIndex' },
    { label: 'missing name', request: { ...selection, name: undefined }, path: '$input.request.name' },
    { label: 'missing audio decision', request: { ...selection, output: { aspectRatio: '9:16', resolution: '720p' } }, path: '$input.request.output.audioMode' },
    { label: 'unknown resolution', request: { ...selection, output: { ...selection.output, resolution: '4k' } }, path: '$input.request.output.resolution' },
    { label: 'unknown aspect ratio', request: { ...selection, output: { ...selection.output, aspectRatio: 'vertical' } }, path: '$input.request.output.aspectRatio' },
    { label: 'empty sources', request: { ...selection, videos: [] }, path: '$input.request.videos' },
    { label: 'too many sources', request: { ...selection, videos: Array.from({ length: 51 }, () => selection.videos[0]) }, path: '$input.request.videos' },
    { label: 'zero version', request: { ...selection, videos: [{ ...selection.videos[0], contentVersion: 0 }] }, path: '$input.request.videos[0].contentVersion' },
    { label: 'string version', request: { ...selection, videos: [{ ...selection.videos[0], contentVersion: '1' }] }, path: '$input.request.videos[0].contentVersion' },
    { label: 'empty music list', request: { ...selection, musicCues: [] }, path: '$input.request.musicCues' },
    { label: 'zero-frame trim', request: { ...selection, videos: [{ ...selection.videos[0], trim: { startSeconds: 0, endSeconds: 0.01 } }] }, path: '$input.request.videos[0].trim.endSeconds' },
    { label: 'negative trim', request: { ...selection, videos: [{ ...selection.videos[0], trim: { startSeconds: -1, endSeconds: 1 } }] }, path: '$input.request.videos[0].trim.startSeconds' },
    { label: 'caller-owned positions', request: { ...selection, videos: [{ ...selection.videos[0], position: 0 }] }, path: '$input.request.videos[0].position' },
    { label: 'retry name', request: { kind: 'retry', resourceId: 'failed', name: 'new name' }, path: '$input.request.name' },
    { label: 'revised placement', request: { ...selection, kind: 'revise_failed', name: undefined, resourceId: 'failed', folderPath: 'elsewhere' }, path: '$input.request.folderPath' },
    { label: 'muted music', request: { ...selection, output: { ...selection.output, audioMode: 'mute' }, musicCues: [{ resourceId: 'score', contentVersion: 1 }] }, path: '$input.request.musicCues' },
    { label: 'multiple scored timelines', request: { ...selection, videos: [...selection.videos, ...selection.videos], musicCues: [{ resourceId: 'score', contentVersion: 1 }] }, path: '$input.request.musicCues' },
    { label: 'duplicate cues', request: { ...selection, musicCues: [{ resourceId: 'score', contentVersion: 1 }, { resourceId: 'score', contentVersion: 1 }] }, path: '$input.request.musicCues' },
    { label: 'trimmed scored timeline', request: { ...selection, videos: [{ ...selection.videos[0], trim: { startSeconds: 1, endSeconds: 3 } }], musicCues: [{ resourceId: 'score', contentVersion: 1 }] }, path: '$input.request.musicCues' },
  ])('rejects $label at $path before durable dispatch', async ({ request, path }) => {
    const input = JSON.parse(JSON.stringify({ request }))
    await expect(prepareProjectAgentOperationInput({ channel: 'tool', operation: registry.merge_videos, input,
      context: { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' },
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS', details: {
      code: 'OPERATION_INPUT_INVALID', corrections: expect.arrayContaining([expect.objectContaining({ fieldPath: path })]),
    } })
  })

  it('reports a misplaced envelope field without asking for legacy new-assembly fields', async () => {
    try {
      await prepareProjectAgentOperationInput({ channel: 'tool', operation: registry.merge_videos,
        input: { folderPath: '成片', request: { kind: 'retry', resourceId: 'failed' } },
        context: { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' },
      })
      throw new Error('Expected misplaced field rejection')
    } catch (error) {
      const details = (error as { details?: { corrections?: { fieldPath: string }[] } }).details
      expect(details?.corrections?.map((correction) => correction.fieldPath)).toEqual(['$input.folderPath'])
    }
  })

  it('accepts the minimum frame-aligned trim and preserves omitted placement versus explicit project root', async () => {
    for (const folderPath of [undefined, null, '成片']) {
      const input = JSON.parse(JSON.stringify({ request: {
        ...selection, folderPath, musicCues: null,
        videos: [{ ...selection.videos[0], trim: { startSeconds: 0, endSeconds: 1 / 60 } }],
      } }))
      const first = await prepareProjectAgentOperationInput({ channel: 'tool', operation: registry.merge_videos, input,
        context: { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' },
      })
      const second = await prepareProjectAgentOperationInput({ channel: 'tool', operation: registry.merge_videos,
        input: JSON.parse(JSON.stringify(first.input)),
        context: { request: null, userId: 'owner', projectId: 'project', context: { locale: 'zh' }, source: 'test' },
      })
      expect(second.input).toEqual(first.input)
      expect(second.input).toEqual({ name: selection.name, output: selection.output,
        ...(folderPath === undefined ? {} : { folderPath }), videos: input.request.videos })
    }
  })
})
