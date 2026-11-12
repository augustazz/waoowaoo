/** Technical validation is separate from dialogue/style/content acceptance. */
export function verifyVideoOutput(input: {
  actual: { durationMs: number | null; width: number | null; height: number | null; hasAudio?: boolean }
  durationSeconds: number; aspectRatio?: unknown; generateAudio?: unknown
  resolution?: unknown
  outputSizes?: readonly { resolution: string; aspectRatio: string; width: number; height: number }[]
  audioDefault?: 'on' | 'off' | 'unknown'
}) {
  const issues: string[] = []
  const { actual } = input
  const outputSize = input.outputSizes?.find((size) => size.resolution === input.resolution && size.aspectRatio === input.aspectRatio)
  // A quality label alone does not declare exact dimensions. Report this check
  // as unavailable, rather than treating missing catalog evidence as bad media.
  if (outputSize && (actual.width !== outputSize.width || actual.height !== outputSize.height)) issues.push('resolution_mismatch')
  if (actual.durationMs === null || Math.abs(actual.durationMs - input.durationSeconds * 1000) > 1000) issues.push('duration_mismatch')
  if (typeof input.aspectRatio === 'string' && /^\d+:\d+$/.test(input.aspectRatio)) {
    const [w, h] = input.aspectRatio.split(':').map(Number)
    if (!actual.width || !actual.height || Math.abs(actual.width / actual.height - w / h) / (w / h) > 0.02) issues.push('aspect_ratio_mismatch')
  }
  const audioExpected = typeof input.generateAudio === 'boolean' ? input.generateAudio
    : input.audioDefault === 'on' ? true : input.audioDefault === 'off' ? false : null
  if (audioExpected !== null && actual.hasAudio !== audioExpected) issues.push('audio_track_mismatch')
  return {
    schemaVersion: 1, status: issues.length ? 'needs_review' : 'passed', issues,
    actual, resolutionCheck: outputSize ? 'checked' : 'not_declared', contentAcceptance: 'pending',
  }
}
