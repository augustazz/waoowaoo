import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workspace-resource/projection-revision', () => ({ advanceWorkspaceResourceRevisionInTransaction: vi.fn() }))
import { materializeWorkspaceResourceInTransaction } from '@/lib/workspace-resource/persistence'

function transaction() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'project' }]),
    workspaceResource: {
      findUnique: vi.fn().mockResolvedValue({ id: 'video', projectId: 'project', userId: 'owner', resourceKind: 'file',
        mediaType: 'video', schemaId: 'project.composite_video', status: 'pending', currentVersion: 0, deletedAt: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    mediaObject: { findUnique: vi.fn().mockImplementation(async ({ where }) => ({
      id: where.id, mimeType: where.id === 'poster' ? 'image/jpeg' : 'video/mp4', sha256: null, sizeBytes: BigInt(10),
    })) },
    workspaceResourceVersion: { create: vi.fn() },
  }
  return { tx, typed: tx as unknown as Prisma.TransactionClient }
}
const input = {
  resourceId: 'video', projectId: 'project', userId: 'owner', mediaType: 'video' as const, schemaId: 'project.composite_video',
  content: { kind: 'media' as const, mediaId: 'media' }, posterMediaId: 'poster', inputs: [],
  provenance: { operationId: 'merge_videos', taskId: 'task', operationExecutionId: null, toolCallId: null, prompt: null, modelKey: null, inputHash: null, generationOptions: {} },
}
beforeEach(() => vi.clearAllMocks())
describe('version-bound video poster persistence', () => {
  it('commits video and poster media identities in the same immutable version', async () => {
    const { tx, typed } = transaction()
    await materializeWorkspaceResourceInTransaction(typed, input)
    expect(tx.workspaceResourceVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resourceId: 'video', version: 1, mediaId: 'media', posterMediaId: 'poster' }) })
    expect(tx.workspaceResource.updateMany.mock.calls[0][0].data).not.toHaveProperty('posterMediaId')
  })
  it('rejects non-image poster media before creating the video version', async () => {
    const { tx, typed } = transaction()
    await expect(materializeWorkspaceResourceInTransaction(typed, { ...input, posterMediaId: 'not-image' })).rejects.toThrow('WORKSPACE_RESOURCE_POSTER_MEDIA_INVALID')
    expect(tx.workspaceResourceVersion.create).not.toHaveBeenCalled()
    expect(tx.workspaceResource.updateMany).not.toHaveBeenCalled()
  })
})
