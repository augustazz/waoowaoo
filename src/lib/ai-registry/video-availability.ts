import { resolveEffectiveCapabilitiesByModelKey } from '@/lib/ai-exec/media-input-transport'
import { resolveDeclaredVideoContract, videoChannelUnavailableReason } from './video-contracts'
import { modelAspectRatios } from './model-aspect-ratios'
import { parseModelKeyStrict } from './selection'
import { projectVideoGenerationAvailability } from './video-generation-availability'
import { getBillingModeSync } from '@/lib/billing/mode'
import { isApiConfigProviderVisible } from './api-config-catalog'

export type VideoUnavailableReason = 'capabilities_unknown' | 'duration_options_missing' | 'protocol_unsupported' | 'channel_mismatch' | 'input_modes_unavailable' | 'pricing' | 'provider_configuration_invalid'
export type VideoChannelConfig = { baseUrl?: string; unavailableReason?: 'provider_configuration_invalid' }
export type VideoModelAvailability = { status: 'ready' | 'unavailable'; reason: VideoUnavailableReason | null }

/** One local executability resolver. Ready does not assert upstream account access. */
export function resolveVideoModelAvailability(modelKey: string, channel?: VideoChannelConfig) {
  const declaration = resolveDeclaredVideoContract(modelKey)
  const parsed = parseModelKeyStrict(modelKey)
  let video = resolveEffectiveCapabilitiesByModelKey('video', modelKey)?.video
  let reason: VideoUnavailableReason | null = channel?.unavailableReason ?? (!video ? 'capabilities_unknown'
    : !video.durationOptions?.length ? 'duration_options_missing'
      : !video.supportedInputModes?.length ? 'input_modes_unavailable' : null)
  if (!reason && parsed?.provider.split(':')[0] === 'openai-compatible') {
    reason = !declaration ? 'capabilities_unknown'
      : declaration.protocol !== 'json-videos-v1' ? 'protocol_unsupported'
        : channel ? videoChannelUnavailableReason(declaration, channel.baseUrl) : null
  }
  const aspectRatios = reason ? [] : modelAspectRatios(modelKey, 'video')
  let pricingLimited = false
  if (!reason && video && parsed && getBillingModeSync() !== 'OFF' && isApiConfigProviderVisible(parsed.provider)) {
    const priced = projectVideoGenerationAvailability({ modelKey, video, aspectRatios })
    video = priced.video
    pricingLimited = priced.pricingLimited
    if (!video.supportedInputModes?.length) reason = 'pricing'
  }
  const availability: VideoModelAvailability = { status: reason ? 'unavailable' : 'ready', reason }
  return { ...availability, video, declaration, aspectRatios, pricingLimited }
}
