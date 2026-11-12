import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import {
  buildMediaOptionSchema,
  buildVideoOptionSchema,
  enumValidator,
  integerRangeValidator,
  nonEmptyStringValidator,
  stringArrayValidator,
} from '@/lib/ai-providers/shared/option-schema'
import { googleConnectionTester, googleFailureAdapter } from './connection-test'
import { executeGoogleImageGeneration } from './image'
import {
  createGoogleSdkLanguageModel,
  validateGoogleLanguageModelResult,
} from './language-model'
import { executeGoogleMusicGeneration } from './music'
import { executeGoogleVideoGeneration } from './video'
import { GOOGLE_BUILTIN_CAPABILITY_CATALOG_ENTRIES, googleImageReferenceLimit } from './models'

function describeGoogleMediaVariant(
  modality: 'image' | 'video' | 'music',
  selection: Parameters<NonNullable<AiProviderAdapter['image']>['describe']>[0],
) {
  const executionMode = modality === 'image' && selection.modelId === 'gemini-3-pro-image-preview-batch'
    ? 'batch'
    : modality === 'video'
      ? 'async'
      : 'sync'
  return describeMediaVariantBase({
    modality,
    selection,
    executionMode,
    optionSchema: modality === 'music'
      ? buildMediaOptionSchema('music', {
        validators: {
          durationSeconds: integerRangeValidator({ min: 1, max: 600 }),
          vocalMode: enumValidator(['instrumental', 'vocal']),
          genre: nonEmptyStringValidator(),
          mood: nonEmptyStringValidator(),
          bpm: integerRangeValidator({ min: 20, max: 300 }),
          outputFormat: enumValidator(['mp3', 'wav']),
        },
      })
      : modality === 'video' ? googleVideoOptions(selection.modelId) : buildMediaOptionSchema(modality, {
        validators: { referenceImages: stringArrayValidator({ maxLength: googleImageReferenceLimit(selection.modelId) ?? 0 }) },
      }),
  })
}

function googleVideoOptions(modelId: string) {
  const entry = GOOGLE_BUILTIN_CAPABILITY_CATALOG_ENTRIES.find((entry) => entry.modelType === 'video' && entry.modelId === modelId)
  if (!entry || !('video' in entry.capabilities)) throw new Error(`GOOGLE_VIDEO_MODEL_UNSUPPORTED:${modelId}`)
  return buildVideoOptionSchema({
    capabilities: entry.capabilities.video,
    aspectRatios: ['16:9', '9:16'],
    objectValidators: [(options) => {
      const references = Array.isArray(options.referenceImages) && options.referenceImages.length > 0
      if ((references || options.lastFrameImageUrl || options.resolution === '1080p' || options.resolution === '4k') && options.duration !== 8) {
        return { ok: false, reason: 'duration=8_required_for_reference_interpolation_or_high_resolution' }
      }
      if (modelId.startsWith('veo-3.0-') && options.resolution === '1080p' && options.aspectRatio !== '16:9') {
        return { ok: false, reason: 'aspectRatio=16:9_required_for_1080p' }
      }
      return { ok: true }
    }],
  })
}

export const googleAdapter: AiProviderAdapter = {
  providerKey: 'google',
  failure: googleFailureAdapter,
  image: {
    describe: (selection) => describeGoogleMediaVariant('image', selection),
    execute: executeGoogleImageGeneration,
  },
  video: {
    describe: (selection) => describeGoogleMediaVariant('video', selection),
    execute: executeGoogleVideoGeneration,
  },
  music: {
    describe: (selection) => describeGoogleMediaVariant('music', selection),
    execute: executeGoogleMusicGeneration,
  },
  languageModel: {
    create: createGoogleSdkLanguageModel,
    validateResult: validateGoogleLanguageModelResult,
  },
  connectionTest: googleConnectionTester,
}
