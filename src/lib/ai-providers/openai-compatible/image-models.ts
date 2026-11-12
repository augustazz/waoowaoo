import { isGptImage2Model } from './image-options'

// Preserve the generic Images API editing contract for custom gateways.
// Model-specific entries can declare narrower limits when needed.
export const COMPATIBLE_IMAGE_CAPABILITIES = { image: { maxReferenceImages: 16 } }

export const COMPATIBLE_GPT_IMAGE_2_CAPABILITIES = {
  image: { resolutionOptions: ['1K', '2K', '4K'], qualityOptions: ['auto', 'low', 'medium', 'high'], maxReferenceImages: 16 },
}

export function compatibleImageCapabilityModelId(modelId: string): string {
  return isGptImage2Model(modelId) ? 'gpt-image-2' : modelId
}

export const COMPATIBLE_IMAGE_CAPABILITY_ENTRIES = [{
  modelType: 'image', provider: 'openai-compatible', modelId: 'gpt-image-2',
  capabilities: COMPATIBLE_GPT_IMAGE_2_CAPABILITIES,
}] as const
