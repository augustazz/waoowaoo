import type { VideoInputMode } from './types'

export interface GenerationReferenceRole {
  readonly durationMs?: number | null
  readonly role: string
  readonly channel: 'context' | 'image' | 'audio' | 'video'
}

export interface GenerationReferenceLimits {
  readonly maxReferenceImages: number
  readonly maxReferenceAudios: number
  readonly maxReferenceVideos: number
  readonly maxReferenceFiles: number
  readonly referenceAudioRequiresVisual: boolean
  readonly supportedInputModes: readonly VideoInputMode[]
}

export interface GenerationReferenceIssue {
  readonly code: string
  readonly field: 'references'
  readonly limit?: number
  readonly inputMode?: VideoInputMode
}

export function imageReferenceCountIssue(maxImages: number | undefined, count: number): GenerationReferenceIssue | null {
  if (count === 0) return null
  const code = maxImages === undefined ? 'IMAGE_MODEL_REFERENCE_CAPABILITY_UNKNOWN'
    : maxImages === 0 ? 'IMAGE_MODEL_REFERENCE_UNSUPPORTED'
      : count > maxImages ? 'IMAGE_MODEL_REFERENCE_LIMIT_EXCEEDED' : null
  return code ? { code, field: 'references', ...(maxImages === undefined ? {} : { limit: maxImages }) } : null
}

export function generationVideoInputMode(references: readonly GenerationReferenceRole[]): VideoInputMode {
  if (references.some((ref) => ref.role === 'last_frame' && ref.channel === 'image')) return 'first_last_frame'
  if (references.some((ref) => ref.role === 'first_frame' && ref.channel === 'image')) return 'first_frame'
  return references.some((ref) => ref.channel !== 'context') ? 'reference' : 'text_to_video'
}

/** The planner and its editable View share one complete-reference-set judge. */
export function validateGenerationReferences(input: {
  readonly mediaType: 'image' | 'video'
  readonly limits: GenerationReferenceLimits
  readonly references: readonly GenerationReferenceRole[]
}): GenerationReferenceIssue | null {
  const { references, limits } = input
  const media = references.filter((ref) => ref.channel !== 'context')
  const count = (role: string) => media.filter((ref) => ref.role === role).length
  const issue = (code: string, limit?: number): GenerationReferenceIssue => ({
    code, field: 'references', ...(limit === undefined ? {} : { limit }),
  })
  if (input.mediaType === 'image') {
    if (media.some((ref) => ref.channel !== 'image')) return issue('IMAGE_REFERENCE_ROLE_INVALID')
    return imageReferenceCountIssue(limits.maxReferenceImages, media.length)
  }
  if (media.some((ref) => (
    ref.channel === 'image' ? !['first_frame', 'last_frame', 'reference_image'].includes(ref.role)
      : ref.channel === 'audio' ? ref.role !== 'reference_audio' : ref.role !== 'reference_video'
  ))) return issue('VIDEO_REFERENCE_ROLE_INVALID')
  const mode = generationVideoInputMode(references)
  if (!limits.supportedInputModes.includes(mode)) {
    return { ...issue('VIDEO_MODEL_INPUT_MODE_UNSUPPORTED'), inputMode: mode }
  }
  const images = count('reference_image')
  const audios = count('reference_audio')
  const videos = count('reference_video')
  if ((mode === 'first_frame' || mode === 'first_last_frame')
    && (count('first_frame') !== 1 || count('last_frame') > 1 || images + audios + videos > 0)) {
    return issue('VIDEO_MODEL_FRAME_INPUT_INVALID')
  }
  if (images > limits.maxReferenceImages) return issue('VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED', limits.maxReferenceImages)
  if (audios > limits.maxReferenceAudios) return issue('VIDEO_MODEL_AUDIO_REFERENCE_LIMIT_EXCEEDED', limits.maxReferenceAudios)
  if (videos > limits.maxReferenceVideos) return issue('VIDEO_MODEL_VIDEO_REFERENCE_LIMIT_EXCEEDED', limits.maxReferenceVideos)
  if (images + audios + videos > limits.maxReferenceFiles) return issue('VIDEO_MODEL_TOTAL_REFERENCE_LIMIT_EXCEEDED', limits.maxReferenceFiles)
  if (limits.referenceAudioRequiresVisual && audios > 0 && images + videos === 0) {
    return issue('VIDEO_MODEL_REFERENCE_AUDIO_REQUIRES_VISUAL')
  }
  return null
}
