import { describe, expect, it } from 'vitest'
import { normalizeDiscoveredProviderModels as normalize } from '@/lib/ai-providers/openai-compatible/model-discovery'

describe('provider model classification', () => {
  it('distinguishes vision inputs from image generation outputs', () => {
    const models = normalize({ data: [
      { id: 'vision', input_modalities: ['image', 'text'], output_modalities: ['text'] },
      { id: 'image-output', architecture: { output_modalities: ['image'] } },
      { id: 'vision-architecture', architecture: { modality: 'text+image->text' } },
    ] })
    expect(models.find(model => model.id === 'vision')?.types).toEqual(['llm'])
    expect(models.find(model => model.id === 'image-output')?.types).toEqual(['image'])
    expect(models.find(model => model.id === 'vision-architecture')?.types).toEqual(['llm'])
  })

  it.each(['gpt-image-1', 'dall-e-3', 'flux.1-dev', 'gemini-2.5-flash-image', 'vendor/qwen-image', 'seedream-4', 'grok-imagine-image', 'grok-imagine-image-quality', 'xai/grok-imagine-image'])('recognizes image model %s', id => {
    expect(normalize([id])[0]).toMatchObject({ types: ['image'], classification: 'name' })
  })

  it('prioritizes explicit metadata and keeps unsupported models out of text choices', () => {
    expect(normalize([{ id: 'gpt-image-special', output_modalities: ['text'] }])[0].types).toEqual(['llm'])
    expect(normalize([{ id: 'qwen-embedding', output_modalities: ['text'] }])[0]).toMatchObject({ types: [], classification: 'unsupported' })
    expect(normalize(['sora-2'])[0].types).toEqual(['video'])
  })

  it('separates Grok chat, image and video models while honoring explicit metadata', () => {
    expect(normalize(['grok-4.6'])[0]).toMatchObject({ types: ['llm'], classification: 'name' })
    expect(normalize(['grok-imagine-video'])[0].types).toEqual(['video'])
    expect(normalize([{ id: 'grok-4.6', output_modalities: ['image'] }])[0]).toMatchObject({ types: ['image'], classification: 'metadata' })
  })

  it('leaves unknown IDs available for manual classification', () => {
    expect(normalize(['my-private-model'])[0]).toMatchObject({ id: 'my-private-model', types: [], classification: 'unknown' })
    expect(normalize([{ id: 'input-only', input_modalities: ['image'] }])[0].types).toEqual([])
  })

  it('normalizes list envelopes, removes duplicates and skips malformed entries', () => {
    expect(normalize({ models: ['b', { id: 'a', name: 'Display A' }, { id: 'a' }, {}, null, 1, '', 'x'.repeat(161)] })).toHaveLength(2)
    expect(normalize({ data: [] })).toEqual([])
    expect(() => normalize({ data: {} })).toThrow('PROVIDER_MODEL_LIST_INVALID')
  })
})
