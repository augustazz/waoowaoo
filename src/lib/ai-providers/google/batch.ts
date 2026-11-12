import { GoogleGenAI } from '@google/genai'
import { loadGoogleImageReferences, normalizeGeminiImageSize } from '@/lib/ai-providers/shared/google-image-helpers'
import { asUnknownObject, getErrorMessage, type UnknownObject } from '@/lib/ai-providers/shared/helpers'
import { withProviderProxyDispatcher } from '@/lib/http/outbound-proxy'
import { GOOGLE_PROVIDER_PROXY_TARGET } from '@/lib/ai-providers/google/proxy-target'
import { logInternal } from '@/lib/logging/semantic'
import { AppError } from '@/lib/errors/app-error'
import { googleImageReferenceLimit } from './models'

type GeminiBatchClient = {
  batches: {
    create(args: { model: string; src: unknown[]; config: { displayName: string } }): Promise<unknown>
  }
}

type GeminiBatchContentPart = { inlineData: { mimeType: string; data: string } } | { text: string }

export async function submitGeminiBatch(
  apiKey: string,
  prompt: string,
  options?: { referenceImages?: string[]; aspectRatio?: string; resolution?: string },
): Promise<{ batchName: string }> {
  if (!apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'google' })

  try {
    const ai = new GoogleGenAI({ apiKey })
    const contentParts: GeminiBatchContentPart[] = await loadGoogleImageReferences(
      options?.referenceImages ?? [], googleImageReferenceLimit('gemini-3-pro-image-preview-batch'),
    )

    contentParts.push({ text: prompt })
    const imageConfig: UnknownObject = {}
    if (options?.aspectRatio) imageConfig.aspectRatio = options.aspectRatio
    const imageSize = normalizeGeminiImageSize(options?.resolution)
    if (imageSize) imageConfig.imageSize = imageSize
    const inlinedRequests = [{
      contents: [{ parts: contentParts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    }]

    const batchClient = ai as unknown as GeminiBatchClient
    const batchJob = await withProviderProxyDispatcher(
      GOOGLE_PROVIDER_PROXY_TARGET,
      async () => await batchClient.batches.create({
        model: 'gemini-3-pro-image-preview',
        src: inlinedRequests,
        config: { displayName: `image-gen-${Date.now()}` },
      }),
    )
    const batchRecord = asUnknownObject(batchJob)
    const batchName = batchRecord && typeof batchRecord.name === 'string' ? batchRecord.name : ''
    if (!batchName) throw new Error('GEMINI_BATCH_NAME_MISSING')
    logInternal('GeminiBatch', 'INFO', `✅ 任务已提交: ${batchName}`)
    return { batchName }
  } catch (error: unknown) {
    logInternal('GeminiBatch', 'ERROR', '提交异常', { error: getErrorMessage(error) })
    throw error
  }
}
