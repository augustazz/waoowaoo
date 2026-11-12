import { DECLARED_VIDEO_CONTRACTS } from '@/lib/ai-registry/video-contracts'

// Both wire validation and the capability catalog consume the same data.
export const COMPATIBLE_VIDEO_MODELS = DECLARED_VIDEO_CONTRACTS

export const COMPATIBLE_VIDEO_CAPABILITY_ENTRIES = COMPATIBLE_VIDEO_MODELS.map((model) => ({
  modelType: 'video' as const,
  provider: model.provider,
  modelId: model.modelId,
  capabilities: { video: model.capabilities },
}))
