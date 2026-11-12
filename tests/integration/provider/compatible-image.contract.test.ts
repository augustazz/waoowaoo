import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCompatibleImage } from '@/lib/ai-providers/openai-compatible/image'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection, preflightMediaProviderRoutes } from '@/lib/ai-exec/media-preflight'
import { modelAspectRatios } from '@/lib/ai-registry/model-aspect-ratios'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'
import { projectWorkspaceResourceRegenerationAction } from '@/lib/workspace-resource/regeneration-projection'
import { applyWorkspaceResourceRegenerationEdits, readWorkspaceResourceRegenerationTemplate } from '@/lib/workspace-resource/regeneration'
import { resolveGenerationAspectRatio } from '@/lib/workspace-resource/generation-aspect-ratio'

const fetchMock = vi.fn<typeof fetch>()
const provider = 'openai-compatible:custom-instance'
const select = (modelId: string) => ({ provider, modelId, modelKey: `${provider}::${modelId}`, variantSubKind: 'official' as const })
const providerConfig = { id: provider, name: 'custom', apiKey: 'test-key', baseUrl: 'https://gateway.test/v1' }

describe('compatible GPT Image 2 frame translation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('OUTBOUND_PROXY_URL', '')
    ensureAiCatalogsRegistered()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/result.png' }] }), { headers: { 'Content-Type': 'application/json' } }))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset() })

  it('reruns an old Grok keyframe with the selected GPT model and the current project frame', async () => {
    const action = projectWorkspaceResourceRegenerationAction({
      resourceId: 'old-keyframe', workspacePath: '分镜/关键帧/K01', mediaType: 'image',
      schemaId: 'generic.image', status: 'ready', prompt: '人物走进电梯',
      modelKey: `${provider}::grok-imagine-image-2.0`, generationOptions: { aspectRatio: '4:3' },
      inputs: [], taskPayload: null,
    })!
    const template = readWorkspaceResourceRegenerationTemplate(action.input)
    const request = applyWorkspaceResourceRegenerationEdits(action.input, { ...template, name: '新版', aspectRatio: '9:16' }, 'current')
    const item = (request.request as { items: Array<{mediaType: 'image'; options?: {aspectRatio?: string}}> }).items[0]
    const selection = select('gpt-image-2')
    const normalized = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { aspectRatio: resolveGenerationAspectRatio(item, '9:16') } })!
    expect(normalized).toMatchObject({ aspectRatio: '9:16', resolution: '1K', quality: 'auto', imageSize: { width: 1088, height: 1920 } })
    // Resource and Task storage retain scalar execution facts; derived objects
    // are recomputed at execution and cannot be required in the frozen payload.
    const frozen = Object.fromEntries(Object.entries(normalized).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)))
    preflightMediaProviderRoutes({ selection, modality: 'image', options: frozen })
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: frozen })!
    await executeCompatibleImage({ userId: 'user', providerConfig, selection, prompt: template.prompt, options })
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.test/v1/images/generations')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ model: 'gpt-image-2', prompt: template.prompt, size: '1088x1920', n: 1 })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).not.toHaveProperty('aspect_ratio')
    expect(template.aspectRatio).toBe('4:3')
  })

  it.each(['gpt-image-2', 'openai/gpt-image-2', 'gpt-image-2-2026-04-21'])('accepts all project frames for %s without altering the project frame', (modelId) => {
    expect(modelAspectRatios(select(modelId).modelKey, 'image')).toEqual(Object.keys(ASPECT_RATIO_CONFIGS))
    for (const aspectRatio of Object.keys(ASPECT_RATIO_CONFIGS)) {
      expect(normalizeMediaOptionsForSelection({ selection: select(modelId), modality: 'image', options: { aspectRatio } })).toMatchObject({ aspectRatio })
    }
  })

  it('translates an explicit resolution into a larger pixel size', async () => {
    const selection = select('gpt-image-2')
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { aspectRatio: '9:16', resolution: '2K', quality: 'high' } })!
    await executeCompatibleImage({ userId: 'user', providerConfig, selection, prompt: 'Portrait', options })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ size: '1440x2560', quality: 'high' })
  })

  it('preserves the Grok aspect_ratio wire field', async () => {
    const selection = select('grok-imagine-image-2.0')
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { aspectRatio: '9:16' } })!
    await executeCompatibleImage({ userId: 'user', providerConfig, selection, prompt: 'Portrait', options })
    const payload = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(payload.aspect_ratio).toBe('9:16')
    expect(payload).not.toHaveProperty('size')
  })

  it('submits ordered GPT references as multipart image edits rather than text-only generations', async () => {
    const selection = select('gpt-image-2')
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: {
      aspectRatio: '16:9', referenceImages: ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg=='],
    } })!
    await executeCompatibleImage({ userId: 'user', providerConfig, selection, prompt: '@图片1 identity; @图片2 scene', options })
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.test/v1/images/edits')
    const form = fetchMock.mock.calls[0][1]!.body as FormData
    expect(form.get('prompt')).toBe('@图片1 identity; @图片2 scene')
    const images = form.getAll('image[]') as File[]
    expect(images).toHaveLength(2)
    expect(await Promise.all(images.map(async (image) => Buffer.from(await image.arrayBuffer()).toString()))).toEqual(['a', 'b'])
    expect(images.map((image) => image.type)).toEqual(['image/png', 'image/png'])
  })

  it('does not invent ratio support for other compatible models', () => {
    expect(() => normalizeMediaOptionsForSelection({ selection: select('unknown-model'), modality: 'image', options: { aspectRatio: '9:16' } })).toThrow('unsupported_option')
    expect(() => normalizeMediaOptionsForSelection({ selection: select('gpt-image-2'), modality: 'image', options: { aspectRatio: '9:16', resolution: '8K' } })).toThrow('invalid_option')
  })

  it.each(['flux-kontext', 'nano-banana', 'qwen-image-edit', 'seedream-edit', 'custom-image-model'])('preserves the generic editing contract for %s', async (modelId) => {
    const selection = select(modelId)
    const references = Array.from({ length: 16 }, () => 'data:image/png;base64,YQ==')
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { referenceImages: references } })!
    await executeCompatibleImage({ userId: 'user', providerConfig, selection, prompt: 'Edit references', options })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.test/v1/images/edits')
    const form = fetchMock.mock.calls[0][1]!.body as FormData
    expect(form.get('model')).toBe(modelId)
    expect(form.getAll('image[]')).toHaveLength(16)
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { referenceImages: [...references, references[0]] } })).toThrow()
    await expect(executeCompatibleImage({ userId: 'user', providerConfig, selection, prompt: 'Edit references', options: { referenceImages: [...references, references[0]] } })).rejects.toThrow('IMAGE_MODEL_REFERENCE_LIMIT_EXCEEDED')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
