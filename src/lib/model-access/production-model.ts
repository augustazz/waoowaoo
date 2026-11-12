import { ApiError } from '@/lib/api-errors'
import type { MediaModelType } from '@/lib/ai-registry/media-model-selection'
import type { ProductionImageModel, ProductionVideoModel, ProductionMusicModel, ProductionVoiceModel, ProjectProductionContext } from '@/lib/project-production-context'

/** The versioned configuration snapshot, never Agent input, owns model selection. */
export function requireProductionModel(context: ProjectProductionContext, modality: MediaModelType): string {
  const capabilities = context.productionCapabilities
  const models = modality === 'video' ? capabilities.video.models : capabilities[modality]
  const unavailableVideo = modality === 'video' ? capabilities.video.unavailableModels?.[0] : null
  if (models.length === 0 && unavailableVideo) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRODUCTION_MODEL_CAPABILITIES_UNAVAILABLE',
      field: 'configuration', modality, reason: unavailableVideo.reason,
      message: `The selected video model ${unavailableVideo.name} is unavailable (${unavailableVideo.reason}). Select a ready model or correct its verified capability/channel contract. Start a new turn after configuration changes.`,
      agentRetryableAfterCorrection: false,
    })
  }
  if (models.length !== 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: models.length === 0 ? 'DEFAULT_MEDIA_MODEL_NOT_CONFIGURED' : 'DEFAULT_MEDIA_MODEL_AMBIGUOUS',
      field: 'configuration',
      modality,
      message: 'Configure exactly one model for this category in settings before generating.',
      agentRetryableAfterCorrection: false,
    })
  }
  const unavailableReason = productionModelUnavailableReason(context, models[0])
  if (unavailableReason) throw new ApiError('INVALID_PARAMS', {
    code: 'PRODUCTION_MODEL_CONFIGURATION_UNAVAILABLE', field: 'configuration', modality,
    reason: unavailableReason, agentRetryableAfterCorrection: false,
  })
  return models[0].model
}

export function productionModelUnavailableReason(context: ProjectProductionContext, model: ProductionImageModel | ProductionVideoModel | ProductionMusicModel | ProductionVoiceModel): 'fixed_parameters' | 'pricing' | null {
  if ('parameters' in model && Object.entries(context.fixedParameters[model.model] ?? {}).some(([field, value]) => (
    !model.parameters.some((parameter) => parameter.field === field && parameter.options.includes(value))
  ))) return 'fixed_parameters'
  if ('supportedInputModes' in model && model.supportedInputModes.length === 0) return 'pricing'
  return null
}
