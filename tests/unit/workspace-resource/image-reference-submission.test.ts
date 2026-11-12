import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ materialize: vi.fn(), settleFailure: vi.fn() }))
vi.mock('@/lib/workspace-resource/persistence', () => ({
  materializeWorkspaceResourceInTransaction: mocks.materialize,
  settleWorkspaceResourceFailureInTransaction: mocks.settleFailure,
}))

import { materializeWorkspaceResourceTaskTerminalInTransaction } from '@/lib/workspace-resource/task-materializer'
import { TASK_TYPE } from '@/lib/task/types'

const reference = { resourceId: 'character', contentVersion: 2, position: 0, purpose: 'identity' }
const options = { resolution: '1K', imageProvenance: { itemId: 'K02', shotId: 'K02' } }
const task = {
  id: 'task', userId: 'user', projectId: 'project', type: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
  targetType: 'WorkspaceResource', targetId: 'frame', operationId: 'create_image', operationExecutionId: 'execution',
  payload: {
    protocol: 'workspace_resource_generation_v2', count: 1, imageModel: 'google::gemini-3-pro-image-preview',
    lifecycleProjection: { resources: [{ resourceId: 'frame', mediaType: 'image', schemaId: 'generic.image', name: 'K02' }] },
    generationOptions: options,
    resource: {
      resourceId: 'frame', workspacePath: 'K02.png', mediaType: 'image', schemaId: 'generic.image',
      inputHash: 'a'.repeat(64), prompt: '@图片1 provides identity', modelKey: 'google::gemini-3-pro-image-preview',
      inputs: [{ ...reference, role: 'reference_image', channel: 'image', workspacePath: 'character.png' }],
      imageInputPositions: [0], audioInputPositions: [], videoInputPositions: [], toolCallId: null, sourceTurnId: null,
    },
  },
} as const

describe('image reference submission provenance', () => {
  beforeEach(() => {
    mocks.materialize.mockReset().mockResolvedValue({ resourceId: 'frame', contentVersion: 1 })
  })

  async function complete(result: Record<string, unknown>) {
    await materializeWorkspaceResourceTaskTerminalInTransaction({} as Prisma.TransactionClient, {
      kind: 'completed', task,
      result: { mediaId: 'generated-image', modelKey: 'google::gemini-3-pro-image-preview', ...result },
    })
    return mocks.materialize.mock.calls[0][1].provenance.generationOptions
  }

  it('persists the worker-submitted ordered versions and purposes alongside the original recipe', async () => {
    const references = [reference, { resourceId: 'scene', contentVersion: 3, position: 2, purpose: 'scene' }]
    expect(await complete({ imageReferences: references })).toEqual({
      ...options, imageReferenceSubmission: { status: 'submitted', references },
    })
    expect(task.payload.generationOptions).toEqual(options)
  })

  it('records an explicit empty submission without inventing provider references from lineage', async () => {
    expect(await complete({ imageReferences: [] })).toEqual({
      ...options, imageReferenceSubmission: { status: 'submitted', references: [] },
    })
  })

  it('does not claim older workers submitted references when no evidence exists', async () => {
    expect(await complete({})).toEqual(options)
  })
})
