import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({ advance: vi.fn() }))
vi.mock('@/lib/workspace-resource/projection-revision', () => ({
  advanceWorkspaceResourceRevisionInTransaction: mocks.advance,
}))
vi.mock('@/lib/workspace-resource/content-store', () => ({
  storeWorkspaceResourceContent: vi.fn(), workspaceResourceContentPreview: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  resolveWorkspaceResourceInputs,
  retryWorkspaceResourcesInTransaction,
  setWorkspaceResourceWorkflowInTransaction,
  validateWorkspaceResourceInputReferencesInTransaction,
  validateWorkspaceResourceWorkflowInputsInTransaction,
} from '@/lib/workspace-resource/persistence'
import { countProductionContentRows, summarizeProductionStepContent } from '@/lib/workspace-resource/production-content'
import { summarizeProductionStages } from '@/lib/workspace-resource/production-stages'
import { canvasDraftReferenceCandidate } from '@/features/project-workspace/canvas/create/canvas-draft'
import type { WorkspaceResourceCardView } from '@/features/project-workspace/canvas/contracts/workspace-canvas-interactions'

const scope = { userId: 'owner', projectId: 'project' }
const reference = { resourceId: 'image', contentVersion: 1, workspacePath: '资产/角色/旧图', role: 'reference_image', position: 0 }

function transaction() {
  const state = { id: 'image', workflowEnabled: true, status: 'ready' }
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (query) => query.sql.includes('FROM projects') ? [{ id: 'project' }] : [{ ...state }]),
    workspaceResource: {
      findFirst: vi.fn().mockImplementation(async () => ({ ...state })),
      findMany: vi.fn().mockImplementation(async () => [{ ...state, workspacePath: reference.workspacePath, currentVersion: 1 }]),
      update: vi.fn().mockImplementation(async ({ data }) => Object.assign(state, data)),
    },
    workspaceResourceVersion: { findUnique: vi.fn().mockResolvedValue({ id: 'v1' }), findFirst: vi.fn().mockResolvedValue({ id: 'v1' }) },
    task: { findFirst: vi.fn().mockResolvedValue(null) },
  }
  return { tx, typed: tx as unknown as Prisma.TransactionClient, state }
}

beforeEach(() => { vi.clearAllMocks() })

describe('reversible resource workflow participation', () => {
  it('disables and restores the same resource, advancing the projection only when changed', async () => {
    const { tx, typed, state } = transaction()
    await setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'image', workflowEnabled: false })
    expect(state.workflowEnabled).toBe(false)
    expect(tx.$queryRaw.mock.calls[1][0].values).toEqual(['image', scope.userId, scope.projectId])
    expect(tx.$queryRaw.mock.calls[1][0].sql).toContain("resourceKind = 'file' AND deletedAt IS NULL AND activePath IS NOT NULL")
    expect(tx.workspaceResource.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'image' }, data: { workflowEnabled: false } })
    await setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'image', workflowEnabled: false })
    expect(mocks.advance).toHaveBeenCalledTimes(1)
    await setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'image', workflowEnabled: true })
    expect(state.workflowEnabled).toBe(true)
    expect(mocks.advance).toHaveBeenCalledTimes(2)
  })

  it('rejects a missing or foreign file without writing', async () => {
    const { tx, typed } = transaction()
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'project' }]).mockResolvedValueOnce([])
    await expect(setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'foreign', workflowEnabled: false })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(tx.workspaceResource.update).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('rejects a foreign project before reading the resource', async () => {
    const { tx, typed } = transaction()
    tx.$queryRaw.mockResolvedValue([])
    await expect(setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'foreign', workflowEnabled: false })).rejects.toThrow('WORKSPACE_RESOURCE_PROJECT_NOT_OWNED')
    expect(tx.workspaceResource.findFirst).not.toHaveBeenCalled()
  })

  it('does not change a generating resource', async () => {
    const { tx, typed, state } = transaction()
    state.status = 'pending'
    await expect(setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'image', workflowEnabled: false })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_WORKFLOW_BUSY' })
    expect(tx.workspaceResource.update).not.toHaveBeenCalled()
  })

  it('reports an active task conflict as HTTP 409 when resource status has already settled', async () => {
    const { tx, typed } = transaction()
    tx.task.findFirst.mockResolvedValue({ id: 'still-processing' })
    await expect(setWorkspaceResourceWorkflowInTransaction(typed, { ...scope, resourceId: 'image', workflowEnabled: false })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(tx.workspaceResource.update).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('rejects disabled inputs in new plans and accepts them after restoration', async () => {
    const { typed, state } = transaction()
    state.workflowEnabled = false
    await expect(resolveWorkspaceResourceInputs(typed, { ...scope, references: [reference] })).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_DISABLED' })
    state.workflowEnabled = true
    await expect(resolveWorkspaceResourceInputs(typed, { ...scope, references: [reference] })).resolves.toEqual([reference])
  })

  it('rechecks current input participation under locks when committing a saved plan', async () => {
    const { typed, tx } = transaction()
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'project' }]).mockResolvedValueOnce([{ id: 'image', workflowEnabled: false }])
    await expect(validateWorkspaceResourceWorkflowInputsInTransaction(typed, scope, [reference])).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_DISABLED' })
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'project' }]).mockResolvedValueOnce([{ id: 'image', workflowEnabled: true }])
    await expect(validateWorkspaceResourceWorkflowInputsInTransaction(typed, scope, [reference])).resolves.toBeUndefined()
  })

  it('keeps frozen input versions valid for already accepted jobs after disabling', async () => {
    const { typed, tx, state } = transaction()
    state.workflowEnabled = false
    await expect(validateWorkspaceResourceInputReferencesInTransaction(typed, scope, [reference])).resolves.toBeUndefined()
    expect(tx.workspaceResourceVersion.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { resourceId: 'image', version: 1, resource: { ...scope, resourceKind: 'file' } }, select: { id: true },
    })
  })
})

describe('workflow projections', () => {
  const oldImage = {
    id: 'old', name: 'Old image', workspacePath: '资产/角色/旧图', status: 'ready' as const,
    schemaId: 'generic.image', mediaType: 'image' as const, currentVersion: 1,
    updatedAt: new Date(), previewUrl: '/m/old', workflowEnabled: false,
  }

  it('keeps disabled files visible while excluding their completion counts and primary output', () => {
    const [group] = summarizeProductionStepContent({ grouping: 'asset_type', rows: [oldImage] })
    expect(group.items).toMatchObject([{ resourceId: 'old', workflowEnabled: false, previewUrl: '/m/old' }])
    expect(group.primaryResourceId).toBeNull()
    expect(group.status).toBe('empty')
    expect(group.counts.total).toBe(0)
    const newImage = { ...oldImage, id: 'new', workflowEnabled: true }
    const [withNew] = summarizeProductionStepContent({ grouping: 'asset_type', rows: [oldImage, newImage] })
    expect(withNew.primaryResourceId).toBe('new')
    expect(withNew.items).toHaveLength(2)
    expect(withNew.counts.ready).toBe(1)
    expect(countProductionContentRows([oldImage, newImage]).total).toBe(1)
    const stages = summarizeProductionStages([oldImage])
    expect(stages.every(stage => stage.counts.total === 0 && stage.primaryResourceId === null)).toBe(true)
  })

  it('does not let disabled cards be attached to a generation draft', () => {
    const disabled: WorkspaceResourceCardView = {
      resource: {
        resourceId: 'image', projectId: scope.projectId, resourceKind: 'file', mediaType: 'image',
        workspacePath: reference.workspacePath, ancestors: [], name: 'Old image', schemaId: 'generic.image',
        status: 'ready', workflowEnabled: false, contentVersion: 1, current: null, summary: { kind: 'empty' },
        prompt: null, modelName: null, generationOptions: null, operationId: null, memberIndex: null,
        alternativeGroupExecutionId: null, alternativeGroup: null, inputs: [], inputSummaries: [],
        actions: [], taskId: null, error: null, deletedAt: null, createdAt: '', updatedAt: '',
      },
      inputSummaries: [], download: null, alternativeGroup: null, canvasOperations: [],
      presentation: { rendererKey: 'resourceCard', fallbackMediaType: 'image', summary: { kind: 'empty' } },
    }
    expect(canvasDraftReferenceCandidate(disabled)).toBeNull()
    expect(canvasDraftReferenceCandidate({ ...disabled, resource: { ...disabled.resource, workflowEnabled: true } })).not.toBeNull()
  })
})


describe('failed resource retry compare-and-set', () => {
  it('keeps the original path and versions, and rejects stale attempts or concurrent pending retries', async () => {
    const { tx, typed } = transaction()
    const state = { status: 'failed', taskId: 'failed-task' }
    const updateMany = vi.fn().mockImplementation(async ({ where, data }) => {
      if (!where.status.in.includes(state.status) || where.taskId !== state.taskId) return { count: 0 }
      Object.assign(state, data)
      return { count: 1 }
    })
    Object.assign(tx.workspaceResource, { updateMany })
    const input = { ...scope, resources: [{ resourceId: 'merge', expectedTaskId: 'failed-task', operationId: 'merge_videos',
      operationExecutionId: 'execution', inputHash: 'hash', prompt: null, modelKey: null,
      generationOptions: { mergeMode: 'ordered_concat' }, toolCallId: null }] }
    await retryWorkspaceResourcesInTransaction(typed, input)
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ ...scope, workflowEnabled: true, activePath: { not: null }, deletedAt: null, taskId: 'failed-task' })
    expect(state.status).toBe('pending')
    const data = updateMany.mock.calls[0][0].data
    for (const field of ['workspacePath', 'activePath', 'name', 'schemaId', 'currentVersion']) expect(data).not.toHaveProperty(field)
    await expect(retryWorkspaceResourcesInTransaction(typed, input)).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED', status: 409 })
    state.status = 'failed'
    state.taskId = 'newer-failed-task'
    await expect(retryWorkspaceResourcesInTransaction(typed, input)).rejects.toMatchObject({ code: 'WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED', status: 409 })
    expect(mocks.advance).toHaveBeenCalledTimes(1)
  })
})
