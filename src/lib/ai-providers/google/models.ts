import type { PlatformModelPreset } from '@/lib/platform-models/types'

export const GOOGLE_GEMINI_3_5_FLASH_MODEL_ID = 'gemini-3.5-flash'

export const GOOGLE_PLATFORM_MODEL_PRESETS = [
  { provider: 'google', modelId: GOOGLE_GEMINI_3_5_FLASH_MODEL_ID, name: 'Gemini 3.5 Flash', type: 'llm' },
  { provider: 'google', modelId: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', type: 'llm' },
  { provider: 'google', modelId: 'lyria-3-pro-preview', name: 'Lyria 3 Pro Preview', type: 'music' },
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const GOOGLE_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  { modelType: 'llm', provider: 'google', modelId: 'gemini-3.1-pro-preview', capabilities: { llm: { protocol: 'google-generative-ai', publicReasoningMode: 'native', reasoningEffortOptions: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' } } },
  { modelType: 'llm', provider: 'google', modelId: 'gemini-3-pro-preview', capabilities: { llm: { protocol: 'google-generative-ai', publicReasoningMode: 'native', reasoningEffortOptions: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' } } },
  { modelType: 'llm', provider: 'google', modelId: 'gemini-3.1-flash-lite-preview', capabilities: { llm: { protocol: 'google-generative-ai', publicReasoningMode: 'native', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'], defaultReasoningEffort: 'medium' } } },
  { modelType: 'llm', provider: 'google', modelId: GOOGLE_GEMINI_3_5_FLASH_MODEL_ID, capabilities: { llm: { protocol: 'google-generative-ai', publicReasoningMode: 'native', reasoningEffortOptions: ['minimal', 'low', 'medium', 'high'], defaultReasoningEffort: 'medium' } } },
  { modelType: 'image', provider: 'google', modelId: 'gemini-3-pro-image-preview', capabilities: { image: { maxReferenceImages: 14, resolutionOptions: ['1K', '2K', '4K'] } } },
  { modelType: 'image', provider: 'google', modelId: 'gemini-3-pro-image-preview-batch', capabilities: { image: { maxReferenceImages: 14, resolutionOptions: ['1K', '2K', '4K'] } } },
  { modelType: 'image', provider: 'google', modelId: 'gemini-3.1-flash-image-preview', capabilities: { image: { maxReferenceImages: 14, resolutionOptions: ['0.5K', '1K', '2K', '4K'] } } },
  { modelType: 'image', provider: 'google', modelId: 'gemini-2.5-flash-image', capabilities: { image: { maxReferenceImages: 3, resolutionOptions: ['1K'] } } },
  { modelType: 'image', provider: 'google', modelId: 'gemini-2.5-flash-image-preview', capabilities: { image: { maxReferenceImages: 3, resolutionOptions: ['1K'] } } },
  { modelType: 'image', provider: 'google', modelId: 'imagen-4.0-generate-001', capabilities: { image: { maxReferenceImages: 0 } } },
  { modelType: 'image', provider: 'google', modelId: 'imagen-4.0-fast-generate-001', capabilities: { image: { maxReferenceImages: 0 } } },
  { modelType: 'image', provider: 'google', modelId: 'imagen-4.0-ultra-generate-001', capabilities: { image: { maxReferenceImages: 0 } } },
  {
    modelType: 'music',
    provider: 'google',
    modelId: 'lyria-3-pro-preview',
    capabilities: {
      music: {
        generationModes: ['prompt'],
        durationSecondsOptions: [30, 60, 90, 120, 180],
        vocalModeOptions: ['instrumental', 'vocal'],
        outputFormatOptions: ['mp3', 'wav'],
      },
    },
  },
  {
    modelType: 'video',
    provider: 'google',
    modelId: 'veo-3.1-generate-preview',
    capabilities: {
      video: {
        supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        maxReferenceImages: 3, maxReferenceFiles: 3, assetReferenceMultiReference: true,
        firstFrameAspectRatio: 'selected',
        generateAudioOptions: [true],
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [4, 6, 8],
        resolutionOptions: ['720p', '1080p', '4k'],
        firstlastframe: true,
        supportGenerateAudio: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'google',
    modelId: 'veo-3.1-fast-generate-preview',
    capabilities: {
      video: {
        supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        maxReferenceImages: 3, maxReferenceFiles: 3, assetReferenceMultiReference: true,
        firstFrameAspectRatio: 'selected',
        generateAudioOptions: [true],
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [4, 6, 8],
        resolutionOptions: ['720p', '1080p', '4k'],
        firstlastframe: true,
        supportGenerateAudio: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'google',
    modelId: 'veo-3.0-generate-001',
    capabilities: { video: { supportedInputModes: ['text_to_video', 'first_frame'], supportsTextToVideo: true, durationOptions: [8], resolutionOptions: ['720p', '1080p'], supportGenerateAudio: true, generateAudioOptions: [true] } },
  },
  {
    modelType: 'video',
    provider: 'google',
    modelId: 'veo-3.0-fast-generate-001',
    capabilities: { video: { supportedInputModes: ['text_to_video', 'first_frame'], supportsTextToVideo: true, durationOptions: [8], resolutionOptions: ['720p', '1080p'], supportGenerateAudio: true, generateAudioOptions: [true] } },
  },
  { modelType: 'video', provider: 'google', modelId: 'veo-2.0-generate-001', capabilities: { video: { supportedInputModes: ['text_to_video', 'first_frame'], supportsTextToVideo: true, durationOptions: [5, 6, 8], supportGenerateAudio: false } } },
] as const

export const GOOGLE_API_CONFIG_CATALOG_MODELS = [
  { modelId: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'google' },
  { modelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'google' },
  { modelId: GOOGLE_GEMINI_3_5_FLASH_MODEL_ID, name: 'Gemini 3.5 Flash', type: 'llm', provider: 'google' },
  { modelId: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', type: 'llm', provider: 'google' },
  { modelId: 'gemini-3-pro-image-preview', name: 'Banana Pro', type: 'image', provider: 'google' },
  { modelId: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', type: 'image', provider: 'google' },
  { modelId: 'gemini-3-pro-image-preview-batch', name: 'Banana Pro (Batch)', type: 'image', provider: 'google' },
  { modelId: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', type: 'image', provider: 'google' },
  { modelId: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image Preview', type: 'image', provider: 'google' },
  { modelId: 'imagen-4.0-generate-001', name: 'Imagen 4', type: 'image', provider: 'google' },
  { modelId: 'imagen-4.0-ultra-generate-001', name: 'Imagen 4 Ultra', type: 'image', provider: 'google' },
  { modelId: 'imagen-4.0-fast-generate-001', name: 'Imagen 4 Fast', type: 'image', provider: 'google' },
  { modelId: 'lyria-3-pro-preview', name: 'Lyria 3 Pro Preview', type: 'music', provider: 'google' },
  { modelId: 'veo-3.1-generate-preview', name: 'Veo 3.1', type: 'video', provider: 'google' },
  { modelId: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', type: 'video', provider: 'google' },
  { modelId: 'veo-3.0-generate-001', name: 'Veo 3.0', type: 'video', provider: 'google' },
  { modelId: 'veo-3.0-fast-generate-001', name: 'Veo 3.0 Fast', type: 'video', provider: 'google' },
  { modelId: 'veo-2.0-generate-001', name: 'Veo 2.0', type: 'video', provider: 'google' },
] as const

export const GOOGLE_COMPATIBLE_API_CONFIG_CATALOG_MODELS = GOOGLE_API_CONFIG_CATALOG_MODELS
  .filter((model) => !model.modelId.endsWith('-batch') && model.type !== 'music')

export function googleImageReferenceLimit(modelId: string): number | undefined {
  const entry = GOOGLE_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelType === 'image' && entry.modelId === modelId)
  return entry && 'image' in entry.capabilities ? entry.capabilities.image.maxReferenceImages : undefined
}

function googleTokenPricing(input: number, output: number) {
  return {
    mode: 'capability' as const,
    tiers: [
      { when: { tokenType: 'input' }, amount: input },
      { when: { tokenType: 'output' }, amount: output },
    ],
  }
}

function googleFlatPricing(flatAmount: number) {
  return { mode: 'flat' as const, flatAmount }
}

export const GOOGLE_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'text', provider: 'google', modelId: 'gemini-3.1-pro-preview', cost: googleTokenPricing(14.4, 86.4) },
  { apiType: 'text', provider: 'google', modelId: 'gemini-3.1-flash-lite-preview', cost: googleTokenPricing(1.8, 10.8) },
  { apiType: 'text', provider: 'google', modelId: 'gemini-3-pro-preview', cost: googleTokenPricing(14.4, 86.4) },
  { apiType: 'text', provider: 'google', modelId: GOOGLE_GEMINI_3_5_FLASH_MODEL_ID, cost: googleTokenPricing(19.44, 116.64) },
  {
    apiType: 'image',
    provider: 'google',
    modelId: 'gemini-3-pro-image-preview',
    cost: { mode: 'capability', tiers: [{ when: { resolution: '1K' }, amount: 0.9648 }, { when: { resolution: '2K' }, amount: 0.9648 }, { when: { resolution: '4K' }, amount: 1.728 }] },
  },
  {
    apiType: 'image',
    provider: 'google',
    modelId: 'gemini-3-pro-image-preview-batch',
    cost: { mode: 'capability', tiers: [{ when: { resolution: '1K' }, amount: 0.4824 }, { when: { resolution: '2K' }, amount: 0.4824 }, { when: { resolution: '4K' }, amount: 0.864 }] },
  },
  {
    apiType: 'image',
    provider: 'google',
    modelId: 'gemini-3.1-flash-image-preview',
    cost: {
      mode: 'capability',
      tiers: [
        { when: { resolution: '0.5K' }, amount: 0.324 },
        { when: { resolution: '1K' }, amount: 0.4824 },
        { when: { resolution: '2K' }, amount: 0.7272 },
        { when: { resolution: '4K' }, amount: 1.0872 },
      ],
    },
  },
  { apiType: 'image', provider: 'google', modelId: 'gemini-2.5-flash-image', cost: googleFlatPricing(0.2808) },
  { apiType: 'image', provider: 'google', modelId: 'gemini-2.5-flash-image-preview', cost: googleFlatPricing(0.2808) },
  { apiType: 'image', provider: 'google', modelId: 'imagen-4.0-generate-001', cost: googleFlatPricing(0.288) },
  { apiType: 'image', provider: 'google', modelId: 'imagen-4.0-ultra-generate-001', cost: googleFlatPricing(0.432) },
  { apiType: 'image', provider: 'google', modelId: 'imagen-4.0-fast-generate-001', cost: googleFlatPricing(0.144) },
  { apiType: 'music', provider: 'google', modelId: 'lyria-3-pro-preview', cost: googleFlatPricing(0.0192) },
  {
    apiType: 'video',
    provider: 'google',
    modelId: 'veo-3.1-generate-preview',
    cost: {
      mode: 'capability',
      unit: 'per_call',
      tiers: [
        { when: { generationMode: 'normal', resolution: '720p', duration: 4 }, amount: 11.52 },
        { when: { generationMode: 'normal', resolution: '720p', duration: 6 }, amount: 17.28 },
        { when: { generationMode: 'normal', resolution: '720p', duration: 8 }, amount: 23.04 },
        { when: { generationMode: 'normal', resolution: '1080p', duration: 8 }, amount: 23.04 },
        { when: { generationMode: 'normal', resolution: '4k', duration: 8 }, amount: 34.56 },
        { when: { generationMode: 'firstlastframe', resolution: '720p', duration: 8 }, amount: 23.04 },
        { when: { generationMode: 'firstlastframe', resolution: '1080p', duration: 8 }, amount: 23.04 },
        { when: { generationMode: 'firstlastframe', resolution: '4k', duration: 8 }, amount: 34.56 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'google',
    modelId: 'veo-3.1-fast-generate-preview',
    cost: {
      mode: 'capability',
      unit: 'per_call',
      tiers: [
        { when: { generationMode: 'normal', resolution: '720p', duration: 4 }, amount: 4.32 },
        { when: { generationMode: 'normal', resolution: '720p', duration: 6 }, amount: 6.48 },
        { when: { generationMode: 'normal', resolution: '720p', duration: 8 }, amount: 8.64 },
        { when: { generationMode: 'normal', resolution: '1080p', duration: 8 }, amount: 8.64 },
        { when: { generationMode: 'normal', resolution: '4k', duration: 8 }, amount: 20.16 },
        { when: { generationMode: 'firstlastframe', resolution: '720p', duration: 8 }, amount: 8.64 },
        { when: { generationMode: 'firstlastframe', resolution: '1080p', duration: 8 }, amount: 8.64 },
        { when: { generationMode: 'firstlastframe', resolution: '4k', duration: 8 }, amount: 20.16 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'google',
    modelId: 'veo-3.0-generate-001',
    cost: {
      mode: 'capability',
      unit: 'per_call',
      tiers: [
        { when: { resolution: '720p', duration: 4 }, amount: 11.52 },
        { when: { resolution: '720p', duration: 6 }, amount: 17.28 },
        { when: { resolution: '720p', duration: 8 }, amount: 23.04 },
        { when: { resolution: '1080p', duration: 8 }, amount: 23.04 },
        { when: { resolution: '4k', duration: 8 }, amount: 23.04 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'google',
    modelId: 'veo-3.0-fast-generate-001',
    cost: {
      mode: 'capability',
      unit: 'per_call',
      tiers: [
        { when: { resolution: '720p', duration: 4 }, amount: 4.32 },
        { when: { resolution: '720p', duration: 6 }, amount: 6.48 },
        { when: { resolution: '720p', duration: 8 }, amount: 8.64 },
        { when: { resolution: '1080p', duration: 8 }, amount: 8.64 },
        { when: { resolution: '4k', duration: 8 }, amount: 8.64 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'google',
    modelId: 'veo-2.0-generate-001',
    cost: {
      mode: 'capability',
      unit: 'per_call',
      tiers: [
        { when: { duration: 5 }, amount: 12.6 },
        { when: { duration: 6 }, amount: 15.12 },
        { when: { duration: 8 }, amount: 20.16 },
      ],
    },
  },
] as const
