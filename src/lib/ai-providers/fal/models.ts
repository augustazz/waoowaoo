import type { MediaOptionSchemaConfig } from '@/lib/ai-providers/shared/media-option-schema-config'
import type { AiOptionSchema } from '@/lib/ai-registry/types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  buildMediaOptionSchema,
  buildVideoOptionSchema,
  enumValidator,
  integerRangeValidator,
  nonEmptyStringValidator,
  numberRangeValidator,
  stringArrayValidator,
  type MediaModality,
} from '@/lib/ai-providers/shared/option-schema'
import {
  buildGptImage2OptionSchema,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
} from '@/lib/ai-providers/shared/gpt-image-2'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'

export const FAL_GPT_IMAGE_2_MODEL_ID = 'gpt-image-2'
export const FAL_LYRIA_3_PRO_MODEL_ID = 'fal-ai/lyria3/pro'
export const FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID = 'fal-ai/qwen-3-tts/voice-design/1.7b'
export const FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY = `fal::${FAL_LYRIA_3_PRO_MODEL_ID}`
export const FAL_QWEN_VOICE_DESIGN_MODEL_KEY = `fal::${FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID}`
export const FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID = 'alibaba/happy-horse/image-to-video'
export const FAL_SEEDANCE_2_VIDEO_MODEL_ID = 'bytedance/seedance-2.0'
export const FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID = 'bytedance/seedance-2.0/fast'
export const FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/o3/standard/image-to-video'
export const FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/o3/pro/image-to-video'
export const FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/v3/standard/image-to-video'
export const FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID = 'fal-ai/kling-video/v3/pro/image-to-video'
export const FAL_IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const
export const FAL_GPT_IMAGE_2_QUALITY_OPTIONS = ['high', 'medium', 'low'] as const
export const FAL_QWEN_3_TTS_LANGUAGE_OPTIONS = [
  'Auto', 'English', 'Chinese', 'Spanish', 'French', 'German',
  'Italian', 'Japanese', 'Korean', 'Portuguese', 'Russian',
] as const

const FAL_QWEN_3_TTS_VOICE_DESIGN_MODEL = {
  provider: 'fal',
  modelId: FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
  name: 'Qwen 3 TTS Voice Design 1.7B',
  type: 'voice',
} as const satisfies PlatformModelPreset

export const FAL_PLATFORM_MODEL_PRESETS = [
  { provider: 'fal', modelId: 'banana-2', name: 'Banana 2', type: 'image' },
  { provider: 'fal', modelId: FAL_GPT_IMAGE_2_MODEL_ID, name: 'GPT Image 2', type: 'image' },
  { provider: 'fal', modelId: FAL_LYRIA_3_PRO_MODEL_ID, name: 'Lyria 3 Pro', type: 'music' },
  FAL_QWEN_3_TTS_VOICE_DESIGN_MODEL,
] as const satisfies ReadonlyArray<PlatformModelPreset>

export const FAL_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'video', provider: 'fal', modelId: 'fal-wan25',
    capabilities: { video: {
      supportedInputModes: ['first_frame'], firstFrameAspectRatio: 'adaptive',
      generationModeOptions: ['normal'], durationOptions: [5, 10, 15],
      resolutionOptions: ['720p', '1080p'], supportGenerateAudio: false,
    } },
  },
  {
    modelType: 'video', provider: 'fal', modelId: 'fal-veo31',
    capabilities: { video: {
      supportedInputModes: ['first_frame', 'reference'], firstFrameAspectRatio: 'selected',
      generationModeOptions: ['normal'], durationOptions: [4, 6, 8],
      resolutionOptions: ['720p', '1080p', '4k'], supportGenerateAudio: true, generateAudioOptions: [true, false],
      maxReferenceImages: 3, maxReferenceFiles: 3, assetReferenceMultiReference: true,
    } },
  },
  {
    modelType: 'image',
    provider: 'fal',
    modelId: 'banana-2',
    capabilities: { image: { maxReferenceImages: 14, resolutionOptions: ['1K', '2K', '4K'] } },
  },
  {
    modelType: 'image',
    provider: 'fal',
    modelId: FAL_GPT_IMAGE_2_MODEL_ID,
    capabilities: { image: { maxReferenceImages: 16, resolutionOptions: [...FAL_IMAGE_RESOLUTIONS], qualityOptions: [...FAL_GPT_IMAGE_2_QUALITY_OPTIONS] } },
  },
  {
    modelType: 'music',
    provider: 'fal',
    modelId: FAL_LYRIA_3_PRO_MODEL_ID,
    capabilities: {
      music: {
        generationModes: ['prompt'],
        durationSecondsRange: { min: 120, max: 180 },
        vocalModeOptions: ['instrumental', 'vocal'],
        outputFormatOptions: ['mp3'],
      },
    },
  },
  {
    modelType: 'voice',
    provider: 'fal',
    modelId: FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
    capabilities: {
      voice: {
        languageOptions: [...FAL_QWEN_3_TTS_LANGUAGE_OPTIONS],
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'reference'],
        firstFrameAspectRatio: 'adaptive',
        maxReferenceImages: 9,
        maxReferenceFiles: 9,
        generationModeOptions: ['normal'],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['720p', '1080p'],
        firstlastframe: false,
        supportGenerateAudio: false,
        assetReferenceMultiReference: true,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['480p', '720p', '1080p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        maxReferenceVideos: 3,
        maxReferenceFiles: 12,
        referenceAudioRequiresVisual: true,
        maxTotalReferenceAudioDurationMs: 15_000,
        maxTotalReferenceVideoDurationMs: 15_000,
        minTotalReferenceVideoDurationMs: 2_000,
        referenceVideoMimeTypes: ['video/mp4', 'video/quicktime'],
        maxTotalReferenceVideoBytes: 50_000_000,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'],
        supportsTextToVideo: true,
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutionOptions: ['480p', '720p'],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: true,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        maxReferenceVideos: 3,
        maxReferenceFiles: 12,
        referenceAudioRequiresVisual: true,
        maxTotalReferenceAudioDurationMs: 15_000,
        maxTotalReferenceVideoDurationMs: 15_000,
        minTotalReferenceVideoDurationMs: 2_000,
        referenceVideoMimeTypes: ['video/mp4', 'video/quicktime'],
        maxTotalReferenceVideoBytes: 50_000_000,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    capabilities: { video: { supportedInputModes: ['first_frame', 'first_last_frame'], firstFrameAspectRatio: 'adaptive', generationModeOptions: ['normal', 'firstlastframe'], durationOptions: [5, 10], firstlastframe: true, supportGenerateAudio: false } },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'first_last_frame'],
        firstFrameAspectRatio: 'adaptive',
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: false,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'first_last_frame'],
        firstFrameAspectRatio: 'adaptive',
        generationModeOptions: ['normal', 'firstlastframe'],
        generateAudioOptions: [true, false],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: true,
        supportGenerateAudio: true,
        assetReferenceMultiReference: false,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'first_last_frame'],
        firstFrameAspectRatio: 'adaptive',
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: true,
        supportGenerateAudio: false,
        assetReferenceMultiReference: false,
      },
    },
  },
  {
    modelType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    capabilities: {
      video: {
        supportedInputModes: ['first_frame', 'first_last_frame'],
        firstFrameAspectRatio: 'adaptive',
        generationModeOptions: ['normal', 'firstlastframe'],
        durationOptions: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        firstlastframe: true,
        supportGenerateAudio: false,
        assetReferenceMultiReference: false,
      },
    },
  },
] as const

export const FAL_API_CONFIG_CATALOG_MODELS = [
  { modelId: 'banana', name: 'Banana Pro', type: 'image', provider: 'fal' },
  { modelId: 'banana-2', name: 'Banana 2', type: 'image', provider: 'fal' },
  { modelId: FAL_GPT_IMAGE_2_MODEL_ID, name: 'GPT Image 2', type: 'image', provider: 'fal' },
  { modelId: FAL_LYRIA_3_PRO_MODEL_ID, name: 'Lyria 3 Pro', type: 'music', provider: 'fal' },
  FAL_QWEN_3_TTS_VOICE_DESIGN_MODEL,
  { modelId: 'fal-wan25', name: 'Wan 2.6', type: 'video', provider: 'fal' },
  { modelId: 'fal-veo31', name: 'Veo 3.1', type: 'video', provider: 'fal' },
  { modelId: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID, name: 'Happy Horse 1.0', type: 'video', provider: 'fal' },
  { modelId: FAL_SEEDANCE_2_VIDEO_MODEL_ID, name: 'Seedance 2.0', type: 'video', provider: 'fal' },
  { modelId: FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID, name: 'Seedance 2.0 Fast', type: 'video', provider: 'fal' },
  { modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', name: 'Kling 2.5 Turbo Pro', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling O3 Standard', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling O3 Pro', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling 3 Standard', type: 'video', provider: 'fal' },
  { modelId: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID, name: 'Kling 3 Pro', type: 'video', provider: 'fal' },
] as const

function falFlatPricing(flatAmount: number) {
  return { mode: 'flat' as const, flatAmount }
}

function falGptImage2Pricing() {
  const rows = [
    ['1024x768', { low: 0.005, medium: 0.037, high: 0.145 }],
    ['1024x1024', { low: 0.006, medium: 0.053, high: 0.211 }],
    ['1024x1536', { low: 0.005, medium: 0.042, high: 0.165 }],
    ['1920x1080', { low: 0.005, medium: 0.040, high: 0.158 }],
    ['2560x1440', { low: 0.007, medium: 0.056, high: 0.222 }],
    ['3840x2160', { low: 0.012, medium: 0.101, high: 0.401 }],
  ] as const
  return {
    mode: 'capability' as const,
    tiers: rows.flatMap(([imageSize, prices]) => [
      { when: { imageSize, quality: 'low' }, amount: usdToCredits(prices.low) },
      { when: { imageSize, quality: 'medium' }, amount: usdToCredits(prices.medium) },
      { when: { imageSize, quality: 'high' }, amount: usdToCredits(prices.high) },
    ]),
  }
}

/**
 * FAL publishes video pricing in USD. These helpers take the published USD
 * figure and convert it, so the unit is visible at the call site — a raw
 * literal here was previously read as CNY and understated FAL video cost by
 * the exchange rate.
 */
function falUsdDurationPricing(tiers: ReadonlyArray<readonly [duration: number, amountUsd: number]>) {
  return falDurationPricing(tiers.map(([duration, amountUsd]) => [duration, usdToCredits(amountUsd)] as const))
}

function falUsdDurationRatePricing(input: { durations: readonly number[]; amountUsdPerSecond: number }) {
  return falDurationPricing(input.durations.map((duration) => [
    duration,
    usdToCredits(Number((duration * input.amountUsdPerSecond).toFixed(6))),
  ] as const))
}

function falDurationPricing(tiers: ReadonlyArray<readonly [duration: number, amount: number]>) {
  return {
    mode: 'capability' as const,
    unit: 'per_call' as const,
    tiers: tiers.map(([duration, amount]) => ({ when: { duration }, amount })),
  }
}

const FAL_KLING_EXTENDED_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export const FAL_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'image', provider: 'fal', modelId: 'banana', cost: falFlatPricing(0.9648) },
  {
    apiType: 'image',
    provider: 'fal',
    modelId: 'banana-2',
    cost: {
      mode: 'capability',
      tiers: [
        { when: { resolution: '1K' }, amount: 0.576 },
        { when: { resolution: '2K' }, amount: 0.864 },
        { when: { resolution: '4K' }, amount: 1.152 },
      ],
    },
  },
  { apiType: 'image', provider: 'fal', modelId: FAL_GPT_IMAGE_2_MODEL_ID, cost: falGptImage2Pricing() },
  { apiType: 'music', provider: 'fal', modelId: FAL_LYRIA_3_PRO_MODEL_ID, cost: falFlatPricing(usdToCredits(0.08)) },
  {
    apiType: 'voice',
    provider: 'fal',
    modelId: FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
    cost: falFlatPricing(usdToCredits(0.09 / 1_000)),
  },
  {
    apiType: 'video', provider: 'fal', modelId: 'fal-wan25',
    cost: { mode: 'capability', unit: 'per_second', tiers: [
      { when: { resolution: '720p' }, amount: usdToCredits(0.10) },
      { when: { resolution: '1080p' }, amount: usdToCredits(0.15) },
    ] },
  },
  {
    apiType: 'video', provider: 'fal', modelId: 'fal-veo31',
    cost: { mode: 'capability', unit: 'per_second', tiers: [
      { when: { resolution: '720p', generateAudio: false }, amount: usdToCredits(0.10) },
      { when: { resolution: '720p', generateAudio: true }, amount: usdToCredits(0.15) },
      { when: { resolution: '1080p', generateAudio: false }, amount: usdToCredits(0.10) },
      { when: { resolution: '1080p', generateAudio: true }, amount: usdToCredits(0.15) },
      { when: { resolution: '4k', generateAudio: false }, amount: usdToCredits(0.30) },
      { when: { resolution: '4k', generateAudio: true }, amount: usdToCredits(0.35) },
    ] },
  },
  { apiType: 'video', provider: 'fal', modelId: 'fal-kling25', cost: falFlatPricing(2.16) },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
    cost: {
      mode: 'capability',
      unit: 'per_second',
      tiers: [
        { when: { resolution: '720p' }, amount: 0.7 },
        { when: { resolution: '1080p' }, amount: 1.4 },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'fal',
    // FAL resells Seedance at roughly twice what OpenRouter charges, and
    // OpenRouter is the platform's production Seedance route. FAL therefore
    // derives its own retail from its own cost instead of sharing the product
    // rate — pricing it at the shared rate would sell it below cost.
    modelId: FAL_SEEDANCE_2_VIDEO_MODEL_ID,
    cost: {
      mode: 'capability',
      unit: 'per_second',
      tiers: [
        { when: { resolution: '480p' }, amount: usdToCredits(0.1346) },
        { when: { resolution: '720p' }, amount: usdToCredits(0.3024) },
        { when: { resolution: '1080p' }, amount: usdToCredits(0.6804) },
      ],
    },
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
    cost: {
      mode: 'capability',
      unit: 'per_second',
      tiers: [
        { when: { resolution: '480p' }, amount: usdToCredits(0.1077) },
        { when: { resolution: '720p' }, amount: usdToCredits(0.2419) },
      ],
    },
  },
  { apiType: 'video', provider: 'fal', modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', cost: falUsdDurationPricing([[5, 0.35], [10, 0.7]]) },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    cost: falUsdDurationRatePricing({ durations: FAL_KLING_EXTENDED_DURATIONS, amountUsdPerSecond: 0.224 }),
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    cost: falUsdDurationRatePricing({ durations: FAL_KLING_EXTENDED_DURATIONS, amountUsdPerSecond: 0.35 }),
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
    cost: falUsdDurationPricing([[3, 0.504], [4, 0.672], [5, 0.84], [6, 1.008], [7, 1.176], [8, 1.344], [9, 1.512], [10, 1.68], [11, 1.848], [12, 2.016], [13, 2.184], [14, 2.352], [15, 2.52]]),
  },
  {
    apiType: 'video',
    provider: 'fal',
    modelId: FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
    cost: falUsdDurationPricing([[3, 0.672], [4, 0.896], [5, 1.12], [6, 1.344], [7, 1.568], [8, 1.792], [9, 2.016], [10, 2.24], [11, 2.464], [12, 2.688], [13, 2.912], [14, 3.136], [15, 3.36]]),
  },
] as const

export const FAL_IMAGE_OPTION_SCHEMA_CONFIG = {
  validators: {
    resolution: { kind: 'enum', values: FAL_IMAGE_RESOLUTIONS },
  },
} satisfies MediaOptionSchemaConfig

export function falImageReferenceLimit(modelId: string): number | undefined {
  const entry = FAL_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelType === 'image' && entry.modelId === modelId)
  return entry && 'image' in entry.capabilities ? entry.capabilities.image.maxReferenceImages : undefined
}

export function resolveFalOptionSchema(modality: MediaModality, modelId: string): AiOptionSchema {
  if (modality === 'image') {
    if (modelId === FAL_GPT_IMAGE_2_MODEL_ID) {
      return buildGptImage2OptionSchema({
        resolutionOptions: FAL_IMAGE_RESOLUTIONS,
        qualityOptions: FAL_GPT_IMAGE_2_QUALITY_OPTIONS,
        defaultResolution: '1K',
        defaultOutputFormat: 'png',
        maxReferenceImages: falImageReferenceLimit(modelId),
        excludedKeys: ['keepOriginalAspectRatio', 'responseFormat'],
      })
    }
    return buildMediaOptionSchema('image', {
      ...FAL_IMAGE_OPTION_SCHEMA_CONFIG,
      excludedKeys: ['keepOriginalAspectRatio', 'responseFormat', 'size', 'quality'],
      validators: {
        resolution: enumValidator(FAL_IMAGE_RESOLUTIONS),
        aspectRatio: nonEmptyStringValidator(),
        outputFormat: enumValidator(IMAGE_OUTPUT_FORMAT_OPTIONS),
        referenceImages: stringArrayValidator({ maxLength: falImageReferenceLimit(modelId) ?? 0 }),
      },
      normalize: (options) => ({
        ...options,
        outputFormat: options.outputFormat ?? 'png',
        referenceImages: options.referenceImages ?? [],
      }),
    })
  }
  if (modality === 'music') {
    if (modelId === FAL_LYRIA_3_PRO_MODEL_ID) {
      return buildMediaOptionSchema('music', {
        validators: {
          negativePrompt: nonEmptyStringValidator(),
          durationSeconds: numberRangeValidator({ min: 120, max: 180 }),
          vocalMode: enumValidator(['instrumental', 'vocal']),
          genre: nonEmptyStringValidator(),
          mood: nonEmptyStringValidator(),
          bpm: integerRangeValidator({ min: 20, max: 300 }),
          outputFormat: enumValidator(['mp3']),
        },
      })
    }
    return buildMediaOptionSchema('music')
  }
  if (modality === 'voice') {
    if (modelId !== FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID) {
      throw new Error(`FAL_VOICE_MODEL_UNSUPPORTED:${modelId}`)
    }
    return buildMediaOptionSchema('voice', {
      validators: {
        language: enumValidator(FAL_QWEN_3_TTS_LANGUAGE_OPTIONS),
      },
      normalize: (options) => ({
        ...options,
        language: options.language ?? 'Auto',
      }),
    })
  }
  if (modality === 'video') {
    const entry = FAL_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelType === 'video' && entry.modelId === modelId)
    if (!entry || !('video' in entry.capabilities)) throw new Error(`FAL_VIDEO_MODEL_UNSUPPORTED:${modelId}`)
    const seedance = modelId === FAL_SEEDANCE_2_VIDEO_MODEL_ID || modelId === FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID
    return buildVideoOptionSchema({
      capabilities: entry.capabilities.video,
      aspectRatios: seedance ? ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
        : modelId === 'fal-veo31' ? ['16:9', '9:16']
        : modelId === FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID ? ['16:9', '9:16', '1:1', '4:3', '3:4']
        : ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'],
      objectValidators: modelId === 'fal-veo31' ? [(options) => {
        const usesReferences = Array.isArray(options.referenceImages) && options.referenceImages.length > 0
        return (usesReferences || options.resolution === '1080p' || options.resolution === '4k') && options.duration !== 8
          ? { ok: false, reason: 'duration=8_required_for_reference_or_high_resolution' }
          : { ok: true }
      }] : [],
    })
  }

  throw new Error(`FAL_MODALITY_UNSUPPORTED:${modality}`)
}
