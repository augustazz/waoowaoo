import type { AiResolvedSelection, AiLlmProviderConfig } from '@/lib/ai-registry/types'
import type { AiProviderVideoExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import type { AsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { captureProviderHttpFailure, readProviderJsonResponse } from '@/lib/ai-providers/failure'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildVideoOptionSchema } from '@/lib/ai-providers/shared/option-schema'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { normalizeResponsesBaseUrl, OPENAI_COMPATIBLE_PROVIDER_KEY as PROVIDER } from './config'
import { resolveDeclaredVideoContract, videoChannelUnavailableReason } from '@/lib/ai-registry/video-contracts'
import { videoConstraintIssue } from '@/lib/ai-registry/video-constraints'
import { validateGenerationReferences } from '@/lib/ai-registry/generation-reference-policy'
import { compatibleVideoAsyncTaskProvider } from './async-task'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function field(payload: unknown, ...paths: string[]): unknown {
  const root = record(payload)
  for (const source of [root, record(root?.data)]) {
    for (const path of paths) {
      let value: unknown = source
      for (const part of path.split('.')) value = record(value)?.[part]
      if (value !== undefined && value !== null && value !== '') return value
    }
  }
  return undefined
}

function textField(payload: unknown, ...paths: string[]): string {
  const value = field(payload, ...paths)
  return typeof value === 'string' ? value.trim() : ''
}

function baseUrl(config: AiLlmProviderConfig): string {
  if (!config.baseUrl) throw new Error('PROVIDER_BASE_URL_MISSING: openai-compatible (video)')
  return normalizeResponsesBaseUrl(config.baseUrl)
}

function publicMediaUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('COMPATIBLE_VIDEO_PUBLIC_HTTPS_MEDIA_REQUIRED')
  }
  return value
}

export function describeCompatibleVideo(selection: AiResolvedSelection) {
  const model = resolveDeclaredVideoContract(selection.modelKey)
  if (!model) throw new Error(`VIDEO_MODEL_CAPABILITIES_UNKNOWN:${selection.modelKey}`)
  return describeMediaVariantBase({
    selection, modality: 'video', executionMode: 'async',
    optionSchema: buildVideoOptionSchema({ ...model, objectValidators: [(options) => {
      if (model.promptMaxChars && typeof options.prompt === 'string' && options.prompt.length > model.promptMaxChars) return { ok: false, reason: 'VIDEO_PROMPT_TOO_LONG' }
      const count = (key: string) => Array.isArray(options[key]) ? options[key].length : 0
      const issue = videoConstraintIssue(model.rules, {
        ...options, referenceImages: count('referenceImages'), referenceAudios: count('referenceAudios'), referenceVideos: count('referenceVideos'),
      })
      return issue ? { ok: false, reason: issue } : { ok: true }
    }] }),
  })
}

export async function executeCompatibleVideo(input: AiProviderVideoExecutionContext): Promise<GenerateResult> {
  const contract = resolveDeclaredVideoContract(input.selection.modelKey)
  if (!contract) throw new Error('VIDEO_MODEL_CAPABILITIES_UNKNOWN')
  const unavailable = videoChannelUnavailableReason(contract, input.providerConfig.baseUrl)
  if (unavailable) throw new Error(`VIDEO_MODEL_${unavailable.toUpperCase()}`)
  const options = input.options ?? {}
  const prompt = options.prompt?.trim()
  if (!prompt) throw new Error('COMPATIBLE_VIDEO_PROMPT_REQUIRED')
  if (contract.promptMaxChars && prompt.length > contract.promptMaxChars) throw new Error('VIDEO_PROMPT_TOO_LONG')
  const firstFrame = input.imageUrl.trim()
  const lastFrame = options.lastFrameImageUrl?.trim()
  const images = options.referenceImages ?? []
  const audios = options.referenceAudios ?? []
  const videos = options.referenceVideos ?? []
  const mode = firstFrame ? lastFrame ? 'first_last_frame' : 'first_frame'
    : images.length + audios.length + videos.length ? 'reference' : 'text_to_video'
  const constraint = videoConstraintIssue(contract.rules, {
    ...options, inputMode: mode, referenceImages: images.length, referenceAudios: audios.length, referenceVideos: videos.length,
  })
  if (constraint) throw new Error(constraint)
  if (lastFrame && !firstFrame) throw new Error('COMPATIBLE_VIDEO_FIRST_FRAME_REQUIRED')
  if (firstFrame && images.length + audios.length + videos.length > 0) {
    throw new Error('COMPATIBLE_VIDEO_FRAMES_WITH_REFERENCES_UNSUPPORTED')
  }
  const caps = contract.capabilities
  const referenceIssue = validateGenerationReferences({
    mediaType: 'video',
    limits: { maxReferenceImages: caps.maxReferenceImages ?? 0, maxReferenceAudios: caps.maxReferenceAudios ?? 0,
      maxReferenceVideos: caps.maxReferenceVideos ?? 0, maxReferenceFiles: caps.maxReferenceFiles ?? 0,
      referenceAudioRequiresVisual: caps.referenceAudioRequiresVisual === true, supportedInputModes: caps.supportedInputModes ?? [] },
    references: [
      ...(firstFrame ? [{ channel: 'image' as const, role: 'first_frame' }] : []),
      ...(lastFrame ? [{ channel: 'image' as const, role: 'last_frame' }] : []),
      ...images.map(() => ({ channel: 'image' as const, role: 'reference_image' })),
      ...audios.map(() => ({ channel: 'audio' as const, role: 'reference_audio' })),
      ...videos.map(() => ({ channel: 'video' as const, role: 'reference_video' })),
    ],
  })
  if (referenceIssue) throw new Error(referenceIssue.code)
  const payload = {
    model: input.selection.modelId, prompt,
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    ...(options.aspectRatio ? { ratio: options.aspectRatio } : {}),
    ...(options.resolution ? { resolution: options.resolution } : {}),
    ...(options.generateAudio !== undefined ? { generate_audio: options.generateAudio } : {}),
    ...(firstFrame ? { first_frame: { image_url: publicMediaUrl(firstFrame) } } : {}),
    ...(lastFrame ? { last_frame: { image_url: publicMediaUrl(lastFrame) } } : {}),
    ...(images.length ? { reference_images: images.map((value) => ({ image_url: publicMediaUrl(value) })) } : {}),
    ...(audios.length ? { reference_audios: audios.map((value) => ({ audio_url: publicMediaUrl(value) })) } : {}),
    ...(videos.length ? { reference_videos: videos.map((value) => ({ video_url: publicMediaUrl(value) })) } : {}),
  }
  // Never retry POST here: a timeout or 5xx can still mean a paid job exists.
  const response = await fetchWithProviderProxy(`${baseUrl(input.providerConfig)}/videos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.providerConfig.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(300_000),
  })
  if (!response.ok) {
    const error = await captureProviderHttpFailure({ response, provider: PROVIDER, phase: 'submit' })
    if ((response.status >= 400 && response.status < 500 && response.status !== 408)
      || error.code === 'get_channel_failed') {
      throw new ProviderSubmissionError(
        response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH_INVALID'
          : response.status === 402 ? 'PROVIDER_BILLING_REQUIRED' : 'PROVIDER_SUBMISSION_REJECTED',
        error.message, { disposition: 'pre_accept_rejected', provider: PROVIDER, cause: error },
      )
    }
    throw error
  }
  const result = await readProviderJsonResponse({ response, provider: PROVIDER, phase: 'submit' })
  const requestId = textField(result, 'id', 'task_id', 'request_id')
  if (!requestId) throw new Error('COMPATIBLE_VIDEO_SUBMIT_ID_MISSING')
  return {
    success: true, async: true, requestId, endpoint: 'videos',
    externalId: compatibleVideoAsyncTaskProvider.formatExternalId({
      type: 'VIDEO', requestId, providerToken: input.selection.provider,
    }),
  }
}

export async function queryCompatibleVideoStatus(input: {
  providerConfig: AiLlmProviderConfig
  requestId: string
}): Promise<AsyncPollResult> {
  const url = `${baseUrl(input.providerConfig)}/videos/${encodeURIComponent(input.requestId)}`
  const response = await fetchWithProviderProxy(url, {
    headers: { Authorization: `Bearer ${input.providerConfig.apiKey}` },
    redirect: 'error', signal: AbortSignal.timeout(60_000), cache: 'no-store',
  })
  if (!response.ok) throw await captureProviderHttpFailure({ response, provider: PROVIDER, phase: 'poll' })
  const result = await readProviderJsonResponse({ response, provider: PROVIDER, phase: 'poll' })
  const status = textField(result, 'status', 'state').toLowerCase()
  // No queued sub-phase: this gateway does not document provider cancellation.
  if (['queued', 'pending', 'processing', 'running', 'in_progress', 'submitted', 'created'].includes(status)) {
    return { status: 'pending' }
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(status)) {
    return {
      status: 'failed',
      failure: createProviderAsyncTaskFailure({
        provider: PROVIDER, code: 'EXTERNAL_ERROR', cause: result,
        message: textField(result, 'fail_reason', 'error.message', 'message', 'error') || `Video generation ${status}`,
      }),
    }
  }
  if (!['completed', 'succeeded', 'success', 'done'].includes(status)) {
    // Gateways use additional intermediate states (generating, starting,
    // waiting, etc.). An accepted job stays pending until a known terminal
    // state or the task's generation deadline, not the HTTP retry budget.
    return { status: 'pending' }
  }
  const directUrl = textField(result, 'url', 'video.url', 'content.video_url', 'output.url', 'video_url')
  const videoUrl = directUrl ? new URL(directUrl, `${baseUrl(input.providerConfig)}/`).toString() : `${url}/content`
  if (!/^https?:\/\//u.test(videoUrl)) throw new Error('COMPATIBLE_VIDEO_RESULT_URL_INVALID')
  // A CDN result must never receive the gateway API key. Only the gateway's
  // authenticated content endpoint needs it; signed URLs retain their query.
  const contentEndpoint = new URL(videoUrl)
  if (contentEndpoint.username || contentEndpoint.password) throw new Error('COMPATIBLE_VIDEO_RESULT_URL_INVALID')
  const downloadHeaders = contentEndpoint.origin === new URL(url).origin
    && contentEndpoint.pathname === new URL(`${url}/content`).pathname
    ? { Authorization: `Bearer ${input.providerConfig.apiKey}` } : undefined
  return { status: 'completed', videoUrl, resultUrl: videoUrl, ...(downloadHeaders ? { downloadHeaders } : {}) }
}
