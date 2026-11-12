import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import type { AiProviderImageExecutionContext } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { AppError } from '@/lib/errors/app-error'
import {
  fetchProviderWithRetry,
  readProviderJsonResponse,
} from '@/lib/ai-providers/failure'
import { throwArkSubmissionError } from './error'
import { requireArkImageModelSpec } from './image-models'
import { assertImageReferenceCount } from '@/lib/ai-providers/shared/image-reference-validation'

const DEFAULT_TIMEOUT_MS = 60 * 1000

export interface ArkImageGenerationRequest {
  model: string
  prompt: string
  response_format?: 'url' | 'b64_json'
  size?: string
  output_format?: 'jpeg' | 'png'
  watermark?: boolean
  image?: string[]
  sequential_image_generation?: 'auto' | 'disabled'
  stream?: boolean
}

export interface ArkImageGenerationResponse {
  data: Array<{ url?: string; b64_json?: string }>
}

export async function arkImageGeneration(
  request: ArkImageGenerationRequest,
  options: { apiKey: string; baseUrl: string; timeoutMs?: number; logPrefix?: string },
): Promise<ArkImageGenerationResponse> {
  if (!options.apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'ark' })

  const { apiKey, baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, logPrefix = '[Ark Image]' } = options
  const url = `${baseUrl.replace(/\/+$/, '')}/images/generations`

  _ulogInfo(`${logPrefix} 开始图片生成请求, 模型: ${request.model}`)
  _ulogInfo(
    `${logPrefix} 请求参数:`,
    JSON.stringify(
      {
        model: request.model,
        size: request.size,
        output_format: request.output_format,
        watermark: request.watermark,
        imageCount: request.image?.length || 0,
        promptLength: request.prompt?.length || 0,
      },
      null,
      2,
    ),
  )

  let response: Response
  try {
    response = await fetchProviderWithRetry({
      url,
      provider: 'ark',
      phase: 'submit',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
        operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
        timeoutMs,
        scope: 'ark:image',
        fetchFn: fetchWithProviderProxy,
      },
    })
  } catch (error: unknown) {
    throwArkSubmissionError(error)
  }

  const data = await readProviderJsonResponse<ArkImageGenerationResponse>({
    response,
    provider: 'ark',
    phase: 'result',
  })
  _ulogInfo(`${logPrefix} 图片生成成功`)
  return data
}

export const ARK_API_TIMEOUT_MS = DEFAULT_TIMEOUT_MS

type ArkImageOptions = NonNullable<AiProviderImageExecutionContext['options']> & {
  outputFormat?: 'jpeg' | 'png'
  watermark?: boolean
}

export async function executeArkImageGeneration(input: AiProviderImageExecutionContext) {
  const options = (input.options ?? {}) as ArkImageOptions
  const { apiKey, baseUrl } = input.providerConfig
  if (!baseUrl) throw new Error('PROVIDER_BASE_URL_MISSING: ark (image)')
  const modelId = requireSelectedModelId(input.selection, 'ark:image')
  const spec = requireArkImageModelSpec(modelId)
  assertImageReferenceCount('ark', options.referenceImages ?? [], spec.maxReferenceImages)

  const arkData = await arkImageGeneration({
    model: spec.modelId,
    prompt: input.prompt,
    ...(spec.sequentialImageGeneration === 'disabled' ? { sequential_image_generation: 'disabled' } : {}),
    response_format: 'url',
    output_format: options.outputFormat,
    watermark: options.watermark,
    size: options.size,
    ...(options.referenceImages?.length ? { image: options.referenceImages } : {}),
  }, { apiKey, baseUrl, logPrefix: '[ARK Image]' })

  const imageUrls = Array.isArray(arkData.data)
    ? arkData.data
      .map((item) => (typeof item?.url === 'string' ? item.url.trim() : ''))
      .filter((item) => item.length > 0)
    : []
  const imageUrl = imageUrls[0]

  if (!imageUrl) {
    throw new Error('ARK_IMAGE_EMPTY_RESPONSE: no image url returned')
  }

  return {
    success: true as const,
    imageUrl,
    ...(imageUrls.length > 1 ? { imageUrls } : {}),
  }
}
