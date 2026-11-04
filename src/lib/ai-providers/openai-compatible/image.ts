import type { AiResolvedSelection } from '@/lib/ai-registry/types'
import type { AiProviderImageExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { captureProviderHttpFailure, ProviderHttpError, readProviderJsonResponse } from '@/lib/ai-providers/failure'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema, enumValidator, nonEmptyStringValidator, stringArrayValidator } from '@/lib/ai-providers/shared/option-schema'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { MAX_IMAGE_BYTES } from '@/lib/http/body-limits'
import { AppError } from '@/lib/errors/app-error'
import { normalizeResponsesBaseUrl, OPENAI_COMPATIBLE_PROVIDER_KEY } from './config'
import { GROK_IMAGE_ASPECT_RATIOS, isGrokImagineImageModel } from './image-options'

/**
 * Channel routers (one-api / new-api) answer 500 with these machine codes when
 * no upstream channel could be selected. The request never reached a model, so
 * it is a proven pre-accept rejection and never a billable submission.
 */
const PRE_ACCEPT_ROUTER_CODES = new Set(['get_channel_failed'])

function rejectedSubmissionCode(status: number): UnifiedErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_INVALID'
  if (status === 402) return 'PROVIDER_BILLING_REQUIRED'
  return 'PROVIDER_SUBMISSION_REJECTED'
}

function isPreAcceptRejection(error: ProviderHttpError): boolean {
  if (error.statusCode >= 400 && error.statusCode < 500) return error.statusCode !== 408
  return error.code !== null && PRE_ACCEPT_ROUTER_CODES.has(error.code)
}

async function throwCompatibleImageHttpFailure(response: Response): Promise<never> {
  const error = await captureProviderHttpFailure({
    response,
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    phase: 'submit',
  })
  if (!isPreAcceptRejection(error)) throw error
  throw new ProviderSubmissionError(rejectedSubmissionCode(error.statusCode), error.message, {
    disposition: 'pre_accept_rejected',
    provider: OPENAI_COMPATIBLE_PROVIDER_KEY,
    details: {
      httpStatus: error.statusCode,
      providerCode: error.code,
    },
    cause: error,
  })
}

export function describeCompatibleImage(selection: AiResolvedSelection) {
  const grokImage = isGrokImagineImageModel(selection.modelId)
  return describeMediaVariantBase({
    selection, modality: 'image', executionMode: 'sync',
    optionSchema: buildMediaOptionSchema('image', {
      excludedKeys: ['resolution', 'keepOriginalAspectRatio', ...(grokImage ? ['size'] : ['aspectRatio'])],
      validators: {
        size: nonEmptyStringValidator(),
        ...(grokImage ? { aspectRatio: enumValidator(GROK_IMAGE_ASPECT_RATIOS) } : {}),
        quality: nonEmptyStringValidator(),
        outputFormat: enumValidator(['png', 'jpeg', 'webp']),
        referenceImages: stringArrayValidator({ maxLength: 16 }),
      },
    }),
  })
}

export async function executeCompatibleImage(input: AiProviderImageExecutionContext): Promise<GenerateResult> {
  if (!input.providerConfig.baseUrl) throw new Error('PROVIDER_BASE_URL_MISSING: openai-compatible')
  const baseUrl = normalizeResponsesBaseUrl(input.providerConfig.baseUrl)
  const options = input.options ?? {}
  const fields = {
    model: input.selection.modelId, prompt: input.prompt, n: 1,
    ...(isGrokImagineImageModel(input.selection.modelId) && options.aspectRatio
      ? { aspect_ratio: options.aspectRatio } : {}),
    ...(options.size ? { size: options.size } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.outputFormat ? { output_format: options.outputFormat } : {}),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
  }
  const references = options.referenceImages ?? []
  const headers: Record<string, string> = { Authorization: `Bearer ${input.providerConfig.apiKey}` }
  let body: string | FormData
  if (references.length) {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, String(value))
    for (const [index, reference] of references.entries()) {
      const dataUrl = await normalizeToBase64ForGeneration(reference)
      const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl)
      if (!match) throw new Error('PROVIDER_REFERENCE_IMAGE_INVALID')
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('PROVIDER_REFERENCE_IMAGE_SIZE_INVALID')
      const extension = match[1] === 'image/jpeg' ? 'jpeg' : match[1] === 'image/webp' ? 'webp' : 'png'
      form.append('image[]', new Blob([new Uint8Array(bytes)], { type: match[1] }), `reference-${index}.${extension}`)
    }
    body = form
  } else {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(fields)
  }
  const response = await fetchWithProviderProxy(`${baseUrl}/images/${references.length ? 'edits' : 'generations'}`, {
    method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(300_000),
  })
  if (!response.ok) throw await throwCompatibleImageHttpFailure(response)
  const payload = await readProviderJsonResponse<{ data?: Array<{ b64_json?: string; url?: string }>; output_format?: string }>({ response, provider: OPENAI_COMPATIBLE_PROVIDER_KEY, phase: 'result' })
  const format = payload.output_format || options.outputFormat || 'png'
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  const urls = Array.isArray(payload.data) ? payload.data.flatMap((image) => {
    if (typeof image.b64_json === 'string' && image.b64_json.trim()) return [`data:${mime};base64,${image.b64_json}`]
    if (typeof image.url === 'string' && /^https?:\/\//u.test(image.url)) return [image.url]
    return []
  }) : []
  if (!urls.length) throw new AppError('EXTERNAL_ERROR', 'Provider returned no images', { provider: OPENAI_COMPATIBLE_PROVIDER_KEY })
  return { success: true, imageUrl: urls[0], imageUrls: urls }
}
