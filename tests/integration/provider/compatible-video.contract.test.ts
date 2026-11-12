import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCompatibleVideo, queryCompatibleVideoStatus } from '@/lib/ai-providers/openai-compatible/video'
import { compatibleVideoAsyncTaskProvider } from '@/lib/ai-providers/openai-compatible/async-task'
import { resolveAsyncTaskProviderByExternalId } from '@/lib/ai-providers'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { projectProductionCapabilities } from '@/lib/project-production-context'
import { normalizeDiscoveredProviderModels } from '@/lib/ai-providers/openai-compatible/model-discovery'
import { resolveEffectiveCapabilitiesByModelKey } from '@/lib/ai-exec/media-input-transport'
import * as deployment from '@/lib/deployment/config'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { validateModelCapabilities } from '@/lib/ai-registry/types'
import { createWaoMcpToolRegistry } from '@/lib/wao-mcp/tool-registry'
import { productionContextFixture } from '../../../scripts/lib/production-context-fixture'
import { projectWorkspaceCanvasGenerationCapabilities } from '@/lib/workspace-resource/canvas-generation-capabilities'
import { canvasGenerationFormIssues } from '@/features/project-workspace/canvas/create/canvas-generation-form'

vi.mock('../../../config/video-model-contracts.json', async () => ({ default: (await import('../../fixtures/video-contract-catalog.json')).default }))

const fetchMock = vi.fn<typeof fetch>()
const providerId = 'openai-compatible:example-instance'
const modelId = 'seedance-example-v3-720p'
const providerConfig = { id: providerId, name: 'Example', apiKey: 'test-key', baseUrl: 'https://video.example.test/v1' }
const selection = { provider: providerId, modelId, modelKey: `${providerId}::${modelId}`, variantSubKind: 'official' as const }
const input = { userId: 'user', providerConfig, selection, imageUrl: '', options: { prompt: '男主走进电梯', duration: 5, resolution: '720p', aspectRatio: '9:16' } }
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

describe('compatible JSON video protocol', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('BILLING_MODE', 'OFF')
    vi.stubEnv('OUTBOUND_PROXY_URL', '')
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', 'authenticated-proxy')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'inline-data-url')
    ensureAiCatalogsRegistered()
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset() })

  it('submits the project frame and persists the exact provider instance', async () => {
    fetchMock.mockResolvedValue(json({ data: { task_id: 'vid:a/b', status: 'queued' } }, 202))
    const result = await executeCompatibleVideo(input)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://video.example.test/v1/videos')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' } })
    expect(JSON.parse(init!.body as string)).toEqual({ model: modelId, prompt: input.options.prompt, duration: 5, resolution: '720p', ratio: '9:16' })
    const registration = resolveAsyncTaskProviderByExternalId(result.externalId!)
    expect(registration.parseExternalId(result.externalId!)).toEqual({ provider: 'COMPATIBLE', type: 'VIDEO', providerToken: providerId, requestId: 'vid:a/b' })
  })

  it('sends first and last frame objects and separate multimodal reference arrays', async () => {
    fetchMock.mockImplementation(async () => json({ id: 'vid' }))
    await executeCompatibleVideo({ ...input, imageUrl: 'https://media.test/first.png', options: { ...input.options, lastFrameImageUrl: 'https://media.test/last.png' } })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ first_frame: { image_url: 'https://media.test/first.png' }, last_frame: { image_url: 'https://media.test/last.png' } })
    await executeCompatibleVideo({ ...input, selection: wanSelection, options: { ...wanOptions, referenceImages: ['https://media.test/ref.png'], referenceAudios: ['https://media.test/ref.mp3'], referenceVideos: ['https://media.test/ref.mp4'] } })
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({ reference_images: [{ image_url: 'https://media.test/ref.png' }], reference_audios: [{ audio_url: 'https://media.test/ref.mp3' }], reference_videos: [{ video_url: 'https://media.test/ref.mp4' }] })
  })

  it('rejects invalid reference combinations before submitting', async () => {
    await expect(executeCompatibleVideo({ ...input, options: { ...input.options, lastFrameImageUrl: 'https://media.test/last.png' } })).rejects.toThrow('FIRST_FRAME_REQUIRED')
    await expect(executeCompatibleVideo({ ...input, imageUrl: 'https://media.test/first.png', options: { ...input.options, referenceImages: ['https://media.test/ref.png'] } })).rejects.toThrow('FRAMES_WITH_REFERENCES')
    await expect(executeCompatibleVideo({ ...input, imageUrl: 'data:image/png;base64,aGVsbG8=' })).rejects.toThrow('PUBLIC_HTTPS_MEDIA_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([408, 500, 503])('does not retry uncertain HTTP %s submissions', async (status) => {
    fetchMock.mockImplementation(async () => json({ error: { message: 'Upstream unavailable' } }, status))
    await expect(executeCompatibleVideo(input)).rejects.toMatchObject({ statusCode: status })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not retry network failures or accepted responses missing a task ID', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connection lost'))
    await expect(executeCompatibleVideo(input)).rejects.toThrow('connection lost')
    fetchMock.mockResolvedValueOnce(json({ status: 'queued' }))
    await expect(executeCompatibleVideo(input)).rejects.toThrow('SUBMIT_ID_MISSING')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('distinguishes a proven pre-accept rejection', async () => {
    fetchMock.mockResolvedValue(json({ error: { message: 'Invalid key' } }, 401))
    await expect(executeCompatibleVideo(input)).rejects.toMatchObject({ code: 'PROVIDER_AUTH_INVALID', disposition: 'pre_accept_rejected' })
  })

  it.each(['queued', 'pending', 'processing', 'running', 'in_progress', 'submitted', 'created', 'generating', 'starting', 'waiting', 'mystery', ''])('keeps %s jobs pending', async (status) => {
    fetchMock.mockResolvedValue(json({ data: { state: status } }))
    await expect(queryCompatibleVideoStatus({ providerConfig, requestId: 'vid:a/b' })).resolves.toEqual({ status: 'pending' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://video.example.test/v1/videos/vid%3Aa%2Fb')
  })

  it.each(['completed', 'succeeded', 'success', 'done'])('downloads %s CDN results without gateway credentials', async (status) => {
    fetchMock.mockResolvedValue(json({ data: { state: status, output: { url: 'https://cdn.test/result.mp4?signature=keep' } } }))
    await expect(queryCompatibleVideoStatus({ providerConfig, requestId: 'vid' })).resolves.toEqual({ status: 'completed', videoUrl: 'https://cdn.test/result.mp4?signature=keep', resultUrl: 'https://cdn.test/result.mp4?signature=keep' })
  })

  it('uses authenticated content download when a completed job has no result URL', async () => {
    fetchMock.mockResolvedValue(json({ status: 'completed' }))
    await expect(queryCompatibleVideoStatus({ providerConfig, requestId: 'vid' })).resolves.toMatchObject({ status: 'completed', videoUrl: 'https://video.example.test/v1/videos/vid/content', downloadHeaders: { Authorization: 'Bearer test-key' } })
  })

  it('never attaches credentials to arbitrary same-origin result URLs', async () => {
    fetchMock.mockResolvedValue(json({ status: 'completed', url: '/files/video.mp4' }))
    expect(await queryCompatibleVideoStatus({ providerConfig, requestId: 'vid' })).not.toHaveProperty('downloadHeaders')
  })

  it.each(['failed', 'error', 'cancelled', 'canceled', 'expired'])('surfaces terminal %s and preserves its cause', async (status) => {
    fetchMock.mockResolvedValue(json({ status, error: { message: 'Upstream rejected the reference' } }))
    await expect(queryCompatibleVideoStatus({ providerConfig, requestId: 'vid' })).resolves.toMatchObject({ status: 'failed', failure: { native: { message: 'Upstream rejected the reference' } } })
  })

  it('does not mistake an unknown state or malformed response for completion', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 'mystery', url: 'https://cdn.test/video.mp4' }))
    await expect(queryCompatibleVideoStatus({ providerConfig, requestId: 'vid' })).resolves.toEqual({ status: 'pending' })
    fetchMock.mockResolvedValueOnce(new Response('<html>Error</html>'))
    await expect(queryCompatibleVideoStatus({ providerConfig, requestId: 'vid' })).rejects.toMatchObject({ name: 'ProviderHttpError' })
  })

  it('resumes polling with the original provider even after model choices change', async () => {
    fetchMock.mockResolvedValue(json({ status: 'pending' }))
    const externalId = compatibleVideoAsyncTaskProvider.formatExternalId({ type: 'VIDEO', providerToken: providerId, requestId: 'vid' })
    const getProviderConfig = vi.fn().mockResolvedValue(providerConfig)
    await compatibleVideoAsyncTaskProvider.poll({ parsed: compatibleVideoAsyncTaskProvider.parseExternalId(externalId), context: { userId: 'user', getProviderConfig, getUserModels: vi.fn().mockResolvedValue([]) } })
    expect(getProviderConfig).toHaveBeenCalledWith('user', providerId)
  })

  it('recognizes gateway aliases and exposes usable text video capabilities with billing off', () => {
    const aliases = ['seedance-example-480p', 'seedance-example-720p', 'seedance-example-v2-720p', modelId]
    expect(normalizeDiscoveredProviderModels(aliases).every((model) => model.types.includes('video'))).toBe(true)
    const capabilities = projectProductionCapabilities({ models: [{ ...selection, name: modelId, type: 'video', price: 0 }], videoRatio: '9:16' })
    expect(capabilities.video.models[0]).toMatchObject({ pricingLimited: false, supportedInputModes: ['text_to_video'], aspectRatios: expect.arrayContaining(['9:16']), allowedSegmentDurationsSeconds: expect.arrayContaining([5]) })
    // Public URL capabilities use the provider key even for custom instances;
    // local inline deployment filters them out instead of sending data URLs.
    expect(resolveEffectiveCapabilitiesByModelKey('video', selection.modelKey)?.video?.maxReferenceImages).toBe(0)
  })

  it('keeps the pricing guard when billing is enabled', () => {
    vi.stubEnv('BILLING_MODE', 'SHADOW')
    const capabilities = projectProductionCapabilities({ models: [{ ...selection, name: modelId, type: 'video', price: 0 }], videoRatio: '9:16' })
    expect(capabilities.video.models).toEqual([])
    expect(capabilities.video.unavailableModels).toEqual([expect.objectContaining({ reason: 'pricing' })])
  })

  it('enables documented image inputs for public HTTPS deployments and custom provider instances', () => {
    vi.spyOn(deployment, 'getDeploymentConfig').mockReturnValue({ ...deployment.getDeploymentConfig(), providerMediaInputTransport: 'public-https' })
    expect(resolveEffectiveCapabilitiesByModelKey('video', selection.modelKey)?.video).toMatchObject({
      supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
      firstlastframe: true, maxReferenceImages: 1,
    })
  })

  const wanId = 'wan3.0-video-480p'
  const wanSelection = { ...selection, modelId: wanId, modelKey: `${providerId}::${wanId}` }
  const wanOptions = { prompt: '男主走进电梯，轻声说：好久不见。只有对白与电梯环境声，无配乐。', duration: 9, resolution: '480p', aspectRatio: '9:16' }

  it.each(['720p', '1080p'])('restores the video tool after switching to the exact Wan Prime %s alias and preserves reference inputs', async (resolution) => {
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'public-https')
    const primeId = `wan3.0-prime-${resolution}`
    const primeSelection = { ...selection, modelId: primeId, modelKey: `${providerId}::${primeId}` }
    expect(normalizeDiscoveredProviderModels([primeId])[0].types).toEqual(['video'])
    expect(validateModelCapabilities('video', resolveBuiltinCapabilitiesByModelKey('video', primeSelection.modelKey))).toEqual([])
    const video = projectProductionCapabilities({ models: [{ ...primeSelection, name: primeId, type: 'video', price: 0 }], videoRatio: '9:16' }).video
    expect(video.unavailableModels).toBeUndefined()
    expect(video.models[0]).toMatchObject({
      model: primeSelection.modelKey, pricingLimited: false, supportGenerateAudio: true,
      supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
      minSegmentDurationSeconds: 2, maxSegmentDurationSeconds: 30,
      maxReferenceImages: 10, maxReferenceAudios: 5, maxReferenceVideos: 5,
      maxReferenceVideoAndOutputDurationMs: 30_000,
      parameters: [{ field: 'resolution', options: [resolution], allowUnset: true }],
    })
    const context = productionContextFixture()
    const tools = createWaoMcpToolRegistry({ ...context, productionCapabilities: { ...context.productionCapabilities, video } })
    const tool = tools.find((entry) => entry.name === 'create_video')
    expect(tool).toBeDefined()
    expect(JSON.stringify(tool!.tool.inputSchema)).toContain(primeSelection.modelKey)
    expect(JSON.stringify(tool!.tool.inputSchema)).toContain(resolution)
    const referenceImages = ['https://media.test/K02.png', 'https://media.test/character.png']
    const options = normalizeMediaOptionsForSelection({ selection: primeSelection, modality: 'video', options: { ...wanOptions, resolution, referenceImages } })
    fetchMock.mockResolvedValue(json({ task_id: 'wan-prime-task' }, 202))
    const result = await executeCompatibleVideo({ ...input, selection: primeSelection, options })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://video.example.test/v1/videos')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      model: primeId, prompt: wanOptions.prompt, duration: 9, resolution, ratio: '9:16',
      reference_images: referenceImages.map((image_url) => ({ image_url })),
    })
    expect(compatibleVideoAsyncTaskProvider.parseExternalId(result.externalId!)).toMatchObject({ providerToken: providerId, requestId: 'wan-prime-task' })
    for (const invalid of [{ resolution: '480p' }, { resolution: resolution === '720p' ? '1080p' : '720p' }, { duration: 31 }, { generateAudio: false }]) {
      expect(() => normalizeMediaOptionsForSelection({ selection: primeSelection, modality: 'video', options: { ...options, ...invalid } })).toThrow()
    }
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps unregistered Wan variants unavailable instead of inferring capabilities from their names', () => {
    const unknownId = 'wan3.0-prime-unverified-1080p'
    const modelKey = `${providerId}::${unknownId}`
    const video = projectProductionCapabilities({ models: [{ ...selection, modelId: unknownId, modelKey, name: unknownId, type: 'video', price: 0 }], videoRatio: '9:16' }).video
    expect(video.models).toEqual([])
    expect(video.unavailableModels).toEqual([expect.objectContaining({ model: modelKey, reason: 'capabilities_unknown' })])
    const context = productionContextFixture()
    const tools = createWaoMcpToolRegistry({ ...context, productionCapabilities: { ...context.productionCapabilities, video } })
    expect(tools.some((entry) => entry.name === 'create_video')).toBe(false)
  })

  it('makes the configured Wan alias executable without changing its provider, resolution or audio defaults', async () => {
    const video = projectProductionCapabilities({ models: [{ ...wanSelection, name: wanId, type: 'video', price: 0 }], videoRatio: '9:16' }).video
    expect(video.unavailableModels).toBeUndefined()
    expect(video.models[0]).toMatchObject({
      model: wanSelection.modelKey, pricingLimited: false, supportGenerateAudio: true,
      minSegmentDurationSeconds: 2, maxSegmentDurationSeconds: 30,
      supportedInputModes: ['text_to_video'], maxReferenceImages: 0, maxReferenceAudios: 0, maxReferenceVideos: 0,
      referenceInputUnavailableReason: 'deployment_media_transport',
      parameters: [{ field: 'resolution', options: ['480p'], allowUnset: true }],
    })
    const context = productionContextFixture()
    const tools = createWaoMcpToolRegistry({ ...context, productionCapabilities: { ...context.productionCapabilities, video } })
    expect(tools.some((tool) => tool.name === 'create_video')).toBe(true)
    expect(JSON.stringify(tools.find((tool) => tool.name === 'create_video')!.tool.inputSchema)).toContain('never silently remove required references')
    const options = normalizeMediaOptionsForSelection({ selection: wanSelection, modality: 'video', options: wanOptions })
    fetchMock.mockResolvedValue(json({ task_id: 'wan-task' }, 202))
    const result = await executeCompatibleVideo({ ...input, selection: wanSelection, options })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://video.example.test/v1/videos')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ model: wanId, prompt: wanOptions.prompt, duration: 9, resolution: '480p', ratio: '9:16' })
    expect(compatibleVideoAsyncTaskProvider.parseExternalId(result.externalId!)).toMatchObject({ providerToken: providerId, requestId: 'wan-task' })
  })

  it('uses Wan multimodal limits without inheriting Seedance limits or native inline transport', async () => {
    vi.spyOn(deployment, 'getDeploymentConfig').mockReturnValue({ ...deployment.getDeploymentConfig(), providerMediaInputTransport: 'public-https' })
    const builtin = resolveBuiltinCapabilitiesByModelKey('video', wanSelection.modelKey)
    expect(validateModelCapabilities('video', builtin)).toEqual([])
    expect(resolveEffectiveCapabilitiesByModelKey('video', wanSelection.modelKey)?.video).toMatchObject({
      supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
      firstlastframe: true, maxReferenceImages: 10, maxReferenceAudios: 5, maxReferenceVideos: 5,
      maxReferenceFiles: 20, referenceAudioRequiresVisual: false,
      maxTotalReferenceAudioDurationMs: 15_000, maxTotalReferenceVideoDurationMs: 15_000,
      maxReferenceVideoAndOutputDurationMs: 30_000,
    })
    const referenceImages = Array.from({ length: 10 }, (_, index) => `https://media.test/character-${index}.png`)
    const options = normalizeMediaOptionsForSelection({ selection: wanSelection, modality: 'video', options: { ...wanOptions, referenceImages } })
    fetchMock.mockResolvedValue(json({ id: 'wan-refs' }))
    await executeCompatibleVideo({ ...input, selection: wanSelection, options })
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).reference_images).toEqual(referenceImages.map((image_url) => ({ image_url })))
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'video', options: { ...input.options, referenceImages } })).toThrow()
  })

  it.each([
    { duration: 1 }, { duration: 31 }, { duration: -1 }, { duration: 2.5 },
    { resolution: '720p' }, { generateAudio: true }, { generateAudio: false },
    { referenceImages: Array(11).fill('https://media.test/ref.png') },
    { referenceAudios: Array(6).fill('https://media.test/ref.mp3') },
    { referenceVideos: Array(6).fill('https://media.test/ref.mp4') },
  ])('rejects unsupported Wan parameters before HTTP: %j', (invalid) => {
    expect(() => normalizeMediaOptionsForSelection({ selection: wanSelection, modality: 'video', options: { ...wanOptions, ...invalid } })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([2, 30])('accepts the documented Wan duration boundary %s', (duration) => {
    expect(normalizeMediaOptionsForSelection({ selection: wanSelection, modality: 'video', options: { ...wanOptions, duration } })).toMatchObject({ duration })
  })

  it('updates the Canvas reference duration budget when the selected Wan output duration changes', () => {
    vi.spyOn(deployment, 'getDeploymentConfig').mockReturnValue({ ...deployment.getDeploymentConfig(), providerMediaInputTransport: 'public-https' })
    const context = productionContextFixture()
    const video = projectProductionCapabilities({ models: [{ ...wanSelection, name: wanId, type: 'video', price: 0 }], videoRatio: '9:16' }).video
    expect(video.models[0].referenceInputUnavailableReason).toBeUndefined()
    const view = projectWorkspaceCanvasGenerationCapabilities({ ...context, productionCapabilities: { ...context.productionCapabilities, video } }).video!
    const form = { configurationVersion: view.configurationVersion, aspectRatio: '9:16', durationSeconds: 15, parameters: { resolution: '480p' }, references: [{ channel: 'video' as const, role: 'reference_video', durationMs: 15_000 }] }
    expect(canvasGenerationFormIssues({ mediaType: 'video', view }, form)).toEqual([])
    expect(canvasGenerationFormIssues({ mediaType: 'video', view }, { ...form, durationSeconds: 16 })).toEqual(['VIDEO_MODEL_REFERENCE_VIDEO_INPUT_AND_OUTPUT_DURATION_EXCEEDED'])
  })
})
