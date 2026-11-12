import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withRetry } from '@/lib/retry'
import type { AiProviderImageExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import {
  assertAllowedGoogleImageOptions,
  normalizeGeminiImageSize,
  loadGoogleImageReferences,
  type GoogleContentPart,
} from '@/lib/ai-providers/shared/google-image-helpers'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { withProviderProxyDispatcher } from '@/lib/http/outbound-proxy'
import { GOOGLE_PROVIDER_PROXY_TARGET } from '@/lib/ai-providers/google/proxy-target'
import { AppError } from '@/lib/errors/app-error'
import { googleImageReferenceLimit } from './models'
import { imageReferenceCountIssue } from '@/lib/ai-registry/generation-reference-policy'
import {
  captureGoogleSdkSubmission,
  googleSafetyTerminalError,
} from './submission'

type GoogleImageOptions = NonNullable<AiProviderImageExecutionContext['options']>

type ImagenResponse = {
  generatedImages?: Array<{
    image?: {
      imageBytes?: string
    }
  }>
}

async function executeGoogleImageGenerationInternal(input: AiProviderImageExecutionContext): Promise<GenerateResult> {
  const options: GoogleImageOptions = input.options ?? {}
  assertAllowedGoogleImageOptions(options)

  const { apiKey } = input.providerConfig
  const ai = new GoogleGenAI({ apiKey })

  const modelId = requireSelectedModelId(input.selection, 'google:image')
  const referenceImages = options.referenceImages ?? []
  const referenceIssue = imageReferenceCountIssue(googleImageReferenceLimit(modelId), referenceImages.length)
  if (referenceIssue) throw new AppError('INVALID_PARAMS', referenceIssue.code, { provider: 'google', details: { ...referenceIssue } })

  if (modelId === 'gemini-3-pro-image-preview-batch') {
    const { submitGeminiBatch } = await import('@/lib/ai-providers/google/batch')
    const result = await captureGoogleSdkSubmission(async () => await withRetry({
      operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
      scope: `google:image:batch:${modelId}`,
      run: async () => await submitGeminiBatch(apiKey, input.prompt, {
        referenceImages,
        ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        ...(options.resolution ? { resolution: options.resolution } : {}),
      }),
    }))

    return {
      success: true,
      async: true,
      requestId: result.batchName,
      externalId: `GEMINI:BATCH:${result.batchName}`,
    }
  }

  if (modelId.startsWith('imagen-')) {
    const response = await captureGoogleSdkSubmission(async () => await withRetry({
      operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
      scope: `google:image:imagen:${modelId}`,
      run: async () => await withProviderProxyDispatcher(
        GOOGLE_PROVIDER_PROXY_TARGET,
        async () => await ai.models.generateImages({
          model: modelId,
          prompt: input.prompt,
          config: {
            numberOfImages: 1,
            ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
          },
        }),
      ),
    }))

    const generatedImages = (response as ImagenResponse).generatedImages
    const imageBytes = generatedImages?.[0]?.image?.imageBytes
    if (!imageBytes) {
      throw new AppError('EMPTY_RESPONSE', 'Imagen returned no image', {
        provider: 'google',
        cause: response,
      })
    }
    return {
      success: true,
      imageBase64: imageBytes,
      imageUrl: `data:image/png;base64,${imageBytes}`,
    }
  }

  const contentParts: GoogleContentPart[] = await loadGoogleImageReferences(referenceImages, googleImageReferenceLimit(modelId))
  const imageSize = normalizeGeminiImageSize(options.resolution)
  contentParts.push({ text: input.prompt })

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ]

  const response = await captureGoogleSdkSubmission(async () => await withRetry({
    operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
    scope: `google:image:gemini:${modelId}`,
    run: async () => await withProviderProxyDispatcher(
      GOOGLE_PROVIDER_PROXY_TARGET,
      async () => await ai.models.generateContent({
        model: modelId,
        contents: [{ parts: contentParts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          safetySettings,
          ...(options.aspectRatio || options.resolution
            ? {
              imageConfig: {
                ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
                ...(imageSize ? { imageSize } : {}),
              },
            }
            : {}),
        },
      }),
    ),
  }))

  const candidate = response.candidates?.[0]
  const parts = candidate?.content?.parts || []
  for (const part of parts) {
    if (part.inlineData?.data) {
      const imageBase64 = part.inlineData.data
      const mimeType = part.inlineData.mimeType || 'image/png'
      return {
        success: true,
        imageBase64,
        imageUrl: `data:${mimeType};base64,${imageBase64}`,
      }
    }
  }

  const finishReason = candidate?.finishReason
  if (finishReason === 'IMAGE_SAFETY' || finishReason === 'SAFETY') {
    throw googleSafetyTerminalError(finishReason, response)
  }

  throw new AppError('EMPTY_RESPONSE', 'Gemini returned no image', {
    provider: 'google',
    cause: response,
  })
}

export async function executeGoogleImageGeneration(input: AiProviderImageExecutionContext): Promise<GenerateResult> {
  return await executeGoogleImageGenerationInternal(input)
}
