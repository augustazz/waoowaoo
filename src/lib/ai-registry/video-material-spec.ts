import type { DeclaredVideoContract } from './video-contracts'

export function videoMaterialIssue(spec: NonNullable<DeclaredVideoContract['mediaSpecs']>['image'], facts: {
  mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null
}): string | null {
  if (!spec) return null
  if (spec.mimeTypes && (!facts.mimeType || !spec.mimeTypes.includes(facts.mimeType))) return 'VIDEO_REFERENCE_FORMAT_UNSUPPORTED'
  if (spec.maxBytes !== undefined && (facts.sizeBytes === null || facts.sizeBytes > spec.maxBytes)) return 'VIDEO_REFERENCE_SIZE_UNSUPPORTED'
  for (const [axis, min, max] of [['width', spec.minWidth, spec.maxWidth], ['height', spec.minHeight, spec.maxHeight]] as const) {
    if (min === undefined && max === undefined) continue
    const actual = facts[axis]
    if (actual === null || (min !== undefined && actual < min) || (max !== undefined && actual > max)) return 'VIDEO_REFERENCE_DIMENSIONS_UNSUPPORTED'
  }
  return null
}
