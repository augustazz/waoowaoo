import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { listBuiltinCapabilityCatalog, resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { projectProductionCapabilities } from '@/lib/project-production-context'
import { imageReferenceCountIssue } from '@/lib/ai-registry/generation-reference-policy'

ensureAiCatalogsRegistered()

describe('image reference capability contract', () => {
  it('declares every image model limit explicitly and rejects unsupported or over-limit inputs', () => {
    for (const model of listBuiltinCapabilityCatalog().filter((model) => model.modelType === 'image')) {
      const maximum = model.capabilities?.image?.maxReferenceImages
      expect(maximum, `${model.provider}:${model.modelId}`).toBeTypeOf('number')
      const selection = { provider: model.provider, modelId: model.modelId, modelKey: `${model.provider}::${model.modelId}`, variantSubKind: 'official' as const }
      const normalize = (count: number) => normalizeMediaOptionsForSelection({ selection, modality: 'image', options: {
        aspectRatio: '16:9', referenceImages: Array.from({ length: count }, (_, index) => `https://media.test/${index}.png`),
        ...(model.capabilities?.image?.resolutionOptions?.length ? { resolution: model.capabilities.image.resolutionOptions[0] } : {}),
        ...(model.capabilities?.image?.qualityOptions?.length ? { quality: model.capabilities.image.qualityOptions[0] } : {}),
      } })
      expect(() => normalize(maximum!), selection.modelKey).not.toThrow()
      expect(() => normalize(maximum! + 1), selection.modelKey).toThrow()
    }
  })

  it.each(['gpt-image-2', 'openai/gpt-image-2', 'gpt-image-2-2026-04-21', 'flux-kontext', 'nano-banana', 'qwen-image-edit', 'seedream-edit'])('exposes the same reference capability for compatible %s in production and execution', (modelId) => {
    const modelKey = `openai-compatible:custom::${modelId}`
    expect(resolveBuiltinCapabilitiesByModelKey('image', modelKey)?.image?.maxReferenceImages).toBe(16)
    const context = projectProductionCapabilities({ videoRatio: '16:9', models: [{ type: 'image', provider: 'openai-compatible:custom', modelId, modelKey, name: modelId, price: 0 }] })
    expect(context.image[0].maxReferenceImages).toBe(16)
    expect(context.image[0].referenceCapabilityKnown).toBe(true)
  })

  it('distinguishes unknown support, unsupported references and exhausted budgets', () => {
    expect(imageReferenceCountIssue(undefined, 1)?.code).toBe('IMAGE_MODEL_REFERENCE_CAPABILITY_UNKNOWN')
    expect(imageReferenceCountIssue(0, 1)?.code).toBe('IMAGE_MODEL_REFERENCE_UNSUPPORTED')
    expect(imageReferenceCountIssue(3, 4)).toMatchObject({ code: 'IMAGE_MODEL_REFERENCE_LIMIT_EXCEEDED', limit: 3 })
    expect(imageReferenceCountIssue(undefined, 0)).toBeNull()
    expect(resolveBuiltinCapabilitiesByModelKey('image', 'google::unknown-model')).toBeUndefined()
    expect(() => normalizeMediaOptionsForSelection({
      selection: { provider: 'google', modelId: 'unknown-model', modelKey: 'google::unknown-model', variantSubKind: 'official' },
      modality: 'image', options: { referenceImages: ['https://media.test/identity.png'] },
    })).toThrow()
  })
})
