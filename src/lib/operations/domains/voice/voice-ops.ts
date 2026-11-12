import { z } from 'zod'
import { readProductionPlanningContext } from '@/lib/project-production-context'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  assertUniqueWorkspaceResourcePaths,
  workspaceResourceDisplayName,
} from '@/lib/workspace-resource/path'
import {
  bindWorkspaceResourceTasksInTransaction,
  createWorkspaceResourceFolderInTransaction,
  reserveWorkspaceResourceInTransaction,
  resolveGeneratedWorkspaceResourcePlacement,
  retryWorkspaceResourcesInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { resolveProductionFolderPath } from '@/lib/workspace-resource/production-stages'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { requireProductionModel } from '@/lib/model-access/production-model'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
} from '@/lib/operations/planning'
import type { OperationPlan, PlannedTask } from '@/lib/operations/plan-contract'
import { refineTaskBatchSubmitOperationOutputSchema, taskBatchSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint, stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import {
  preflightMediaGenerationOptions,
  preflightMediaProviderRoutes,
} from '@/lib/ai-exec/media-preflight'
import { AiOptionValidationError } from '@/lib/ai-exec/normalize'
import { ApiError } from '@/lib/api-errors'
import {
  voicePreviewTargetIssue,
} from '@/lib/voice/preview-contract'

const voiceNewSchema = z.object({
  kind: z.literal('new'),
  folderPath: z.string().trim().min(1).max(512).nullable().optional()
    .describe('Optional project-relative destination folder. Missing folders are created atomically with the voice Resources.'),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(4_000),
  previewText: z.string().trim().min(1).max(10_000)
    .describe('A phonetically varied sample within the configured model’s preview text limits. This exact text is billed by character count; consider downstream reference-audio duration limits.'),
  language: z.string().trim().min(1).max(32),
  count: z.number().int().min(1).max(6).default(1),
}).strict()

const voiceRetrySchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(6),
}).strict()

const generateVoiceInputSchema = z.object({
  request: z.discriminatedUnion('kind', [voiceNewSchema, voiceRetrySchema]),
}).strict().superRefine((value, context) => {
  if (value.request.kind === 'retry'
    && new Set(value.request.resourceIds).size !== value.request.resourceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['request', 'resourceIds'],
      message: 'resourceIds must be unique',
    })
  }
  if (value.request.kind === 'new') {
    const issue = voicePreviewTargetIssue(value.request)
    if (issue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['request', 'previewText'],
        message: issue,
      })
    }
  }
})

const generateVoiceOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
  taskBatchSubmitOperationOutputSchemaBase.extend({
    total: z.number().int().positive(),
    taskIds: z.array(z.string().min(1)).min(1),
    results: z.array(z.object({ refId: z.string().min(1), taskId: z.string().min(1) }).strict()).min(1),
    resources: z.array(z.object({
      resourceId: z.string().min(1),
      workspacePath: z.string().min(1),
      memberIndex: z.number().int().nonnegative(),
    }).strict()).min(1),
  }).passthrough(),
)

const voicePlanMetadataSchema = z.object({
  requestId: z.string().min(1),
  retry: z.boolean(),
  alternatives: z.boolean(),
  resources: z.array(z.object({
    expectedTaskId: z.string().min(1).optional(),
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
    folderPath: z.string().min(1).nullable(),
    memberIndex: z.number().int().nonnegative(),
    taskPlanId: z.string().min(1),
  }).strict()).min(1),
}).strict()

async function preflightVoiceGeneration(
  ctx: ProjectAgentOperationContext,
  voiceModel: string,
  requestedLanguage: string,
  description: string,
  previewText: string,
  selectionSource?: 'frozen_task',
): Promise<string> {
  try {
    const preflight = await preflightMediaGenerationOptions({
      userId: ctx.userId,
      selectionSource,
      modelKey: voiceModel,
      modality: 'voice',
      options: { language: requestedLanguage },
      voiceInput: { description, text: previewText },
    })
    const language = typeof preflight.options?.language === 'string'
      ? preflight.options.language
      : requestedLanguage
    preflightMediaProviderRoutes({
      selection: preflight.selection,
      modality: 'voice',
      options: { language },
      voiceInput: { description, text: previewText },
    })
    return language
  } catch (error) {
    if (error instanceof AiOptionValidationError) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VOICE_GENERATION_OPTION_INVALID',
        field: error.field ?? 'language',
        reason: error.reason ?? error.failure,
      }, { cause: error })
    }
    throw error
  }
}

async function planNewVoice(
  ctx: ProjectAgentOperationContext,
  request: z.infer<typeof voiceNewSchema>,
): Promise<OperationPlan> {
  const production = await readProductionPlanningContext(ctx)
  const voiceModel = requireProductionModel(production, 'voice')
  const language = await preflightVoiceGeneration(ctx, voiceModel, request.language, request.description, request.previewText)
  const fingerprint = stableArgsHash({ request, voiceModel })
  const requestId = [
    'generate_voice', ctx.userId, ctx.projectId,
    ctx.context.turnId?.trim() || 'no-turn',
    ctx.toolCallId?.trim() || ctx.requestId?.trim() || fingerprint,
    fingerprint,
  ].join(':')
  const folderPath = resolveProductionFolderPath(
    request.folderPath,
    WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
  )
  const resources = await Promise.all(Array.from({ length: request.count }, async (_, memberIndex) => {
    const resourceId = buildWorkspaceResourceId({ operationId: 'generate_voice', requestId, memberIndex })
    const workspacePath = await resolveGeneratedWorkspaceResourcePlacement(prisma, {
      userId: ctx.userId,
      projectId: ctx.projectId,
      folderPath,
      name: request.name,
      resourceId,
      mediaType: 'audio',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      alternativeIndex: request.count > 1 ? memberIndex : null,
    })
    return {
      resourceId,
      workspacePath,
      folderPath,
      memberIndex,
      taskPlanId: `generate_voice:${resourceId}`,
    }
  }))
  assertUniqueWorkspaceResourcePaths(resources.map((resource) => resource.workspacePath))
  const tasks = resources.map((resource) => {
    const inputHash = stableArgsFingerprint({
      description: request.description,
      previewText: request.previewText,
      language,
      voiceModel,
      memberIndex: resource.memberIndex,
    })
    const payload = {
      lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        name: workspaceResourceDisplayName({
          workspacePath: resource.workspacePath,
          resourceId: resource.resourceId,
        }),
      }]),
      protocol: 'workspace_resource_generation_v2' as const,
      resource: {
        resourceId: resource.resourceId,
        workspacePath: resource.workspacePath,
        mediaType: 'audio' as const,
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        inputHash,
        prompt: request.description,
        modelKey: voiceModel,
        inputs: [],
        imageInputPositions: [],
        audioInputPositions: [],
        videoInputPositions: [],
        toolCallId: ctx.toolCallId?.trim() || null,
        sourceTurnId: ctx.context.turnId?.trim() || null,
      },
      voiceModel,
      previewText: request.previewText,
      language,
      count: 1 as const,
      generationOptions: { language },
    }
    return createPlannedTask({
      id: resource.taskPlanId,
      taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
      targetType: 'WorkspaceResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      dedupeKey: `generate_voice:${resource.resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
        payload,
        allowedApiTypes: ['voice'],
      }),
    })
  })
  return {
    kind: 'task_submission',
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: resources.map((resource) => resource.resourceId),
    metadata: { requestId, retry: false, alternatives: request.count > 1, resources },
  }
}

async function planRetryVoice(
  ctx: ProjectAgentOperationContext,
  resourceIds: readonly string[],
): Promise<OperationPlan> {
  const rows = await prisma.workspaceResource.findMany({
    where: {
      id: { in: [...resourceIds] },
      userId: ctx.userId,
      projectId: ctx.projectId,
      resourceKind: 'file',
      mediaType: 'audio',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      status: { in: ['failed', 'canceled'] },
      deletedAt: null,
    },
    include: { task: { select: { id: true, type: true, payload: true } } },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const resources = await Promise.all(resourceIds.map(async (resourceId, memberIndex) => {
    const row = byId.get(resourceId)
    if (!row?.task || row.task.type !== TASK_TYPE.WORKSPACE_RESOURCE_VOICE) {
      throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_INVALID', { resourceId })
    }
    const source = parseWorkspaceResourceGenerationTaskPayload(row.task.payload)
    if (
      source.voiceModel !== source.resource.modelKey
      || typeof source.language !== 'string'
      || !source.language.trim()
      || typeof source.resource.prompt !== 'string'
      || !source.resource.prompt.trim()
      || typeof source.previewText !== 'string'
      || !source.previewText.trim()
    ) {
      throw new Error(`WORKSPACE_RESOURCE_VOICE_RETRY_FROZEN_INPUT_INVALID:${resourceId}`)
    }
    await preflightVoiceGeneration(ctx, source.voiceModel, source.language, source.resource.prompt, source.previewText, 'frozen_task')
    return {
      resourceId,
      workspacePath: row.workspacePath,
      memberIndex: row.memberIndex ?? memberIndex,
      taskPlanId: `generate_voice:retry:${resourceId}`,
      sourceTask: row.task,
    }
  }))
  const tasks = resources.map((resource): PlannedTask => {
    const sourcePayload = parseWorkspaceResourceGenerationTaskPayload(resource.sourceTask.payload)
    const payload = parseWorkspaceResourceGenerationTaskPayload({
      ...sourcePayload,
      lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        name: workspaceResourceDisplayName({
          workspacePath: resource.workspacePath,
          resourceId: resource.resourceId,
        }),
      }]),
    })
    return createPlannedTask({
      id: resource.taskPlanId,
      taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
      targetType: 'WorkspaceResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      dedupeKey: `generate_voice:retry:${resource.resourceId}:${resource.sourceTask.id}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
        payload,
        allowedApiTypes: ['voice'],
      }),
    })
  })
  return {
    kind: 'task_submission',
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: [],
    metadata: {
      requestId: `generate_voice:retry:${stableArgsHash(resourceIds)}`,
      retry: true,
      alternatives: false,
      resources: resources.map((resource) => ({
        resourceId: resource.resourceId,
        expectedTaskId: resource.sourceTask.id,
        workspacePath: resource.workspacePath,
        folderPath: null,
        memberIndex: resource.memberIndex,
        taskPlanId: resource.taskPlanId,
      })),
    },
  }
}

async function commitVoice(ctx: ProjectAgentOperationContext, plan: OperationPlan) {
  const authorization = ctx.executionAuthorization
  if (!authorization) throw new Error('OPERATION_EXECUTION_AUTHORIZATION_REQUIRED')
  const metadata = voicePlanMetadataSchema.parse(plan.metadata)
  if (!metadata.retry) {
    const folderPaths = new Set(metadata.resources.flatMap((resource) => (
      resource.folderPath ? [resource.folderPath] : []
    )))
    for (const folderPath of folderPaths) {
      await createWorkspaceResourceFolderInTransaction(authorization.transaction, {
        userId: ctx.userId,
        projectId: ctx.projectId,
        workspacePath: folderPath,
        sourceType: 'operation_output_folder',
        sourceId: null,
      })
    }
    for (const resource of metadata.resources) {
      const task = plan.tasks.find((candidate) => candidate.id === resource.taskPlanId)
      if (!task) throw new Error(`VOICE_PLAN_TASK_MISSING:${resource.taskPlanId}`)
      const payload = parseWorkspaceResourceGenerationTaskPayload(task.payload)
      await reserveWorkspaceResourceInTransaction(authorization.transaction, {
        resourceId: resource.resourceId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        outputPath: resource.workspacePath,
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        memberIndex: resource.memberIndex,
        operationExecutionId: authorization.operationExecutionId,
        alternativeGroupExecutionId: metadata.alternatives ? authorization.operationExecutionId : null,
        operationId: 'generate_voice',
        inputHash: payload.resource.inputHash,
        prompt: payload.resource.prompt,
        modelKey: payload.resource.modelKey,
        generationOptions: payload.generationOptions,
        toolCallId: ctx.toolCallId?.trim() || null,
      })
    }
  } else {
    await retryWorkspaceResourcesInTransaction(authorization.transaction, {
      userId: ctx.userId,
      projectId: ctx.projectId,
      resources: metadata.resources.map((resource) => {
        const task = plan.tasks.find((candidate) => candidate.id === resource.taskPlanId)
        if (!task) throw new Error(`VOICE_PLAN_TASK_MISSING:${resource.taskPlanId}`)
        const payload = parseWorkspaceResourceGenerationTaskPayload(task.payload)
        if (!resource.expectedTaskId) {
          throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED', { resourceId: resource.resourceId })
        }
        return {
          resourceId: resource.resourceId,
          expectedTaskId: resource.expectedTaskId,
          operationId: 'generate_voice',
          operationExecutionId: authorization.operationExecutionId,
          inputHash: payload.resource.inputHash,
          prompt: payload.resource.prompt,
          modelKey: payload.resource.modelKey,
          generationOptions: payload.generationOptions,
          toolCallId: ctx.toolCallId?.trim() || null,
        }
      }),
    })
  }
  const submitted = await submitPlannedOperationTasks({ ctx, operationId: 'generate_voice' })
  const results = plan.tasks.map((task) => {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`VOICE_TASK_RESULT_MISSING:${task.id}`)
    return result
  })
  await bindWorkspaceResourceTasksInTransaction(authorization.transaction, {
    userId: ctx.userId,
    projectId: ctx.projectId,
    bindings: metadata.resources.map((resource) => {
      const result = submitted.get(resource.taskPlanId)
      if (!result) throw new Error(`VOICE_TASK_RESULT_MISSING:${resource.taskPlanId}`)
      return { resourceId: resource.resourceId, taskId: result.taskId }
    }),
  })
  const first = results[0]
  if (!first) throw new Error('VOICE_OPERATION_PLAN_EMPTY')
  return generateVoiceOutputSchema.parse({
    ...first,
    total: results.length,
    taskIds: results.map((result) => result.taskId),
    results: metadata.resources.map((resource, index) => ({
      refId: resource.resourceId,
      taskId: results[index]?.taskId ?? '',
    })),
    resources: metadata.resources.map((resource) => ({
      resourceId: resource.resourceId,
      workspacePath: resource.workspacePath,
      memberIndex: resource.memberIndex,
    })),
  })
}

export function createVoiceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_voice: defineOperation({
      id: 'generate_voice',
      productionModality: 'voice',
      summary: 'Design voice preview audio Resources with server-owned placement. Alternatives are independent Tasks; retry reuses the original frozen payload.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: false,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['audio'],
        outputSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE],
        placement: 'required',
        alternativeGeneration: {
          kind: 'request_count',
          mediaKind: 'voice',
          requestKind: 'new',
          defaultSchemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
          minCount: 1,
          maxCount: 6,
          inputLimits: { promptMaxLength: 4_000, previewTextMaxLength: 10_000 },
        },
      },
      confirmation: { kind: 'billable_media', required: true },
      planContractRevision: 'voice-generation/v12',
      inputSchema: generateVoiceInputSchema,
      outputSchema: generateVoiceOutputSchema,
      plan: async (ctx, input) => input.request.kind === 'retry'
        ? await planRetryVoice(ctx, input.request.resourceIds)
        : await planNewVoice(ctx, input.request),
      commit: async (ctx, _input, plan) => await commitVoice(ctx, plan),
    }),
  }
}
