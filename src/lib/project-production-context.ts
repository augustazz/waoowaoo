import { modelAspectRatios } from '@/lib/ai-registry/model-aspect-ratios'
import { createHash } from 'node:crypto'
import { resolveEffectiveCapabilitiesByModelKey } from '@/lib/ai-exec/media-input-transport'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import type { CapabilitySelections, VideoInputMode, VoiceCapabilities } from '@/lib/ai-registry/types'
import { getFixedParameterFields, type FixedParameterField } from '@/lib/ai-registry/fixed-parameters'
import { ApiError } from '@/lib/api-errors'
import type { StoredModel } from '@/lib/user-api/api-config-types'
import { buildPricingDisplayMap, withDisplayPricing } from '@/lib/user-api/api-config-pricing-display'
import { getUserModels } from '@/lib/user-api/runtime-config'
import { assertSingleMediaModelSelections } from '@/lib/user-api/effective-config'
import { resolveVideoModelAvailability, type VideoUnavailableReason, type VideoChannelConfig } from '@/lib/ai-registry/video-availability'
import type { VideoContractRule } from '@/lib/ai-registry/video-contracts'
import { getProviderConfig } from '@/lib/user-api/runtime-config'

/** Configured model facts; model identity is server-owned, never an Agent input. */
export type ProductionConfiguredModel = {
  readonly model: string
  readonly name: string
  readonly provider: string
  readonly retailCredits: { readonly min: number; readonly max: number } | null
}

export type ProductionImageModel = ProductionConfiguredModel & {
  readonly aspectRatios: readonly string[]
  readonly maxReferenceImages: number
  readonly referenceCapabilityKnown?: boolean
  readonly parameters: readonly FixedParameterField[]
}

export type ProductionVideoModel = ProductionConfiguredModel & {
  readonly contractRules?: readonly VideoContractRule[]
  readonly contractFingerprint?: string
  readonly audio?: { readonly output: 'native' | 'silent' | 'unknown'; readonly control: 'toggle' | 'unavailable'; readonly default: 'on' | 'off' | 'unknown' }
  readonly promptMaxChars?: number
  readonly referenceMediaSpecs?: import('@/lib/ai-registry/video-contracts').DeclaredVideoContract['mediaSpecs']
  readonly aspectRatios: readonly string[]
  readonly pricingLimited: boolean
  readonly firstFrameAspectRatio: 'selected' | 'adaptive' | null
  readonly parameters: readonly FixedParameterField[]
  readonly allowedSegmentDurationsSeconds: readonly number[]
  readonly minSegmentDurationSeconds: number
  readonly maxSegmentDurationSeconds: number
  readonly maxReferenceImages: number
  readonly maxReferenceAudios: number
  readonly maxReferenceVideos: number
  readonly maxReferenceFiles: number
  readonly referenceAudioRequiresVisual: boolean
  readonly minReferenceAudioDurationMs: number | null
  readonly maxReferenceAudioDurationMs: number | null
  readonly maxTotalReferenceAudioDurationMs: number | null
  readonly minReferenceVideoDurationMs: number | null
  readonly maxReferenceVideoDurationMs: number | null
  readonly minTotalReferenceVideoDurationMs: number | null
  readonly maxTotalReferenceVideoDurationMs: number | null
  readonly maxReferenceVideoAndOutputDurationMs?: number
  /** Native sound generation capability, independent of an exposed toggle. */
  readonly supportGenerateAudio?: boolean
  readonly referenceInputUnavailableReason?: 'deployment_media_transport'
  readonly referenceVideoMimeTypes: readonly string[] | null
  readonly maxTotalReferenceVideoBytes: number | null
  readonly supportedInputModes: readonly VideoInputMode[]
}

export type ProductionUnavailableVideoModel = ProductionConfiguredModel & {
  readonly reason: VideoUnavailableReason
}

export type ProductionMusicModel = ProductionConfiguredModel & {
  readonly generationMode: 'composition_plan'
  readonly maxChunks: number
  readonly minChunkDurationMs: number
  readonly maxChunkDurationMs: number
  readonly minPlanDurationMs: number
  readonly maxPlanDurationMs: number
  readonly maxPositiveStyles: number
  readonly maxNegativeStyles: number
  readonly contextAdherenceOptions: readonly ('low' | 'medium' | 'high')[]
}

export type ProductionVoiceModel = ProductionConfiguredModel & Omit<VoiceCapabilities, 'languageOptions' | 'fieldI18n'> & {
  readonly languageOptions: readonly string[]
}

export type ProjectProductionCapabilities = {
  readonly image: readonly ProductionImageModel[]
  readonly video: {
    readonly aspectRatio: string | null
    readonly models: readonly ProductionVideoModel[]
    readonly unavailableModels?: readonly ProductionUnavailableVideoModel[]
  }
  readonly music: readonly ProductionMusicModel[]
  readonly voice: readonly ProductionVoiceModel[]
}

export type ProjectProductionContext = {
  readonly schemaVersion: 8
  readonly version: string
  /** Server-owned selections; never part of the Agent's input fields. */
  readonly fixedParameters: CapabilitySelections
  readonly project: {
    readonly projectId: string
    readonly name: string
    readonly description: string | null
    readonly videoRatio: string | null
    readonly videoResolution: string
    readonly imageResolution: string
  }
  readonly productionCapabilities: ProjectProductionCapabilities
}

export class ProjectProductionContextError extends Error {
  constructor() {
    super('PROJECT_PRODUCTION_CONTEXT_NOT_OWNED')
    this.name = 'ProjectProductionContextError'
  }
}

function configuredModel(model: StoredModel): ProductionConfiguredModel {
  return {
    model: model.modelKey,
    name: model.name,
    provider: model.provider,
    retailCredits: typeof model.priceMin === 'number' && typeof model.priceMax === 'number'
      ? { min: model.priceMin, max: model.priceMax }
      : null,
  }
}

function imageModels(models: readonly StoredModel[]): ProductionImageModel[] {
  return models.filter((model) => model.type === 'image').map((model) => {
    const capabilities = resolveEffectiveCapabilitiesByModelKey('image', model.modelKey)
    return {
      ...configuredModel(model),
      aspectRatios: modelAspectRatios(model.modelKey, 'image'),
      parameters: getFixedParameterFields('image', capabilities),
      maxReferenceImages: capabilities?.image?.maxReferenceImages ?? 0,
      referenceCapabilityKnown: capabilities?.image?.maxReferenceImages !== undefined,
    }
  })
}

function videoModels(models: readonly StoredModel[], channels?: Readonly<Record<string, VideoChannelConfig>>): ProductionVideoModel[] {
  return models.filter((model) => model.type === 'video').flatMap((model) => {
    const resolved = resolveVideoModelAvailability(model.modelKey, channels?.[model.provider])
    if (resolved.status !== 'ready') return []
    const capabilities = resolveEffectiveCapabilitiesByModelKey('video', model.modelKey)
    if (!capabilities?.video) return []
    const aspectRatios = resolved.aspectRatios
    const declaredInputModes = resolveBuiltinCapabilitiesByModelKey('video', model.modelKey)?.video?.supportedInputModes ?? []
    const referenceTransportLimited = declaredInputModes.some((mode) => mode !== 'text_to_video' && !capabilities.video?.supportedInputModes?.includes(mode))
    // Self-hosted BYOK with billing disabled needs provider capabilities, not
    // a platform retail quote. Keep the pricing gate for billable deployments.
    const video = resolved.video!
    const pricingLimited = resolved.pricingLimited
    const allowedSegmentDurationsSeconds = Array.from(new Set(
      (video.durationOptions ?? []).filter((duration): duration is number => (
        Number.isInteger(duration)
        && duration > 0
      )),
    )).sort((left, right) => left - right)
    const minSegmentDurationSeconds = allowedSegmentDurationsSeconds[0]
    const maxSegmentDurationSeconds = allowedSegmentDurationsSeconds.at(-1)
    if (minSegmentDurationSeconds === undefined || maxSegmentDurationSeconds === undefined) return []
    return [{
      ...configuredModel(model),
      ...(resolved.declaration ? { contractRules: resolved.declaration.rules, contractFingerprint: resolved.declaration.fingerprint,
        audio: resolved.declaration.audio, ...(resolved.declaration.promptMaxChars ? { promptMaxChars: resolved.declaration.promptMaxChars } : {}),
        ...(resolved.declaration.mediaSpecs ? { referenceMediaSpecs: resolved.declaration.mediaSpecs } : {}) } : {}),
      aspectRatios,
      parameters: getFixedParameterFields('video', { ...capabilities, video }),
      pricingLimited,
      allowedSegmentDurationsSeconds,
      minSegmentDurationSeconds,
      maxSegmentDurationSeconds,
      maxReferenceImages: video.maxReferenceImages ?? 1,
      maxReferenceAudios: video.maxReferenceAudios ?? 0,
      maxReferenceVideos: video.maxReferenceVideos ?? 0,
      maxReferenceFiles: video.maxReferenceFiles ?? 0,
      referenceAudioRequiresVisual: video.referenceAudioRequiresVisual === true,
      minReferenceAudioDurationMs: video.minReferenceAudioDurationMs ?? null,
      maxReferenceAudioDurationMs: video.maxReferenceAudioDurationMs ?? null,
      maxTotalReferenceAudioDurationMs: video.maxTotalReferenceAudioDurationMs ?? null,
      minReferenceVideoDurationMs: video.minReferenceVideoDurationMs ?? null,
      maxReferenceVideoDurationMs: video.maxReferenceVideoDurationMs ?? null,
      minTotalReferenceVideoDurationMs: video.minTotalReferenceVideoDurationMs ?? null,
      maxTotalReferenceVideoDurationMs: video.maxTotalReferenceVideoDurationMs ?? null,
      ...(video.maxReferenceVideoAndOutputDurationMs !== undefined ? { maxReferenceVideoAndOutputDurationMs: video.maxReferenceVideoAndOutputDurationMs } : {}),
      ...(video.supportGenerateAudio !== undefined ? { supportGenerateAudio: video.supportGenerateAudio } : {}),
      ...(referenceTransportLimited ? { referenceInputUnavailableReason: 'deployment_media_transport' as const } : {}),
      referenceVideoMimeTypes: video.referenceVideoMimeTypes ?? null,
      maxTotalReferenceVideoBytes: video.maxTotalReferenceVideoBytes ?? null,
      supportedInputModes: video.supportedInputModes ?? [],
      firstFrameAspectRatio: video.firstFrameAspectRatio ?? null,
    }]
  })
}

function musicModels(models: readonly StoredModel[]): ProductionMusicModel[] {
  return models.filter((model) => model.type === 'music').flatMap((model) => {
    const music = resolveEffectiveCapabilitiesByModelKey('music', model.modelKey)?.music
    const compositionPlan = music?.compositionPlan
    if (!music?.generationModes?.includes('composition_plan') || !compositionPlan) return []
    return [{
      ...configuredModel(model),
      generationMode: 'composition_plan' as const,
      maxChunks: compositionPlan.maxChunks,
      minChunkDurationMs: compositionPlan.minChunkDurationMs,
      maxChunkDurationMs: compositionPlan.maxChunkDurationMs,
      minPlanDurationMs: compositionPlan.minPlanDurationMs,
      maxPlanDurationMs: compositionPlan.maxPlanDurationMs,
      maxPositiveStyles: compositionPlan.maxPositiveStyles,
      maxNegativeStyles: compositionPlan.maxNegativeStyles,
      contextAdherenceOptions: compositionPlan.contextAdherenceOptions,
    }]
  })
}

function voiceModels(models: readonly StoredModel[]): ProductionVoiceModel[] {
  return models.filter((model) => model.type === 'voice').map((model) => {
    const voice = resolveEffectiveCapabilitiesByModelKey('voice', model.modelKey)?.voice
    return {
      ...configuredModel(model),
      ...voice,
      languageOptions: voice?.languageOptions ?? [],
    }
  })
}

export function projectProductionCapabilities(input: {
  readonly models: readonly StoredModel[]
  readonly videoRatio: string | null
  readonly videoChannels?: Readonly<Record<string, VideoChannelConfig>>
}): ProjectProductionCapabilities {
  assertSingleMediaModelSelections([...input.models])
  const availableVideoModels = videoModels(input.models, input.videoChannels)
  const unavailableVideoModels = input.models
    .filter((model) => model.type === 'video' && !availableVideoModels.some((available) => available.model === model.modelKey))
    .map((model): ProductionUnavailableVideoModel => ({
      ...configuredModel(model),
      reason: resolveVideoModelAvailability(model.modelKey, input.videoChannels?.[model.provider]).reason ?? 'duration_options_missing',
    }))
  return {
    image: imageModels(input.models),
    video: {
      aspectRatio: input.videoRatio, models: availableVideoModels,
      ...(unavailableVideoModels.length ? { unavailableModels: unavailableVideoModels } : {}),
    },
    music: musicModels(input.models),
    voice: voiceModels(input.models),
  }
}

function contextVersion(value: Omit<ProjectProductionContext, 'version'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function readProjectProductionContext(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<ProjectProductionContext> {
  const [project, modelConfig, effectiveModels] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        name: true,
        description: true,
        videoResolution: true,
        imageResolution: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
    getUserModels(input.userId),
  ])
  if (!project) throw new ProjectProductionContextError()
  const pricing = buildPricingDisplayMap()
  const priced = effectiveModels.map((model) => withDisplayPricing(model, pricing))
  const videoProviders = [...new Set(effectiveModels.filter((model) => model.type === 'video').map((model) => model.provider))]
  const videoChannels = Object.fromEntries(await Promise.all(videoProviders.map(async (provider): Promise<[string, VideoChannelConfig]> => {
    try {
      const config = await getProviderConfig(input.userId, provider)
      return [provider, { baseUrl: config.baseUrl }]
    } catch {
      // Do not expose credential/decryption errors or break unrelated media tools.
      return [provider, { unavailableReason: 'provider_configuration_invalid' }]
    }
  })))
  const productionCapabilities = projectProductionCapabilities({
    models: priced,
    videoRatio: modelConfig.videoRatio,
    videoChannels,
  })
  const value: Omit<ProjectProductionContext, 'version'> = {
    schemaVersion: 8,
    fixedParameters: modelConfig.capabilityDefaults,
    project: {
      projectId: project.id,
      name: project.name,
      description: project.description,
      videoRatio: modelConfig.videoRatio,
      videoResolution: project.videoResolution,
      imageResolution: project.imageResolution,
    },
    productionCapabilities,
  }
  return { ...value, version: contextVersion(value) }
}

export function formatProjectProductionContext(context: ProjectProductionContext): string {
  const unavailable = context.productionCapabilities.video.unavailableModels ?? []
  return JSON.stringify({
    project: context.project,
    ...(unavailable.length ? {
      unavailableProductionTools: [{
        tool: 'create_video',
        configuredModels: unavailable,
        explanation: 'The selected video model is not locally executable; inspect each reason (provider configuration, missing capabilities, protocol, channel or duration). Fix the provider configuration, select a ready model or import a verified contract and channel binding. Start a new turn after configuration changes; never substitute create_image or submit a paid probe.',
      }],
    } : {}),
  }, null, 2)
}

/** Validate discovery identity once, then plan against this configuration snapshot. */
export async function readProductionPlanningContext(input: {
  readonly projectId: string
  readonly userId: string
  readonly productionConfigurationVersion?: string
}): Promise<ProjectProductionContext> {
  const context = await readProjectProductionContext(input)
  assertProductionConfigurationVersion(context, input.productionConfigurationVersion)
  return context
}

/** Optimistic input guard; this version grants no permission and selects no model. */
export function assertProductionConfigurationVersion(context: ProjectProductionContext, expectedVersion: string | null | undefined): void {
  if (expectedVersion && expectedVersion !== context.version) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRODUCTION_TOOL_CONFIGURATION_CHANGED',
      field: 'configuration',
      message: 'Model configuration changed. Start the next turn to load the current production tools.',
      agentRetryableAfterCorrection: false,
    })
  }
}
