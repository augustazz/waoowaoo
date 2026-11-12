import type { Prisma } from '@prisma/client'
import { getTaskDefinition } from '@/lib/task/definition'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type {
  WorkspaceResourceInputRef,
  WorkspaceResourceJsonValue,
  WorkspaceResourceMediaType,
} from './contracts'
import { parseWorkspaceResourceGenerationTaskPayload } from './generation-contract'
import {
  materializeWorkspaceResourceInTransaction,
  settleWorkspaceResourceFailureInTransaction,
} from './persistence'
import { parseWorkspaceResourceVideoMergeTaskPayload } from './video-merge-contract'

type TerminalTask = {
  readonly id: string
  readonly userId: string
  readonly projectId: string
  readonly type: TaskType
  readonly targetType: string
  readonly targetId: string
  readonly payload: unknown
  readonly operationId: string | null
  readonly operationExecutionId: string | null
}

type TerminalResourcePayload = {
  readonly resourceId: string
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: string
  readonly prompt: string | null
  readonly inputHash: string
  readonly inputs: readonly WorkspaceResourceInputRef[]
  readonly generationOptions: WorkspaceResourceJsonValue
  readonly toolCallId: string | null
  readonly sourceTurnId: string | null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseTerminalResourcePayload(task: TerminalTask): TerminalResourcePayload {
  if (task.type === TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE) {
    const payload = parseWorkspaceResourceVideoMergeTaskPayload(task.payload ?? {})
    return {
      resourceId: payload.resource.resourceId,
      mediaType: payload.resource.mediaType,
      schemaId: payload.resource.schemaId,
      prompt: payload.resource.prompt,
      inputHash: payload.resource.inputHash,
      inputs: payload.resource.inputs,
      generationOptions: payload.resource.generationOptions,
      toolCallId: payload.resource.toolCallId,
      sourceTurnId: null,
    }
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(task.payload ?? {})
  return {
    resourceId: payload.resource.resourceId,
    mediaType: payload.resource.mediaType,
    schemaId: payload.resource.schemaId,
    prompt: payload.resource.prompt,
    inputHash: payload.resource.inputHash,
    inputs: payload.resource.inputs,
    generationOptions: payload.generationOptions,
    toolCallId: payload.resource.toolCallId,
    sourceTurnId: payload.resource.sourceTurnId,
  }
}

export async function materializeWorkspaceResourceTaskTerminalInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly kind: 'completed' | 'failed' | 'canceled'
    readonly task: TerminalTask
    readonly result: Record<string, unknown> | null
  },
): Promise<Record<string, unknown> | null> {
  const definition = getTaskDefinition(input.task.type)
  if (definition.terminalOutputMaterializer === 'none') return null
  if (definition.terminalOutputMaterializer !== 'workspace_resource') {
    const exhaustive: never = definition.terminalOutputMaterializer
    throw new Error(`TASK_TERMINAL_OUTPUT_MATERIALIZER_UNSUPPORTED:${String(exhaustive)}`)
  }
  if (input.task.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${input.task.targetType}`)
  }
  if (input.kind !== 'completed') {
    await settleWorkspaceResourceFailureInTransaction(tx, {
      resourceId: input.task.targetId,
      userId: input.task.userId,
      projectId: input.task.projectId,
      status: input.kind === 'canceled' ? 'canceled' : 'failed',
    })
    return { resourceId: input.task.targetId, resourceStatus: input.kind === 'canceled' ? 'canceled' : 'failed' }
  }
  const payload = parseTerminalResourcePayload(input.task)
  if (payload.resourceId !== input.task.targetId) {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_MISMATCH:${input.task.id}`)
  }
  if (!input.result) throw new Error(`WORKSPACE_RESOURCE_TASK_RESULT_REQUIRED:${input.task.id}`)
  const mediaId = readString(input.result, 'mediaId')
  if (!mediaId) throw new Error(`WORKSPACE_RESOURCE_TASK_MEDIA_ID_REQUIRED:${input.task.id}`)
  const posterMediaId = payload.mediaType === 'video'
    ? readString(input.result, 'posterMediaId')
    : null
  const actualModelKey = definition.terminalModelKeyRequirement === 'none'
    ? null
    : readString(input.result, 'modelKey')
  if (definition.terminalModelKeyRequirement === 'required' && !actualModelKey) {
    throw new Error(`WORKSPACE_RESOURCE_TASK_MODEL_KEY_REQUIRED:${input.task.id}`)
  }
  const materialized = await materializeWorkspaceResourceInTransaction(tx, {
    resourceId: payload.resourceId,
    userId: input.task.userId,
    projectId: input.task.projectId,
    mediaType: payload.mediaType,
    schemaId: payload.schemaId,
    content: { kind: 'media', mediaId },
    posterMediaId,
    inputs: payload.inputs,
    sourceTurnId: payload.sourceTurnId,
    provenance: {
      operationId: input.task.operationId,
      inputHash: payload.inputHash,
      taskId: input.task.id,
      operationExecutionId: input.task.operationExecutionId,
      toolCallId: payload.toolCallId,
      prompt: payload.prompt,
      modelKey: actualModelKey,
      generationOptions: payload.mediaType === 'image' && Array.isArray(input.result.imageReferences) ? {
        ...(payload.generationOptions as Record<string, WorkspaceResourceJsonValue>),
        imageReferenceSubmission: {
          status: 'submitted',
          references: (input.result.imageReferences ?? []) as WorkspaceResourceJsonValue,
        },
      } : payload.mediaType === 'video' && input.result.outputVerification ? {
        ...(payload.generationOptions as Record<string, WorkspaceResourceJsonValue>),
        videoOutputVerification: input.result.outputVerification as WorkspaceResourceJsonValue,
        ...(input.result.videoExecutionContract ? { videoExecutionContract: input.result.videoExecutionContract as WorkspaceResourceJsonValue } : {}),
      } : payload.generationOptions,
    },
  })
  const safeMediaProjection: Record<string, number> = {}
  for (const key of ['width', 'height', 'durationMs'] as const) {
    const value = input.result[key]
    if (typeof value === 'number' && Number.isFinite(value)) safeMediaProjection[key] = value
  }
  return {
    resourceId: materialized.resourceId,
    contentVersion: materialized.contentVersion,
    resourceStatus: 'ready',
    ...(input.result.outputVerification ? { outputVerification: input.result.outputVerification } : {}),
    ...safeMediaProjection,
  }
}
