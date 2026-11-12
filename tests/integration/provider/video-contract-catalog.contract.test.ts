import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A new, unrelated model arrives only as data. No production model table or
// adapter is patched by this test. Two channels deliberately reuse its ID.
vi.mock('../../../config/video-model-contracts.json', async (importOriginal) => {
  const original = await importOriginal<{ default: { schemaVersion: number; families: unknown[]; channels: unknown[] } }>()
  const family = { id: 'new-family', revision: 1, source: 'https://docs.test/video', aspectRatios: ['9:16'],
    capabilities: { supportedInputModes: ['text_to_video', 'reference'], supportsTextToVideo: true,
      durationOptions: [5, 6, 7, 8, 9, 10], generationModeOptions: ['normal'], maxReferenceImages: 2, maxReferenceFiles: 2 },
    audio: { output: 'unknown', control: 'unavailable', default: 'unknown' },
    rules: [{ when: { resolution: '720p', inputMode: 'reference' }, durationOptions: [5, 6], maxReferenceImages: 1 }] }
  return { default: { ...original.default, families: [...original.default.families, family],
    channels: [...original.default.channels, ...['a', 'b', 'unsupported'].map((id) => ({
      id, revision: 1, source: 'https://docs.test/video', protocol: id === 'unsupported' ? 'unimplemented-v1' : 'json-videos-v1',
      baseUrl: `https://${id}.test/v1`, provider: `openai-compatible:${id}`,
      models: [{ modelId: 'new-alias', family: 'new-family', resolutionOptions: [id === 'b' ? '1080p' : '720p'] }],
    }))] } }
})

const mocks = vi.hoisted(() => ({ config: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/user-api/runtime-config', async (importOriginal) => ({
  ...await importOriginal<object>(), getProviderConfig: mocks.config,
}))

import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { projectProductionCapabilities } from '@/lib/project-production-context'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { executeCompatibleVideo } from '@/lib/ai-providers/openai-compatible/video'
import { resolveVideoModelAvailability } from '@/lib/ai-registry/video-availability'
import { captureVideoExecutionContract, assertVideoExecutionContract } from '@/lib/ai-registry/video-execution-contract'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { createWaoMcpToolRegistry } from '@/lib/wao-mcp/tool-registry'
import { productionContextFixture } from '../../../scripts/lib/production-context-fixture'
import { projectWorkspaceCanvasGenerationCapabilities } from '@/lib/workspace-resource/canvas-generation-capabilities'
import { canvasGenerationFormIssues } from '@/features/project-workspace/canvas/create/canvas-generation-form'

describe('data-defined video contract throughout production', () => {
  const selection = { provider: 'openai-compatible:a', modelId: 'new-alias', modelKey: 'openai-compatible:a::new-alias', variantSubKind: 'official' as const }
  const config = { id: selection.provider, name: 'A', baseUrl: 'https://a.test/v1', apiKey: 'test-key' }
  beforeEach(() => {
    vi.stubEnv('BILLING_MODE', 'OFF')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'public-https')
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.config.mockResolvedValue(config)
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'new-task' }), { status: 202 }))
    ensureAiCatalogsRegistered()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.fetch.mockReset(); mocks.config.mockReset() })

  function context() {
    const video = projectProductionCapabilities({ models: [{ ...selection, name: 'New', type: 'video', price: 0 }],
      videoRatio: '9:16', videoChannels: { [selection.provider]: config } }).video
    const fixture = productionContextFixture()
    return { ...fixture, productionCapabilities: { ...fixture.productionCapabilities, video } }
  }

  it('exposes a new alias to the tool and canvas and serializes it through the existing protocol', async () => {
    const production = context()
    expect(production.productionCapabilities.video.models[0].model).toBe(selection.modelKey)
    expect(createWaoMcpToolRegistry(production).some((tool) => tool.name === 'create_video')).toBe(true)
    const view = projectWorkspaceCanvasGenerationCapabilities(production).video!
    const form = { configurationVersion: view.configurationVersion, aspectRatio: '9:16', durationSeconds: 5,
      parameters: { resolution: '720p' }, references: [{ channel: 'image' as const, role: 'reference_image' }] }
    expect(canvasGenerationFormIssues({ mediaType: 'video', view }, form)).toEqual([])
    expect(canvasGenerationFormIssues({ mediaType: 'video', view }, { ...form, durationSeconds: 8 })).toContain('VIDEO_MODEL_CONDITIONAL_DURATION_UNSUPPORTED')
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'video', options: {
      prompt: 'A scene', duration: 5, resolution: '720p', aspectRatio: '9:16', referenceImages: ['https://media.test/reference.png'],
    } })
    await executeCompatibleVideo({ userId: 'user', selection, providerConfig: config, imageUrl: '', options })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://a.test/v1/videos')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'new-alias', resolution: '720p', reference_images: [{ image_url: 'https://media.test/reference.png' }] })
    await expect(executeCompatibleVideo({ userId: 'user', selection, providerConfig: config, imageUrl: '', options: { ...options, prompt: 'A scene', duration: 8 } })).rejects.toThrow('VIDEO_MODEL_CONDITIONAL_DURATION_UNSUPPORTED')
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it('does not leak an instance-scoped contract or substitute an unfamiliar protocol', () => {
    expect(resolveBuiltinCapabilitiesByModelKey('video', 'openai-compatible:other::new-alias')).toBeUndefined()
    expect(resolveVideoModelAvailability('openai-compatible:b::new-alias', { baseUrl: 'https://b.test/v1' }).video?.resolutionOptions).toEqual(['1080p'])
    expect(resolveVideoModelAvailability(selection.modelKey, { baseUrl: 'https://b.test/v1' }).reason).toBe('channel_mismatch')
    expect(resolveVideoModelAvailability('openai-compatible:unsupported::new-alias', { baseUrl: 'https://unsupported.test/v1' }).reason).toBe('protocol_unsupported')
  })

  it('freezes the contract and channel, tolerates credential rotation and rejects transport drift', async () => {
    const frozen = await captureVideoExecutionContract('user', selection.modelKey)
    expect(JSON.stringify(frozen)).not.toContain('test-key')
    expect(JSON.stringify(frozen)).not.toContain('https://')
    mocks.config.mockResolvedValue({ ...config, apiKey: 'rotated' })
    await expect(assertVideoExecutionContract('user', selection.modelKey, frozen)).resolves.toBeUndefined()
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'inline-data-url')
    await expect(assertVideoExecutionContract('user', selection.modelKey, frozen)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
