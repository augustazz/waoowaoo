import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { videoMergeTrimSchema, videoMergeOutputSchema, videoMergeEditSchema, parseWorkspaceResourceVideoMergeTaskPayload, VIDEO_MERGE_FPS } from '@/lib/workspace-resource/video-merge-contract'
import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  createWorkspaceResourceFolderInTransaction,
  reserveWorkspaceResourceInTransaction,
  retryWorkspaceResourcesInTransaction,
  bindWorkspaceResourceTasksInTransaction,
  resolveGeneratedWorkspaceResourcePlacement,
  resolveWorkspaceResourceInputs,
  validateWorkspaceResourceWorkflowInputsInTransaction,
  validateWorkspaceResourceInputReferencesInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { resolveProductionFolderPath } from '@/lib/workspace-resource/production-stages'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { workspaceResourceDisplayName } from '@/lib/workspace-resource/path'
import { defineOperation } from '@/lib/operations/define-operation'
import { buildProjectAgentToolInputCorrections, createProjectAgentToolInputSchema } from '@/lib/operations/tool-input-schema'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { musicCompositionPlanDurationMs } from '@/lib/music/composition-plan'
import { musicScoreGenerationOptionsSchema } from '@/lib/music/score-specification'

const mergeVideosNewInputSchema = z.object({
  folderPath: z.string().trim().min(1).max(512).nullable().optional()
    .describe('Optional project-relative destination folder. Omit for the final-cut folder (`成片`); use null for the project root. Missing folders are created atomically with the merged video Resource.'),
  name: z.string().trim().min(1).max(300),
  output: videoMergeOutputSchema,
  videos: z.array(z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
    trim: videoMergeTrimSchema.optional().describe('Optional source interval in seconds, within source duration. The start selects its containing 30 fps frame (rounded down); interval duration is rounded to the nearest frame and must produce at least one frame (minimum 1/60 second). Omit to keep the full source timeline, rounding its duration up to a complete frame.'),
  }).strict()).min(1).max(50),
  musicCues: z.array(z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict()).min(1).max(50).optional(),
  cover: z.object({
    videoIndex: z.number().int().nonnegative()
      .describe('Zero-based index in videos. The selected clip supplies the poster frame.'),
    offsetSeconds: z.number().finite().nonnegative().optional()
      .describe('Offset in seconds from the retained clip start after trimming, rounded to the nearest 30 fps frame and strictly inside that clip. Omit for its first frame.'),
  }).strict().optional().describe('Poster extracted from the actual rendered video. Omit to use the first clip first frame; videoIndex selects another clip, offsetSeconds selects an important moment inside it.'),
}).strict()

function validateMergeSelection(input: z.infer<typeof mergeVideosNewInputSchema>, context: z.RefinementCtx) {
  if (input.cover && input.cover.videoIndex >= input.videos.length) {
    context.addIssue({ code: 'custom', path: ['cover', 'videoIndex'], message: 'Cover videoIndex must point to an item in videos.' })
  }
  if (input.musicCues && (input.output.audioMode === 'mute' || input.videos.some((video) => video.trim))) {
    context.addIssue({ code: 'custom', path: ['musicCues'], message: 'Music cues require the untrimmed source timeline and audioMode preserve.' })
  }
  if (input.musicCues && input.videos.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['musicCues'],
      message: 'Music cues must be placed onto one already-merged source video.',
    })
  }
  if (input.musicCues) {
    const identities = input.musicCues.map((cue) => `${cue.resourceId}:${String(cue.contentVersion)}`)
    if (new Set(identities).size !== identities.length) {
      context.addIssue({ code: 'custom', path: ['musicCues'], message: 'Music cue references must be unique.' })
    }
  }
}

const mergeRetryTargetSchema = z.object({
  kind: z.literal('retry'),
  resourceId: z.string().trim().min(1).max(32),
  expectedTaskId: z.string().trim().min(1).optional()
    .describe('Pin the failed attempt shown to the user; a changed attempt must be reviewed again.'),
}).strict()
const mergeReviseTargetSchema = mergeVideosNewInputSchema.omit({ name: true, folderPath: true }).extend({
  kind: z.literal('revise_failed'),
  resourceId: z.string().trim().min(1).max(32),
  expectedTaskId: z.string().trim().min(1).optional(),
}).strict().superRefine((input, context) => validateMergeSelection({ ...input, name: 'existing' }, context))
const mergeVideosInputSchema = z.union([
  mergeVideosNewInputSchema.superRefine(validateMergeSelection),
  z.object({ request: z.discriminatedUnion('kind', [mergeRetryTargetSchema, mergeReviseTargetSchema]) }).strict(),
])

// MCP/strict tool dialects require an object root. Keep the union inside
// request; API callers can continue to use the original top-level new input.
const mergeVideosToolInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    mergeVideosNewInputSchema.extend({ kind: z.literal('new') }).superRefine(validateMergeSelection),
    mergeRetryTargetSchema,
    mergeReviseTargetSchema,
  ]),
}).strict()

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
  }).passthrough(),
)

type FrozenMusicCuePlacement = {
  readonly inputPosition: number
  readonly startMs: number
  readonly durationMs: number
  readonly fadeInMs: number
  readonly fadeOutMs: number
  readonly gainDb: number
}

async function resolveFrozenMusicCuePlacements(input: {
  readonly userId: string
  readonly projectId: string
  readonly references: readonly WorkspaceResourceInputRef[]
  readonly invalidCue: (index: number, message: string) => never
}): Promise<readonly FrozenMusicCuePlacement[]> {
  const sourceVideo = input.references.find((reference) => reference.role === 'source_video')
  const musicReferences = input.references.filter((reference) => reference.role === 'bgm_audio')
  if (musicReferences.length === 0) return []
  if (!sourceVideo || input.references.filter((reference) => reference.role === 'source_video').length !== 1) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_SOURCE_INVALID')
  }

  const [timeline] = await resolveWorkspaceResourceInputMedia({
    userId: input.userId,
    projectId: input.projectId,
    references: [sourceVideo],
    expectedMediaType: 'video',
  })
  if (!timeline || timeline.durationMs === null) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_TIMELINE_DURATION_MISSING')
  }
  const timelineDurationMs = timeline.durationMs

  const resources = await prisma.workspaceResource.findMany({
    where: {
      id: { in: musicReferences.map((reference) => reference.resourceId) },
      userId: input.userId,
      projectId: input.projectId,
      resourceKind: 'file',
      mediaType: 'audio',
      status: 'ready',
      deletedAt: null,
    },
    select: { id: true, currentVersion: true, generationOptions: true },
  })
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const lineage = await prisma.workspaceResourceLineage.findMany({
    where: {
      OR: musicReferences.map((reference) => ({
        outputResourceId: reference.resourceId,
        outputVersion: reference.contentVersion,
      })),
    },
    select: {
      outputResourceId: true,
      outputVersion: true,
      inputResourceId: true,
      inputVersion: true,
      role: true,
      position: true,
    },
  })

  return musicReferences.map((reference, index) => {
    const resource = resourceById.get(reference.resourceId)
    if (!resource || resource.currentVersion !== reference.contentVersion) {
      input.invalidCue(index, 'Music cue must reference a ready score at its current contentVersion.')
    }
    const specification = musicScoreGenerationOptionsSchema.parse(resource.generationOptions)
    const timelineLineage = lineage.find((candidate) => (
      candidate.outputResourceId === reference.resourceId
      && candidate.outputVersion === reference.contentVersion
      && candidate.role === 'score_timeline'
      && candidate.position === specification.timelineInputPosition
    ))
    if (
      !timelineLineage
      || timelineLineage.inputResourceId !== sourceVideo.resourceId
      || timelineLineage.inputVersion !== sourceVideo.contentVersion
    ) {
      input.invalidCue(index, 'Music cue was scored for a different source video or contentVersion.')
    }
    const durationMs = musicCompositionPlanDurationMs(specification.compositionPlan)
    if (specification.startMs + durationMs > timelineDurationMs) {
      input.invalidCue(index, 'Music cue exceeds the selected source video timeline.')
    }
    return {
      inputPosition: reference.position,
      startMs: specification.startMs,
      durationMs,
      fadeInMs: specification.fadeInMs,
      fadeOutMs: specification.fadeOutMs,
      gainDb: specification.gainDb,
    }
  })
}

async function compileMergeSelection(
  ctx: { readonly userId: string; readonly projectId: string },
  input: Pick<z.infer<typeof mergeVideosNewInputSchema>, 'output' | 'videos' | 'musicCues' | 'cover'>,
  requestEnvelope: boolean,
) {
  const invalidSelection = (path: (string | number)[], message: string): never => {
    const issues = [{ code: 'custom', path: [...(requestEnvelope ? ['request'] : []), ...path], message }]
    throw new ApiError('INVALID_PARAMS', {
      code: 'OPERATION_INPUT_INVALID', operationId: 'merge_videos', message,
      issues,
      corrections: buildProjectAgentToolInputCorrections({
        input: requestEnvelope ? { request: { kind: 'new', ...input } } : input,
        toolInputSchema: createProjectAgentToolInputSchema({ operationId: 'merge_videos', inputSchema: mergeVideosToolInputSchema }),
        issues,
      }),
    })
  }
  const references: readonly WorkspaceResourceInputRef[] = await resolveWorkspaceResourceInputs(prisma, {
    userId: ctx.userId,
    projectId: ctx.projectId,
    references: [
      ...input.videos.map((video, position) => ({ resourceId: video.resourceId, contentVersion: video.contentVersion, role: 'source_video', position })),
      ...(input.musicCues ?? []).map((music, index) => ({
        ...music,
        role: 'bgm_audio',
        position: input.videos.length + index,
      })),
    ],
  })
  const musicCues = await resolveFrozenMusicCuePlacements({
    userId: ctx.userId,
    projectId: ctx.projectId,
    references,
    invalidCue: (index, message) => invalidSelection(['musicCues', index], message),
  })
  const sourceMedia = await resolveWorkspaceResourceInputMedia({ userId: ctx.userId, projectId: ctx.projectId, references: references.filter((reference) => reference.role === 'source_video'), expectedMediaType: 'video' })
  const [ratioWidth, ratioHeight] = input.output.aspectRatio.split(':').map(Number)
  const shortEdge = Number.parseInt(input.output.resolution, 10)
  const scale = shortEdge / Math.min(ratioWidth, ratioHeight)
  const clips = sourceMedia.map((source, index) => {
    const selection = input.videos[index]
    if (!selection || source.reference.resourceId !== selection.resourceId || source.reference.contentVersion !== selection.contentVersion || source.durationMs === null) throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_SOURCE_DURATION_MISSING')
    const startSeconds = selection.trim?.startSeconds ?? 0
    const endSeconds = selection.trim?.endSeconds ?? source.durationMs / 1000
    if (endSeconds > source.durationMs / 1000) invalidSelection(['videos', index, 'trim', 'endSeconds'], `Trim exceeds the source duration of ${source.durationMs / 1000} seconds.`)
    return {
      inputPosition: source.reference.position,
      startFrame: Math.floor(startSeconds * VIDEO_MERGE_FPS),
      frameCount: selection.trim
        ? Math.round((endSeconds - startSeconds) * VIDEO_MERGE_FPS)
        : Math.ceil(endSeconds * VIDEO_MERGE_FPS),
    }
  })
  const coverVideoIndex = input.cover?.videoIndex ?? 0
  const coverClip = clips[coverVideoIndex]
  if (!coverClip) invalidSelection(['cover', 'videoIndex'], 'Cover videoIndex must point to an item in videos.')
  const coverFrameOffset = Math.round((input.cover?.offsetSeconds ?? 0) * VIDEO_MERGE_FPS)
  if (coverFrameOffset >= coverClip.frameCount) {
    invalidSelection(['cover', 'offsetSeconds'], 'Cover offset must be inside the selected video clip.')
  }
  const coverTimestampFrame = clips
    .slice(0, coverVideoIndex)
    .reduce((total, clip) => total + clip.frameCount, 0) + coverFrameOffset
  const edit = videoMergeEditSchema.parse({
    width: Math.round(ratioWidth * scale / 2) * 2,
    height: Math.round(ratioHeight * scale / 2) * 2,
    aspectRatio: input.output.aspectRatio,
    audioMode: input.output.audioMode,
    clips,
    cover: { videoIndex: coverVideoIndex, frame: coverFrameOffset, timestampFrame: coverTimestampFrame },
  })
  const outputDurationMs = edit.clips.reduce((sum, clip) => sum + clip.frameCount, 0) * 1000 / VIDEO_MERGE_FPS
  if (musicCues.some((cue) => cue.startMs + cue.durationMs > outputDurationMs)) {
    invalidSelection(['musicCues'], 'Music cue exceeds the frame-aligned output timeline.')
  }
  return {
    references, musicCues, edit,
    inputHash: stableArgsFingerprint({ references, musicCues, edit }),
    generationOptions: {
      mergeMode: musicCues.length > 0 ? 'score_cues' : 'ordered_concat', ...input.output,
      cover: { videoIndex: coverVideoIndex, offsetSeconds: coverFrameOffset / VIDEO_MERGE_FPS },
    },
  }
}

export function createWorkspaceResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary: 'Create an assembly using request.kind=new with name/output/videos and optional folderPath/musicCues/cover. Select a poster via cover={videoIndex,offsetSeconds}: zero-based video index and optional offset from its trimmed start; omit cover for the first clip first frame. The task extracts and saves the actual rendered frame. Recover a failed merge in place using request.kind=retry with resourceId (exact frozen edit and poster), or request.kind=revise_failed with resourceId and corrected output/videos/musicCues/cover. Both recovery branches preserve identity, name and path; never create a same-name replacement. Trim and concatenate frozen video versions with explicit output aspect ratio, short-edge resolution and audio mode. Each trim specifies source startSeconds/endSeconds; output is frame-aligned at 30 fps. Music cues require an untrimmed single source and preserved audio.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['video'],
        // A merge is the final cut, not a generic video clip: the `final` step
        // requires a composite/rendered output.
        outputSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO],
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      assistantWriteAuthority: {
        kind: 'temporal_operation_execution',
        contractRevision: 'merge_videos/v14',
        followUpPolicy: 'after_all_terminal',
      },
      inputSchema: mergeVideosInputSchema,
      toolInputSchema: createProjectAgentToolInputSchema({
        operationId: 'merge_videos', inputSchema: mergeVideosToolInputSchema,
      }),
      toolInputCanonicalizer: {
        // Durable dispatch validates the tool boundary first, then invokes
        // the operation again with its frozen canonical input. Accept that
        // exact form as well, while advertising only the request envelope.
        inputSchema: z.union([
          mergeVideosToolInputSchema,
          mergeVideosNewInputSchema.superRefine(validateMergeSelection),
        ]),
        canonicalize: async (_ctx, input) => {
          const canonical = mergeVideosInputSchema.safeParse(input)
          if (canonical.success) return canonical.data
          const { request } = mergeVideosToolInputSchema.parse(input)
          if (request.kind !== 'new') return { request }
          // The strict tool schema already checked every key; drop only its
          // transport discriminator before entering the unchanged API input.
          return mergeVideosNewInputSchema.strip().parse(request)
        },
      },
      outputSchema: mergeVideosOutputSchema,
      execute: async (ctx, input) => {
        const recovery = 'request' in input ? input.request : null
        const existing = recovery ? await prisma.workspaceResource.findFirst({
          where: {
            id: recovery.resourceId, userId: ctx.userId, projectId: ctx.projectId,
            resourceKind: 'file', mediaType: 'video', deletedAt: null, activePath: { not: null },
          },
          include: { task: { select: { id: true, type: true, status: true, targetId: true, payload: true } } },
        }) : null
        if (recovery) {
          if (!existing) throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_NOT_FOUND', { resourceId: recovery.resourceId })
          if (!existing.workflowEnabled) throw new ApiError('WORKSPACE_RESOURCE_DISABLED', { resourceId: existing.id })
          if (!['failed', 'canceled'].includes(existing.status)
            || existing.operationId !== 'merge_videos'
            || !existing.taskId || !existing.task || existing.task.id !== existing.taskId || existing.task.type !== TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE
            || existing.task.targetId !== existing.id || !['failed', 'canceled'].includes(existing.task.status)) {
            throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_INVALID', { resourceId: existing.id })
          }
          if (recovery.expectedTaskId && recovery.expectedTaskId !== existing.task.id) {
            throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED', { resourceId: existing.id })
          }
        }
        const frozen = existing?.task ? parseWorkspaceResourceVideoMergeTaskPayload(existing.task.payload) : null
        if (existing && (frozen?.resource.resourceId !== existing.id || frozen.resource.schemaId !== existing.schemaId)) {
          throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_INVALID', { resourceId: existing.id })
        }
        const selection = 'request' in input
          ? input.request.kind === 'revise_failed' ? input.request : null
          : input
        const compiled = selection ? await compileMergeSelection(ctx, selection, 'request' in input || ctx.invocationChannel === 'tool') : null
        const state = compiled ?? (frozen ? {
          references: frozen.resource.inputs, musicCues: frozen.resource.musicCues, edit: frozen.resource.edit,
          inputHash: frozen.resource.inputHash, generationOptions: frozen.resource.generationOptions,
        } : null)
        if (!state) throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_INPUT_MISSING')
        const { references, musicCues, edit, inputHash, generationOptions } = state
        // Exact retries retain frame edits, cue placements and immutable versions.
        if (!compiled) {
          for (const mediaType of ['video', 'audio'] as const) {
            const selected = references.filter((reference) => reference.role === (mediaType === 'video' ? 'source_video' : 'bgm_audio'))
            if (selected.length) await resolveWorkspaceResourceInputMedia({ userId: ctx.userId, projectId: ctx.projectId, references: selected, expectedMediaType: mediaType })
          }
        }
        const requestId = [
          'merge_videos', ctx.userId, ctx.projectId,
          ctx.context.turnId?.trim() || 'no-turn',
          ctx.toolCallId?.trim() || ctx.requestId?.trim() || inputHash,
        ].join(':')
        const resourceId = existing?.id ?? buildWorkspaceResourceId({ operationId: 'merge_videos', requestId, memberIndex: 0 })
        const outputSchemaId = existing?.schemaId ?? WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO
        const folderPath = 'request' in input ? null : resolveProductionFolderPath(input.folderPath, outputSchemaId)
        const outputPath = existing?.workspacePath ?? await resolveGeneratedWorkspaceResourcePlacement(prisma, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          folderPath,
          name: 'request' in input ? '' : input.name,
          resourceId,
          mediaType: 'video',
          schemaId: outputSchemaId,
        })
        const payload = parseWorkspaceResourceVideoMergeTaskPayload({
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
            resourceId,
            mediaType: 'video',
            schemaId: outputSchemaId,
            name: workspaceResourceDisplayName({ workspacePath: outputPath, resourceId }),
          }]),
          resource: {
            resourceId,
            mediaType: 'video' as const,
            schemaId: outputSchemaId,
            prompt: null,
            modelKey: null,
            inputHash,
            inputs: references,
            generationOptions,
            musicCues,
            edit,
            toolCallId: ctx.toolCallId?.trim() || null,
          },
        })
        const result = await submitOperationTask({
          request: ctx.request,
          requestId: ctx.requestId,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
          targetType: 'WorkspaceResource',
          targetId: resourceId,
          operationId: 'merge_videos',
          source: ctx.source,
          operationExecutionId: ctx.operationExecutionId,
          operationExecutionTransaction: ctx.operationExecutionTransaction,
          followUpBatchBinding: ctx.followUpBatchBinding,
          payload,
          decoratePayload: false,
          dedupeKey: existing ? `merge_videos:retry:${resourceId}:${existing.taskId}:${inputHash}` : `merge_videos:${resourceId}:${inputHash}`,
          locale: resolveOperationLocale(ctx.context),
          onTaskCreatedInTransaction: async (tx, task) => {
            if (folderPath) {
              await createWorkspaceResourceFolderInTransaction(tx, {
                userId: ctx.userId,
                projectId: ctx.projectId,
                workspacePath: folderPath,
                sourceType: 'operation_output_folder',
                sourceId: null,
              })
            }
            await validateWorkspaceResourceWorkflowInputsInTransaction(tx, {
              userId: ctx.userId,
              projectId: ctx.projectId,
            }, references)
            await validateWorkspaceResourceInputReferencesInTransaction(tx, {
              userId: ctx.userId,
              projectId: ctx.projectId,
            }, references)
            if (existing) {
              await retryWorkspaceResourcesInTransaction(tx, {
                userId: ctx.userId, projectId: ctx.projectId,
                resources: [{ resourceId, expectedTaskId: existing.taskId!, operationId: 'merge_videos',
                  operationExecutionId: ctx.operationExecutionId ?? null, inputHash, prompt: null, modelKey: null,
                  generationOptions, toolCallId: ctx.toolCallId?.trim() || null }],
              })
              await bindWorkspaceResourceTasksInTransaction(tx, {
                userId: ctx.userId, projectId: ctx.projectId, bindings: [{ resourceId, taskId: task.id }],
              })
              return
            }
            await reserveWorkspaceResourceInTransaction(tx, {
              resourceId,
              userId: ctx.userId,
              projectId: ctx.projectId,
              outputPath,
              mediaType: 'video',
              schemaId: outputSchemaId,
              operationId: 'merge_videos',
              inputHash,
              taskId: task.id,
              operationExecutionId: ctx.operationExecutionId ?? null,
              toolCallId: ctx.toolCallId?.trim() || null,
              generationOptions,
            })
          },
        })
        return mergeVideosOutputSchema.parse({ ...result, resourceId, workspacePath: outputPath })
      },
    }),
  }
}
