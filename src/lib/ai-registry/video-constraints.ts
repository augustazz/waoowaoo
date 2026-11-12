import type { VideoContractRule } from './video-contracts'
import type { VideoInputMode } from './types'

/** Browser and server share this pure judge; no provider or catalog imports. */
export function videoConstraintIssue(rules: readonly VideoContractRule[], input: {
  resolution?: unknown; duration?: unknown; generateAudio?: unknown; inputMode?: VideoInputMode
  referenceImages: number; referenceAudios: number; referenceVideos: number
}): string | null {
  for (const rule of rules) {
    if (Object.entries(rule.when).some(([key, value]) => input[key as keyof typeof input] !== value)) continue
    if (typeof input.duration === 'number' && rule.durationOptions && !rule.durationOptions.includes(input.duration)) return 'VIDEO_MODEL_CONDITIONAL_DURATION_UNSUPPORTED'
    for (const [key, limit] of [
      ['referenceImages', rule.maxReferenceImages], ['referenceAudios', rule.maxReferenceAudios],
      ['referenceVideos', rule.maxReferenceVideos],
    ] as const) if (limit !== undefined && input[key] > limit) return 'VIDEO_MODEL_CONDITIONAL_REFERENCE_LIMIT_EXCEEDED'
    if (rule.maxReferenceFiles !== undefined && input.referenceImages + input.referenceAudios + input.referenceVideos > rule.maxReferenceFiles) return 'VIDEO_MODEL_CONDITIONAL_REFERENCE_LIMIT_EXCEEDED'
  }
  return null
}
