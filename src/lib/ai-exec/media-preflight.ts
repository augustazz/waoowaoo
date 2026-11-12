import { validateVoiceGenerationText, type VoiceGenerationTextInput } from './voice-input'
import { AiOptionValidationError, normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import type { MediaModality } from '@/lib/ai-providers/shared/option-schema'
import type {
  AiResolvedSelection,
  AiUnknownObject,
  MusicGenerationMode,
} from '@/lib/ai-registry/types'
import {
  getProviderConfig,
  resolveModelSelection,
  resolveFrozenModelSelection,
} from '@/lib/user-api/runtime-config'
import { resolveProviderRouteSet } from '@/lib/ai-registry/provider-route-set'
import {
  resolveCompatibleMediaProviderRoutes,
  type ProviderMediaInputKind,
} from '@/lib/ai-exec/media-input-transport'
import { imageReferenceCountIssue } from '@/lib/ai-registry/generation-reference-policy'
import { resolveVideoModelAvailability } from '@/lib/ai-registry/video-availability'

export function normalizeMediaOptionsForSelection(input: {
  readonly selection: AiResolvedSelection
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
  readonly musicGenerationMode?: MusicGenerationMode
  readonly voiceInput?: VoiceGenerationTextInput
}): AiUnknownObject | undefined {
  const adapter = resolveAiProviderAdapter(input.selection.provider)
  const modalityAdapter = adapter[input.modality]
  if (!modalityAdapter) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${input.selection.provider}:${input.modality}`)
  }
  const descriptor = modalityAdapter.describe(input.selection)
  if (input.modality === 'music') {
    if (!input.musicGenerationMode) {
      throw new AiOptionValidationError({
        failure: 'invalid_option',
        context: `${input.modality}:${input.selection.modelKey}`,
        field: 'generationMode',
        reason: 'required',
      })
    }
    if (!descriptor.capabilities.music?.generationModes?.includes(input.musicGenerationMode)) {
      throw new AiOptionValidationError({
        failure: 'invalid_option',
        context: `${input.modality}:${input.selection.modelKey}`,
        field: 'generationMode',
        reason: `unsupported_value=${input.musicGenerationMode}`,
      })
    }
  }
  if (input.modality === 'voice') validateVoiceGenerationText({
    modelKey: input.selection.modelKey, capabilities: descriptor.capabilities.voice, generation: input.voiceInput,
  })
  const options = normalizeAiOptions({
    schema: descriptor.optionSchema,
    options: input.options,
    context: `${input.modality}:${input.selection.modelKey}`,
  })
  if (input.modality === 'image' && Array.isArray(options?.referenceImages)) {
    const issue = imageReferenceCountIssue(descriptor.capabilities.image?.maxReferenceImages, options.referenceImages.length)
    if (issue) throw new AiOptionValidationError({
      failure: 'invalid_option', context: `image:${input.selection.modelKey}`,
      field: 'referenceImages', reason: issue.code,
    })
  }
  const promptMaxChars = input.modality === 'music'
    ? descriptor.capabilities.music?.promptMaxChars
    : undefined
  if (
    promptMaxChars !== undefined
    && typeof input.prompt === 'string'
    && input.prompt.length > promptMaxChars
  ) {
    throw new AiOptionValidationError({
      failure: 'invalid_option',
      context: `${input.modality}:${input.selection.modelKey}`,
      field: 'prompt',
      reason: `max_chars_${String(promptMaxChars)}`,
    })
  }
  return options
}

export async function preflightMediaGenerationOptions(input: {
  /** Only callers holding a persisted Task payload may request frozen selection. */
  readonly selectionSource?: 'frozen_task'
  readonly userId: string
  readonly modelKey: string
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
  readonly musicGenerationMode?: MusicGenerationMode
  readonly voiceInput?: VoiceGenerationTextInput
}): Promise<{
  readonly selection: AiResolvedSelection
  readonly options: AiUnknownObject | undefined
}> {
  const selection = input.selectionSource === 'frozen_task'
    ? resolveFrozenModelSelection(input.modelKey, input.modality)
    : await resolveModelSelection(input.userId, input.modelKey, input.modality)
  // Provider credential/config availability is local and deterministic. Do
  // not reserve credits or create a Task that can only fail before HTTP.
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  if (input.modality === 'video') {
    const availability = resolveVideoModelAvailability(selection.modelKey, providerConfig)
    if (availability.reason) throw new AiOptionValidationError({
      failure: 'invalid_option', context: `video:${selection.modelKey}`, field: 'configuration', reason: availability.reason,
    })
  }
  return {
    selection,
    options: normalizeMediaOptionsForSelection({
      selection,
      modality: input.modality,
      options: input.options,
      prompt: input.prompt,
      musicGenerationMode: input.musicGenerationMode,
      voiceInput: input.voiceInput,
    }),
  }
}

/**
 * Validate the exact options a Worker will receive against every declared
 * pre-accept route. A route is an execution possibility, so a deterministic
 * schema mismatch must fail before a billable Task is created rather than only
 * after the primary provider rejects and failover is attempted.
 */
export function preflightMediaProviderRoutes(input: {
  readonly selection: AiResolvedSelection
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
  readonly musicGenerationMode?: MusicGenerationMode
  readonly voiceInput?: VoiceGenerationTextInput
  readonly mediaInputKinds?: readonly ProviderMediaInputKind[]
}): void {
  const routeSet = resolveProviderRouteSet(input.modality, input.selection.modelKey)
  const routes = input.modality === 'image' || input.modality === 'video'
    ? resolveCompatibleMediaProviderRoutes({
        routeSet,
        selection: input.selection,
        modality: input.modality,
        mediaKinds: input.mediaInputKinds ?? [],
      })
    : routeSet.routes
  for (const route of routes) {
    normalizeMediaOptionsForSelection({
      selection: {
        provider: route.provider,
        modelId: route.modelId,
        modelKey: route.modelKey,
        variantSubKind: 'official',
      },
      modality: input.modality,
      options: input.options,
      prompt: input.prompt,
      musicGenerationMode: input.musicGenerationMode,
      voiceInput: input.voiceInput,
    })
  }
}
