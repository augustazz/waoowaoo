import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import { createWorkspaceResourceGenerationOperations } from '@/lib/operations/domains/workspace-resource/generation-ops'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

const mocks = vi.hoisted(() => ({ append: vi.fn() }))
vi.mock('@/lib/workspace-resource/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workspace-resource/persistence')>(),
  appendWorkspaceResourceUserContentInTransaction: mocks.append,
}))

const context = { userId: 'user', projectId: 'project', context: {} } as ProjectAgentOperationContext
const direction = {
  schemaVersion: 1, outputKind: 'creative_direction',
  styleSummary: '校园写实', rawUserStyle: null,
  visual: { visualStyle: '自然摄影', assetImageStyle: { lighting: '柔和日光', texture: '真实材质' } },
  narrative: '主观记忆', directing: '固定机位', editing: '硬切',
  sound: '保留对白与环境声。', assetPolicy: '复用已确认素材。', assumptions: [], warnings: [],
}

describe('project document schema validation', () => {
  beforeEach(() => vi.clearAllMocks())

  function transaction() {
    return {
      workspaceResource: { findFirst: vi.fn(async () => ({
        id: 'direction', resourceKind: 'file', mediaType: 'text', schemaId: 'project.creative_direction',
        workspacePath: '方向/第一集.json', currentVersion: 4,
      })) },
    } as unknown as Prisma.TransactionClient
  }

  async function execute(operationId: 'save_project_document' | 'revise_project_document', data: unknown) {
    const operation = createWorkspaceResourceGenerationOperations()[operationId]
    if (!operation.executeInTransaction) throw new Error('Expected transactional document operation')
    const input = operation.inputSchema.safeParse({
      ...(operationId === 'save_project_document'
        ? { name: '第一集' }
        : { resourceId: 'direction', expectedContentVersion: 4 }),
      content: { kind: 'structured', data },
    })
    if (!input.success) throw new Error('Invalid document operation input')
    return await operation.executeInTransaction(context, input.data, transaction(), undefined)
  }

  it.each(['save_project_document', 'revise_project_document'] as const)(
    '%s reports the unsupported musicPlan field through the model boundary without writing',
    async (operationId) => {
      const error = await execute(operationId, {
        ...direction, musicPlan: { decision: 'sparse_two_singles' },
      }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ApiError)
      const projected = normalizeOperationExecutionToolError({ operationId, error })
      expect(projected.details).toMatchObject({
        reasonCode: 'PROJECT_DOCUMENT_SCHEMA_INVALID', field: 'content.data',
        corrections: [expect.objectContaining({
          action: 'remove_unknown_field', fieldPath: '$input.content.data.musicPlan',
          allowedKeys: expect.arrayContaining(['sound', 'visual', 'outputKind']),
        })],
        failure: { action: 'revise_input' },
      })
      expect(mocks.append).not.toHaveBeenCalled()
    },
  )

  it('reports sound as a string and saves the repaired choice while preserving the other fields', async () => {
    const error = await execute('revise_project_document', {
      ...direction, sound: { decision: 'two_cues_sparse' },
    }).catch((error: unknown) => error)
    const projected = normalizeOperationExecutionToolError({ operationId: 'revise_project_document', error })
    expect(projected.details).toMatchObject({
      corrections: [expect.objectContaining({ action: 'fix_invalid_value', fieldPath: '$input.content.data.sound' })],
    })
    expect(mocks.append).not.toHaveBeenCalled()

    const repaired = {
      ...direction,
      sound: `${direction.sound} 第一集：用户已在配乐选择卡明确选择“两处单音，其余留白”（two_cues_sparse）。纸条展开用钢琴单音，合盖用一记鼓点；成片剪辑确定后再制作配乐。`,
    }
    mocks.append.mockResolvedValue({ resourceId: 'direction', contentVersion: 5 })
    expect(await execute('revise_project_document', repaired)).toMatchObject({
      success: true, previousContentVersion: 4, contentVersion: 5,
    })
    expect(mocks.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      resourceId: 'direction', expectedContentVersion: 4, content: { kind: 'structured', data: repaired },
    }))
  })
})
