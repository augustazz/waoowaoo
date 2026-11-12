import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { productionContextFixture } from '../../../scripts/lib/production-context-fixture'
import {
  formatProjectProductionContext,
  projectProductionCapabilities,
  type ProjectProductionContext,
} from '@/lib/project-production-context'
import * as transport from '@/lib/ai-exec/media-input-transport'
import { normalizeDiscoveredProviderModels } from '@/lib/ai-providers/openai-compatible/model-discovery'
import { requireProductionModel } from '@/lib/model-access/production-model'
import { createWaoMcpToolRegistry } from '@/lib/wao-mcp/tool-registry'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'

const modelId = 'wan-unregistered-contract-fixture'
const provider = 'openai-compatible:custom-instance'
const selected = { modelId, modelKey: `${provider}::${modelId}`, name: modelId, type: 'video' as const, provider, price: 0 }

function contextWithSelectedVideo(): ProjectProductionContext {
  const base = productionContextFixture()
  const projected = projectProductionCapabilities({ videoRatio: '9:16', models: [selected] })
  return {
    ...base,
    productionCapabilities: { ...base.productionCapabilities, video: projected.video },
  }
}

describe('selected video model availability', () => {
  beforeEach(() => ensureAiCatalogsRegistered())
  afterEach(() => vi.restoreAllMocks())

  it('keeps a discovered model visible as unavailable without inventing its capabilities', () => {
    expect(normalizeDiscoveredProviderModels([{ id: modelId, type: 'model' }])[0].types).toEqual(['video'])
    const context = contextWithSelectedVideo()
    expect(context.productionCapabilities.video.models).toEqual([])
    expect(context.productionCapabilities.video.unavailableModels).toEqual([
      expect.objectContaining({ model: selected.modelKey, reason: 'capabilities_unknown' }),
    ])
    const turnContext = JSON.parse(formatProjectProductionContext(context))
    expect(turnContext.unavailableProductionTools).toEqual([
      expect.objectContaining({
        tool: 'create_video', configuredModels: context.productionCapabilities.video.unavailableModels,
        explanation: expect.stringContaining('never substitute create_image'),
      }),
    ])
    const tools = createWaoMcpToolRegistry(context).map((entry) => entry.name)
    expect(tools).toContain('create_image')
    expect(tools).not.toContain('create_video')

    let error: unknown
    try { requireProductionModel(context, 'video') } catch (caught) { error = caught }
    expect(normalizeOperationExecutionToolError({ operationId: 'create_video', error }).details).toMatchObject({
      reasonCode: 'PRODUCTION_MODEL_CAPABILITIES_UNAVAILABLE', field: 'configuration',
    })
    expect((error as Error).message).toContain('capabilities_unknown')
    expect((error as Error).message).toContain('capabilities_unknown')
  })

  it('distinguishes a model lacking duration declarations from an unknown model', () => {
    vi.spyOn(transport, 'resolveEffectiveCapabilitiesByModelKey').mockReturnValue({
      video: { durationOptions: [], supportedInputModes: ['text_to_video'] },
    })
    const capability = projectProductionCapabilities({ videoRatio: '9:16', models: [selected] })
    expect(capability.video.models).toEqual([])
    expect(capability.video.unavailableModels?.[0].reason).toBe('duration_options_missing')
  })

  it('exposes the registered video tool after a supported model selection', () => {
    const context = productionContextFixture()
    expect(createWaoMcpToolRegistry(context).some((entry) => entry.name === 'create_video')).toBe(true)
    expect(context.productionCapabilities.video.unavailableModels).toBeUndefined()
    expect(JSON.parse(formatProjectProductionContext(context))).toEqual({ project: context.project })
    expect(requireProductionModel(context, 'video')).toBe(context.productionCapabilities.video.models[0].model)
  })
})
