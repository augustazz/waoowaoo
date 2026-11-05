import { describeUnknownError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import { withLogContext } from '@/lib/logging/context'
import {
  generateImage,
  generateVideo,
  type AiImageExecutionOptions,
  type AiVideoExecutionOptions,
} from '@/lib/ai-exec/engine'
import {
  cancelAsyncProviderTaskBestEffort,
  ProviderQueueTimeoutError,
  waitForAsyncProviderResult,
} from '@/lib/ai-exec/async-wait'
import { cancelAsyncTask } from '@/lib/ai-exec/async-poll'
import { ProviderTaskFailureError } from '@/lib/ai-exec/provider-errors'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { processMediaResult } from '@/lib/media-process'
import { TaskTerminatedError } from '@/lib/task/errors'
import {
  listTaskAcceptedProviderExternalIds,
  markTaskProviderInvocationReplayAuthorizedByExternalId,
  readTaskProviderInvocationRouteSelection,
} from '@/lib/task/provider-invocation'
import { isTaskActive } from '@/lib/task/service'
import { AppError } from '@/lib/errors/app-error'
import { reportTaskProgress } from './progress'
import type { TaskExecutionContext } from './context'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { resolveOutboundProxyUrl } from '@/lib/http/outbound-proxy'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import {
  resolveProviderVideoReferencePayload,
  type VideoReferenceImageInput,
} from '@/lib/video-generation/reference-images'

export async function requireTaskProviderRouteSelection(
  context: TaskExecutionContext,
  invocationKey: string,
) {
  const route = await readTaskProviderInvocationRouteSelection({
    taskId: context.data.taskId,
    invocation: { key: invocationKey },
  })
  if (!route) {
    throw new Error(`TASK_PROVIDER_ROUTE_SELECTION_MISSING:${context.data.taskId}:${invocationKey}`)
  }
  return route
}

export async function resolveTaskProviderProxyUrl(
  userId: string,
  providerId: string,
): Promise<string | null> {
  try {
    const config = await getProviderConfig(userId, providerId)
    const providerProxyUrl = typeof config.proxyUrl === 'string' ? config.proxyUrl.trim() : ''
    return providerProxyUrl || resolveOutboundProxyUrl()
  } catch {
    // Proxy lookup is best-effort. A removed or changed provider config must not
    // block downloading a media result that was already generated.
    return resolveOutboundProxyUrl()
  }
}

function summarizeImageGenerationOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const value = options || {}
  const referenceImagesValue = (value as { referenceImages?: unknown }).referenceImages
  const referenceImageCount = Array.isArray(referenceImagesValue) ? referenceImagesValue.length : 0
  return {
    provider:
      typeof (value as { provider?: unknown }).provider === 'string'
        ? (value as { provider: string }).provider
        : undefined,
    aspectRatio:
      typeof (value as { aspectRatio?: unknown }).aspectRatio === 'string'
        ? (value as { aspectRatio: string }).aspectRatio
        : undefined,
    resolution:
      typeof (value as { resolution?: unknown }).resolution === 'string'
        ? (value as { resolution: string }).resolution
        : undefined,
    quality:
      typeof (value as { quality?: unknown }).quality === 'string'
        ? (value as { quality: string }).quality
        : undefined,
    size:
      typeof (value as { size?: unknown }).size === 'string'
        ? (value as { size: string }).size
        : undefined,
    referenceImageCount,
    optionKeys: Object.keys(value),
  }
}

function jsonStringifySafe(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"<unserializable>"'
  }
}

function scopedTaskExecutionLogger(job: TaskExecutionContext, action: string) {
  return createScopedLogger({
    module: 'task.execution',
    action,
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
}

/**
 * Best-effort compensation for external jobs owned by an already committed
 * canceled Task. This function has no authority over Task status: lookup or
 * provider failures are logged and swallowed, while exact terminal replay may
 * safely invoke it again because provider cancellation is idempotent.
 */
export async function cancelAcceptedTaskProviderJobsAfterTerminal(input: {
  readonly taskId: string
  readonly userId: string
}): Promise<void> {
  const logger = createScopedLogger({
    module: 'task.execution',
    action: 'task.execution.external.cancel_after_terminal',
    taskId: input.taskId,
    userId: input.userId,
  })
  // Ledger access is infrastructure, so lookup failure must escape and let
  // Temporal retry this post-terminal Activity. Only the provider-side
  // best-effort calls below are intentionally swallowed.
  const externalIds = await listTaskAcceptedProviderExternalIds(input.taskId)
  await Promise.all(
    externalIds.map(async (externalId) => {
      try {
        const outcome = await cancelAsyncTask(externalId, input.userId)
        logger.info({
          message:
            outcome === 'canceled'
              ? 'accepted external task cancel accepted by provider'
              : 'provider does not declare cancel; accepted external task left to expire',
          details: { externalId, outcome },
        })
      } catch (error) {
        logger.warn({
          message:
            'best-effort cancel of accepted external task failed after local cancellation committed',
          details: { externalId },
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: describeUnknownError(error) },
        })
      }
    }),
  )
}

export async function assertTaskActive(job: TaskExecutionContext, stage: string) {
  job.heartbeat()
  if (job.signal.aborted) {
    throw new TaskTerminatedError(job.data.taskId, `Task execution cancelled during ${stage}`)
  }
  const active = await isTaskActive(job.data.taskId)
  if (active) return
  throw new TaskTerminatedError(job.data.taskId, `Task terminated during ${stage}`)
}

function normalizeExternalId(
  result: {
    async?: boolean
    externalId?: string
    requestId?: string
    endpoint?: string
  },
  mediaType: 'IMAGE' | 'VIDEO',
) {
  if (!result.async) return null
  const externalId = typeof result.externalId === 'string' ? result.externalId.trim() : ''
  if (externalId) return externalId
  throw new Error(
    `ASYNC_EXTERNAL_ID_MISSING: async ${mediaType} task returned without standard externalId`,
  )
}

export async function waitExternalResult(
  job: TaskExecutionContext,
  externalId: string,
  userId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; progressStart?: number; progressEnd?: number },
) {
  const progressStart = opts?.progressStart ?? 40
  const progressEnd = opts?.progressEnd ?? 90
  const startAt = Date.now()
  const logger = scopedTaskExecutionLogger(job, 'task.execution.external.poll')

  logger.info({
    message: 'external poll started',
    details: {
      externalId,
      timeoutMs: opts?.timeoutMs ?? null,
      intervalMs: opts?.intervalMs ?? null,
    },
  })

  try {
    const result = await waitForAsyncProviderResult({
      externalId,
      userId,
      timeoutMs: opts?.timeoutMs,
      intervalMs: opts?.intervalMs,
      beforePoll: async () => await assertTaskActive(job, 'polling_external'),
      onPending: async ({ elapsedRatio, phase }) => {
        const progress = progressStart + Math.floor((progressEnd - progressStart) * elapsedRatio)
        await reportTaskProgress(job, progress, {
          stage: 'polling_external',
          externalId,
          externalPhase: phase,
        })
        await assertTaskActive(job, 'polling_external_wait')
      },
    })
    logger.info({
      message: 'external poll completed',
      durationMs: Date.now() - startAt,
      details: { externalId },
    })
    return result
  } catch (error) {
    if (error instanceof ProviderQueueTimeoutError) {
      const queueError = new AppError('GENERATION_QUEUE_TIMEOUT', error.message, {
        details: {
          externalId,
          externalStatus: 'queue_timeout',
          queuedMs: error.queuedMs,
          queueTimeoutMs: error.queueTimeoutMs,
        },
        cause: error,
      })
      // 顺序契约（PG-06A 排队超时补偿）：先把Provider checkpoint从submitted
      // 原子推进为replay_authorized，再尽力取消Provider侧任务。下一attempt
      // 只能经同一invocation identity重新授权，不能从Task投影推断提交许可。
      await markTaskProviderInvocationReplayAuthorizedByExternalId({
        taskId: job.data.taskId,
        externalId,
        error: queueError,
      })
      const replayAuthorized = new AppError('GENERATION_QUEUE_TIMEOUT', error.message, {
        details: {
          externalId,
          externalStatus: 'queue_timeout',
          queuedMs: error.queuedMs,
          queueTimeoutMs: error.queueTimeoutMs,
        },
        operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT_REPLAY_AUTHORIZED,
        cause: queueError,
      })
      logger.error({
        message: replayAuthorized.message,
        errorCode: 'GENERATION_QUEUE_TIMEOUT',
        retryable: true,
        durationMs: Date.now() - startAt,
        details: {
          externalId,
        },
      })
      await cancelAsyncProviderTaskBestEffort({ externalId, userId })
      throw replayAuthorized
    }
    if (error instanceof ProviderTaskFailureError) {
      const terminalError = AppError.fromFailure(error.failure, error)
      logger.error({
        message: terminalError.message,
        errorCode: error.failure.interpretation.code,
        retryable: error.failure.recovery.taskReplay === 'safe',
        durationMs: Date.now() - startAt,
        details: {
          externalId,
        },
      })
      throw terminalError
    }
    throw error
  }
}

export async function resolveImageSourceFromGeneration(
  job: TaskExecutionContext,
  params: {
    userId: string
    modelId: string
    prompt: string
    options?: AiImageExecutionOptions
    /**
     * A durable identity for this exact provider submission. A Task may make
     * more than one independent image request, so callers that fan out must
     * supply a stable per-request key rather than sharing the default.
     */
    invocationKey?: string
    pollProgress?: { start?: number; end?: number }
  },
): Promise<string> {
  const logger = scopedTaskExecutionLogger(job, 'task.execution.image.generate_source')
  const startedAt = Date.now()
  const invocationKey =
    params.invocationKey === undefined ? 'media:image:primary' : params.invocationKey.trim()
  if (!invocationKey) throw new Error('IMAGE_PROVIDER_INVOCATION_KEY_REQUIRED')
  const providerKey = parseModelKeyStrict(params.modelId)?.provider ?? ''
  logger.info({
    message: 'image source generation started',
    provider: providerKey || undefined,
    details: {
      model: params.modelId,
    },
  })

  logger.info({
    message: 'image source generation calling generateImage',
    details: {
      model: params.modelId,
      referenceImageCount: params.options?.referenceImages?.length ?? 0,
      optionKeys: Object.keys(params.options || {}),
    },
  })

  const finalOptions: AiImageExecutionOptions = { ...(params.options || {}) }

  let result: Awaited<ReturnType<typeof generateImage>>
  try {
    result = await withLogContext(
      { projectId: job.data.projectId, taskId: job.data.taskId, userId: params.userId },
      () =>
        generateImage(params.userId, params.modelId, params.prompt, finalOptions, {
          key: invocationKey,
        }),
    )
  } catch (error) {
    // The Provider Gateway is the sole classifier for durable submission
    // outcomes. Preserve its typed error so an ambiguous POST remains
    // replay-forbidden instead of being flattened into GENERATION_FAILED.
    if (error instanceof AppError) throw error
    throw new AppError(
      'EXTERNAL_ERROR',
      [
        'IMAGE_GENERATION_THROWN',
        `modelKey=${params.modelId}`,
        providerKey ? `providerKey=${providerKey}` : 'providerKey=<unset>',
        `options=${jsonStringifySafe(summarizeImageGenerationOptions(finalOptions))}`,
        `cause=${describeUnknownError(error)}`,
      ].join(' '),
      { provider: providerKey || null, cause: error },
    )
  }
  if (result.imageUrl) {
    logger.info({
      message: 'image source generation completed',
      provider: providerKey || undefined,
      durationMs: Date.now() - startedAt,
    })
    return result.imageUrl
  }
  if (result.imageBase64) {
    logger.info({
      message: 'image source generation completed (base64)',
      provider: providerKey || undefined,
      durationMs: Date.now() - startedAt,
    })
    return `data:image/png;base64,${result.imageBase64}`
  }

  const externalId = normalizeExternalId(result, 'IMAGE')
  if (!externalId) {
    throw new Error('Image generation returned no image and no external id')
  }

  const polled = await waitExternalResult(job, externalId, params.userId, {
    progressStart: params.pollProgress?.start ?? 40,
    progressEnd: params.pollProgress?.end ?? 92,
  })
  logger.info({
    message: 'image source generation completed (async)',
    provider: providerKey || undefined,
    durationMs: Date.now() - startedAt,
    details: {
      externalId,
    },
  })
  return polled.url
}

export async function resolveVideoSourceFromGeneration(
  job: TaskExecutionContext,
  params: {
    userId: string
    modelId: string
    referenceImages: readonly VideoReferenceImageInput[]
    referenceAudios?: readonly string[]
    referenceVideos?: readonly string[]
    options?: AiVideoExecutionOptions
    pollProgress?: { start?: number; end?: number }
  },
): Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }> {
  const logger = scopedTaskExecutionLogger(job, 'task.execution.video.generate_source')
  const startedAt = Date.now()

  logger.info({
    message: 'video source generation started',
    details: {
      model: params.modelId,
    },
  })

  const providerReferencePayload = resolveProviderVideoReferencePayload({
    referenceImages: params.referenceImages,
  })
  const providerRequestOptions: Record<string, string | number | boolean | string[]> = {}
  for (const [key, value] of Object.entries(params.options || {})) {
    if (
      key === 'referenceImages' ||
      key === 'lastFrameImageUrl' ||
      value === undefined
    )
      continue
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      providerRequestOptions[key] = value
    }
  }

  const result = await withLogContext(
    { projectId: job.data.projectId, taskId: job.data.taskId, userId: params.userId },
    () =>
      generateVideo(
        params.userId,
        params.modelId,
        providerReferencePayload.imageUrl,
        {
          ...providerRequestOptions,
          ...providerReferencePayload.options,
          ...(params.referenceAudios && params.referenceAudios.length > 0
            ? { referenceAudios: [...params.referenceAudios] }
            : {}),
          ...(params.referenceVideos && params.referenceVideos.length > 0
            ? { referenceVideos: [...params.referenceVideos] }
            : {}),
        },
        { key: 'media:video:primary' },
      ),
  )
  if (result.videoUrl) {
    logger.info({
      message: 'video source generation completed',
      durationMs: Date.now() - startedAt,
    })
    return { url: result.videoUrl }
  }

  const externalId = normalizeExternalId(result, 'VIDEO')
  if (!externalId) {
    throw new Error('Video generation returned no video and no external id')
  }

  const polled = await waitExternalResult(job, externalId, params.userId, {
    progressStart: params.pollProgress?.start ?? 45,
    progressEnd: params.pollProgress?.end ?? 94,
  })
  logger.info({
    message: 'video source generation completed (async)',
    durationMs: Date.now() - startedAt,
    details: {
      externalId,
    },
  })
  return {
    url: polled.url,
    ...(typeof polled.actualVideoTokens === 'number'
      ? { actualVideoTokens: polled.actualVideoTokens }
      : {}),
    ...(polled.downloadHeaders ? { downloadHeaders: polled.downloadHeaders } : {}),
  }
}

export async function uploadImageSourceToStorage(
  source: string | Buffer,
  keyPrefix: string,
  targetId: string,
  taskArtifact?: { taskId: string; artifact: string },
  proxyUrl?: string | null,
) {
  return await processMediaResult({
    source,
    type: 'image',
    keyPrefix,
    targetId,
    proxyUrl,
    taskArtifact,
  })
}

export async function uploadVideoSourceToStorage(
  source: string | Buffer,
  keyPrefix: string,
  targetId: string,
  downloadHeaders?: Record<string, string>,
  taskArtifact?: { taskId: string; artifact: string },
  proxyUrl?: string | null,
) {
  return await processMediaResult({
    source,
    type: 'video',
    keyPrefix,
    targetId,
    downloadHeaders,
    proxyUrl,
    taskArtifact,
  })
}
