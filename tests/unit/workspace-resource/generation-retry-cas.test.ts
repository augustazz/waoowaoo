import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resources: vi.fn(), submit: vi.fn(), advance: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  workspaceResource: { findMany: mocks.resources },
  project: { findFirst: vi.fn(async () => ({ videoRatio: '9:16' })) },
} }))
vi.mock('@/lib/workspace-resource/projection-revision', () => ({ advanceWorkspaceResourceRevisionInTransaction: mocks.advance }))
vi.mock('@/lib/ai-exec/media-preflight', () => ({
  preflightMediaGenerationOptions: vi.fn(async ({ options }) => ({ options, selection: {} })),
  preflightMediaProviderRoutes: vi.fn(),
}))
vi.mock('@/lib/project-production-context', async (original) => ({
  ...await original<typeof import('@/lib/project-production-context')>(),
  readProductionPlanningContext: vi.fn(async () => ({ fixedParameters: {} })),
}))
vi.mock('@/lib/model-access/production-model', async (original) => ({
  ...await original<typeof import('@/lib/model-access/production-model')>(),
  requireProductionModel: vi.fn(() => 'openai-compatible:custom::seedance-example-v3-720p'),
}))
vi.mock('@/lib/ai-registry/video-execution-contract', () => ({
  captureVideoExecutionContract: vi.fn(async (_userId, modelKey) => ({
    schemaVersion: 1, modelKey, protocol: 'json-videos-v1', revision: 'test@1',
    fingerprint: 'b'.repeat(64), channelFingerprint: 'c'.repeat(64),
  })),
  assertVideoExecutionContract: vi.fn(),
}))
vi.mock('@/lib/operations/planning', async (original) => ({
  ...await original<typeof import('@/lib/operations/planning')>(),
  requirePlannedTaskBillingInfo: vi.fn(() => ({ billable: false })),
  submitPlannedOperationTasks: mocks.submit,
}))
vi.mock('../../../config/video-model-contracts.json', async () => ({ default: (await import('../../fixtures/video-contract-catalog.json')).default }))

import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { createWorkspaceResourceGenerationOperations } from '@/lib/operations/domains/workspace-resource/generation-ops'
import { createVoiceOperations } from '@/lib/operations/domains/voice/voice-ops'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { TASK_TYPE } from '@/lib/task/types'

beforeEach(() => { vi.clearAllMocks(); ensureAiCatalogsRegistered() })

describe('generation retry plans pin the failed task identity', () => {
  it.each(['image-retry', 'video-retry', 'video-revise', 'voice-retry'] as const)('rejects a stale %s plan after another retry fails without replacing its frozen input', async (mode) => {
    const mediaType = mode === 'image-retry' ? 'image' : mode === 'voice-retry' ? 'audio' : 'video'
    const modelKey = `openai-compatible:custom::${mediaType === 'image' ? 'gpt-image-2' : 'seedance-example-v3-720p'}`
    const schemaId = mode === 'voice-retry' ? 'project.voice_reference' : `generic.${mediaType}`
    const payload = {
      protocol: 'workspace_resource_generation_v2', count: 1,
      lifecycleProjection: { resources: [{ resourceId: 'resource', mediaType, schemaId, name: 'Original' }] },
      [mediaType === 'image' ? 'imageModel' : mode === 'voice-retry' ? 'voiceModel' : 'videoModel']: modelKey,
      ...(mode === 'voice-retry' ? { previewText: 'A spoken preview.', language: 'en' } : {}),
      generationOptions: { aspectRatio: '9:16', resolution: mediaType === 'image' ? '1K' : '720p' },
      ...(mediaType === 'video' ? { durationSeconds: 5 } : {}),
      resource: {
        resourceId: 'resource', workspacePath: 'Original', mediaType, schemaId, inputHash: 'a'.repeat(64),
        prompt: 'Original prompt', modelKey, inputs: [], imageInputPositions: [], audioInputPositions: [], videoInputPositions: [],
        toolCallId: null, sourceTurnId: null,
      },
    }
    mocks.resources.mockResolvedValue([{
      id: 'resource', workspacePath: 'Original', schemaId, mediaType, memberIndex: 0,
      prompt: payload.resource.prompt, modelKey, generationOptions: payload.generationOptions,
      workflowEnabled: true, task: { id: 'failed-task-A', type: mediaType === 'image' ? TASK_TYPE.WORKSPACE_RESOURCE_IMAGE : mode === 'voice-retry' ? TASK_TYPE.WORKSPACE_RESOURCE_VOICE : TASK_TYPE.WORKSPACE_RESOURCE_VIDEO, payload },
    }])
    const ctx = { userId: 'user', projectId: 'project', context: {} } as ProjectAgentOperationContext
    const operation = mode === 'voice-retry' ? createVoiceOperations().generate_voice
      : createWorkspaceResourceGenerationOperations()[mediaType === 'image' ? 'create_image' : 'create_video']
    const parsed = operation.inputSchema.safeParse({ request: mode === 'video-revise'
      ? { kind: 'revise_failed', items: [{ resourceId: 'resource', prompt: 'Revised prompt', durationSeconds: 5, options: { resolution: '720p' } }] }
      : { kind: 'retry', resourceIds: ['resource'] } })
    if (!parsed.success) throw parsed.error
    const input = parsed.data
    if (!operation.plan || !operation.commit) throw new Error('Missing generation plan handlers')
    const plan = await operation.plan(ctx, input)
    expect(plan.metadata).toMatchObject({ resources: [{ resourceId: 'resource', expectedTaskId: 'failed-task-A' }] })

    // A different retry was accepted and failed after this plan was built.
    const current = { status: 'failed', taskId: 'failed-task-B', prompt: 'Newer prompt', generationOptions: { resolution: 'newer' } }
    const updateMany = vi.fn(async ({ where, data }) => {
      if (where.taskId !== current.taskId) return { count: 0 }
      Object.assign(current, data)
      return { count: 1 }
    })
    const tx = { $queryRaw: vi.fn(async () => [{ id: 'project' }]), workspaceResource: { updateMany } } as unknown as Prisma.TransactionClient
    const authorized = { ...ctx, executionAuthorization: { transaction: tx, operationExecutionId: 'execution' } } as ProjectAgentOperationContext
    await expect(operation.commit(authorized, input, plan)).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED', status: 409 })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ taskId: 'failed-task-A' }) }))
    expect(current).toEqual({ status: 'failed', taskId: 'failed-task-B', prompt: 'Newer prompt', generationOptions: { resolution: 'newer' } })
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })
})
