import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ content: vi.fn(), images: vi.fn(), batch: vi.fn(), normalize: vi.fn() }))
vi.mock('@google/genai', async (importOriginal) => ({
  ...await importOriginal<typeof import('@google/genai')>(),
  GoogleGenAI: class {
    models = { generateContent: sdk.content, generateImages: sdk.images }
    batches = { create: sdk.batch }
  },
}))
vi.mock('@/lib/media/outbound-image', () => ({ normalizeToBase64ForGeneration: sdk.normalize }))

import { executeGoogleImageGeneration } from '@/lib/ai-providers/google/image'
import { submitGeminiBatch } from '@/lib/ai-providers/google/batch'

const identity = 'data:image/png;base64,YQ=='
const scene = 'data:image/png;base64,Yg=='
const request = (modelId: string, referenceImages: string[]) => ({
  userId: 'user', providerConfig: { id: 'google', name: 'Google', apiKey: 'test' },
  selection: { provider: 'google', modelId, modelKey: `google::${modelId}`, variantSubKind: 'official' as const },
  prompt: '@图片1 identity; @图片2 scene', options: { referenceImages, aspectRatio: '16:9' },
})

describe('Google image references are all-or-fail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OUTBOUND_PROXY_URL', '')
    sdk.content.mockResolvedValue({ candidates: [{ content: { parts: [{ inlineData: { data: 'Yw==', mimeType: 'image/png' } }] } }] })
    sdk.batch.mockResolvedValue({ name: 'batches/test' })
    sdk.normalize.mockRejectedValue(new Error('reference download failed'))
  })
  afterEach(() => vi.unstubAllEnvs())

  it('preserves every reference and its order before the Prompt in ordinary and Batch requests', async () => {
    await executeGoogleImageGeneration(request('gemini-3-pro-image-preview', [identity, scene]))
    await submitGeminiBatch('test', 'final prompt', { referenceImages: [identity, scene] })
    const parts = [{ inlineData: { mimeType: 'image/png', data: 'YQ==' } }, { inlineData: { mimeType: 'image/png', data: 'Yg==' } }]
    expect(sdk.content.mock.calls[0][0].contents[0].parts).toEqual([...parts, { text: '@图片1 identity; @图片2 scene' }])
    expect(sdk.batch.mock.calls[0][0].src[0].contents[0].parts).toEqual([...parts, { text: 'final prompt' }])
  })

  it.each(['gemini-3-pro-image-preview', 'gemini-3-pro-image-preview-batch'])('does not submit %s if an ordered reference download fails', async (modelId) => {
    await expect(executeGoogleImageGeneration(request(modelId, [identity, 'https://media.test/scene.png'])))
      .rejects.toMatchObject({ code: 'INVALID_PARAMS', details: { reasonCode: 'IMAGE_REFERENCE_READ_FAILED', referenceIndex: 2 } })
    expect(sdk.content).not.toHaveBeenCalled()
    expect(sdk.batch).not.toHaveBeenCalled()
  })

  it.each(['data:image/png;base64,', 'data:image/png;base64,***', 'data:text/plain;base64,YQ=='])('rejects a malformed reference %s without shifting image numbers', async (badImage) => {
    await expect(executeGoogleImageGeneration(request('gemini-3-pro-image-preview', [badImage, scene]))).rejects.toThrow('IMAGE_REFERENCE_READ_FAILED:1')
    await expect(submitGeminiBatch('test', 'prompt', { referenceImages: [badImage, scene] })).rejects.toThrow('IMAGE_REFERENCE_READ_FAILED:1')
    expect(sdk.content).not.toHaveBeenCalled()
    expect(sdk.batch).not.toHaveBeenCalled()
  })

  it('rejects Imagen references, unsupported models and excess images before submission', async () => {
    await expect(executeGoogleImageGeneration(request('imagen-4.0-generate-001', [identity]))).rejects.toThrow('IMAGE_MODEL_REFERENCE_UNSUPPORTED')
    await expect(executeGoogleImageGeneration(request('unknown-image-model', [identity]))).rejects.toThrow('IMAGE_MODEL_REFERENCE_CAPABILITY_UNKNOWN')
    await expect(executeGoogleImageGeneration(request('gemini-2.5-flash-image', Array(4).fill(identity)))).rejects.toThrow('IMAGE_MODEL_REFERENCE_LIMIT_EXCEEDED')
    await expect(submitGeminiBatch('test', 'prompt', { referenceImages: Array(15).fill(identity) })).rejects.toThrow('IMAGE_MODEL_REFERENCE_LIMIT_EXCEEDED')
    expect(sdk.images).not.toHaveBeenCalled()
    expect(sdk.content).not.toHaveBeenCalled()
    expect(sdk.batch).not.toHaveBeenCalled()
  })
})
