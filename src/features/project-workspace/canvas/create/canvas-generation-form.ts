import { validateGenerationReferenceDurations } from '@/lib/ai-registry/generation-reference-duration'
import { generationVideoInputMode, type GenerationReferenceRole } from '@/lib/ai-registry/generation-reference-policy'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import { canvasReferenceIssue, type CanvasGenerationCapability } from './canvas-draft'
import { videoConstraintIssue } from '@/lib/ai-registry/video-constraints'

export interface CanvasGenerationFormInput {
  readonly configurationVersion: string | null
  readonly aspectRatio: string | null
  readonly durationSeconds: number | null
  readonly parameters: Readonly<Record<string, CapabilityValue>>
  readonly references: readonly GenerationReferenceRole[]
}

export function canvasUsesAdaptiveFrame(capability: CanvasGenerationCapability | null, references: readonly GenerationReferenceRole[]): boolean {
  const mode = generationVideoInputMode(references)
  return capability?.mediaType === 'video' && capability.view.firstFrameAspectRatio === 'adaptive'
    && (mode === 'first_frame' || mode === 'first_last_frame')
}

/** Only fields currently owned by the manual editor enter a new request. */
export function canvasEditableParameters(capability: CanvasGenerationCapability | null, values: CanvasGenerationFormInput['parameters']) {
  return Object.fromEntries((capability?.view.parameters ?? []).flatMap(({ field }) => (
    values[field] === undefined ? [] : [[field, values[field]]]
  ))) as Record<string, CapabilityValue>
}

export function canvasGenerationFormIssues(capability: CanvasGenerationCapability | null, input: CanvasGenerationFormInput): readonly string[] {
  if (!capability) return ['MODEL_UNAVAILABLE']
  if (capability.view.unavailableReason) return ['MODEL_CONFIGURATION_UNAVAILABLE']
  const issues: string[] = []
  if (input.configurationVersion !== capability.view.configurationVersion) issues.push('CONFIGURATION_CHANGED')
  if (!canvasUsesAdaptiveFrame(capability, input.references)
    && capability.view.aspectRatios.length > 0
    && (!input.aspectRatio || !capability.view.aspectRatios.includes(input.aspectRatio))) {
    issues.push('ASPECT_RATIO_REQUIRED')
  }
  if (capability.mediaType === 'video' && (input.durationSeconds === null || !capability.view.durationsSeconds.includes(input.durationSeconds))) issues.push('DURATION_REQUIRED')
  if (capability.view.parameters.some((parameter) => {
    const value = input.parameters[parameter.field]
    return value === undefined ? parameter.required : !parameter.options.includes(value)
  })) issues.push('PARAMETERS_REQUIRED')
  const referenceIssue = canvasReferenceIssue(capability, input.references)
  if (referenceIssue) issues.push(referenceIssue.code)
  if (capability.mediaType === 'video') {
    const conditional = videoConstraintIssue(capability.view.contractRules ?? [], {
      ...capability.view.fixedParameters, ...input.parameters, duration: input.durationSeconds,
      inputMode: generationVideoInputMode(input.references),
      referenceImages: input.references.filter((ref) => ref.role === 'reference_image').length,
      referenceAudios: input.references.filter((ref) => ref.channel === 'audio').length,
      referenceVideos: input.references.filter((ref) => ref.channel === 'video').length,
    })
    if (conditional) issues.push(conditional)
  }
  if (capability.mediaType === 'video') for (const channel of ['audio', 'video'] as const) {
    const durationIssue = validateGenerationReferenceDurations(channel, capability.view.referenceDurationLimits[channel], input.references.filter((reference) => reference.channel === channel),
      input.durationSeconds === null ? null : input.durationSeconds * 1_000)
    if (durationIssue) issues.push(durationIssue.code)
  }
  return issues
}
