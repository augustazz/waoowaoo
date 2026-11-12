import { describe, expect, it } from 'vitest'
import { projectReferenceDurationLimits, validateGenerationReferenceDurations } from '@/lib/ai-registry/generation-reference-duration'

const limits = projectReferenceDurationLimits({
  minReferenceVideoDurationMs: 1_000,
  maxReferenceVideoDurationMs: 15_000,
  maxTotalReferenceVideoDurationMs: 15_000,
  maxReferenceVideoAndOutputDurationMs: 30_000,
}).video

describe('reference video and output duration budget', () => {
  it('accepts the combined boundary and rejects a longer output with the same valid references', () => {
    const references = [{ durationMs: 8_000 }, { durationMs: 7_000 }]
    expect(validateGenerationReferenceDurations('video', limits, references, 15_000)).toBeNull()
    expect(validateGenerationReferenceDurations('video', limits, references, 16_000)?.code).toBe('VIDEO_MODEL_REFERENCE_VIDEO_INPUT_AND_OUTPUT_DURATION_EXCEEDED')
  })

  it('requires known media and output durations instead of assuming a budget', () => {
    expect(validateGenerationReferenceDurations('video', limits, [{ durationMs: null }], 9_000)?.code).toBe('VIDEO_MODEL_REFERENCE_VIDEO_DURATION_UNKNOWN')
    expect(validateGenerationReferenceDurations('video', limits, [{ durationMs: 5_000 }])?.code).toBe('VIDEO_MODEL_REFERENCE_VIDEO_OUTPUT_DURATION_UNKNOWN')
  })

  it('preserves per-file and total input limits and does not constrain text generation', () => {
    expect(validateGenerationReferenceDurations('video', limits, [{ durationMs: 16_000 }], 9_000)?.code).toBe('VIDEO_MODEL_REFERENCE_VIDEO_TOO_LONG')
    expect(validateGenerationReferenceDurations('video', limits, [{ durationMs: 8_000 }, { durationMs: 8_000 }], 9_000)?.code).toBe('VIDEO_MODEL_REFERENCE_VIDEO_TOTAL_DURATION_EXCEEDED')
    expect(validateGenerationReferenceDurations('video', limits, [], 30_000)).toBeNull()
    const ordinaryLimits = projectReferenceDurationLimits({ maxTotalReferenceVideoDurationMs: 15_000 }).video
    expect(validateGenerationReferenceDurations('video', ordinaryLimits, [{ durationMs: 15_000 }], 30_000)).toBeNull()
  })
})
