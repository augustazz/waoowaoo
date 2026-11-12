import { describe, expect, it } from 'vitest'
import catalog from '../../fixtures/video-contract-catalog.json'
import { compileVideoContracts, resolveDeclaredVideoContract, videoChannelUnavailableReason } from '@/lib/ai-registry/video-contracts'
import { videoConstraintIssue } from '@/lib/ai-registry/video-constraints'
import { verifyVideoOutput } from '@/lib/ai-registry/video-output-verification'
import { videoMaterialIssue } from '@/lib/ai-registry/video-material-spec'

describe('versioned video contract data', () => {
  it('adds a new alias with data and binds same-name aliases independently to exact provider instances', () => {
    const raw = structuredClone(catalog)
    const channel = raw.channels[0]
    raw.channels = ['first', 'second'].map((id, index) => ({
      ...channel, id, provider: `openai-compatible:${id}`,
      baseUrl: `https://${id}.test/v1`, models: [{ modelId: 'new-video-alias', family: index ? 'seedance-gateway' : 'wan30', resolutionOptions: ['720p'] }],
    }))
    const entries = compileVideoContracts(raw)
    const first = resolveDeclaredVideoContract('openai-compatible:first::new-video-alias', entries)!
    const second = resolveDeclaredVideoContract('openai-compatible:second::new-video-alias', entries)!
    expect(first.capabilities.maxReferenceImages).toBe(10)
    expect(second.capabilities.maxReferenceImages).toBe(1)
    expect(first.fingerprint).not.toBe(second.fingerprint)
    expect(videoChannelUnavailableReason(first, 'https://first.test/v1/')).toBeNull()
    expect(videoChannelUnavailableReason(first, 'https://second.test/v1')).toBe('channel_mismatch')
    expect(resolveDeclaredVideoContract('openai-compatible:other::new-video-alias', entries)).toBeUndefined()
  })

  it.each(['https://bad.test/v1?key=secret', 'https://user:pass@bad.test/v1', 'http://bad.test/v1'])('rejects unsafe channel identities %s', (baseUrl) => {
    const raw = structuredClone(catalog)
    raw.channels[0].baseUrl = baseUrl
    expect(() => compileVideoContracts(raw)).toThrow()
  })

  it('rejects incomplete, contradictory and duplicate declarations', () => {
    const missing = structuredClone(catalog)
    missing.channels[0].models[0].family = 'missing'
    expect(() => compileVideoContracts(missing)).toThrow('Unknown family')
    const duplicate = structuredClone(catalog)
    duplicate.channels[0].models.push(duplicate.channels[0].models[0])
    expect(() => compileVideoContracts(duplicate)).toThrow('Duplicate binding')
    const audio = structuredClone(catalog)
    audio.families[1].audio.control = 'toggle'
    expect(() => compileVideoContracts(audio)).toThrow('Audio toggle')
  })

  it('keeps unfamiliar protocols as non-executable declarations and never assumes JSON', () => {
    const raw = structuredClone(catalog)
    raw.channels[0].protocol = 'future-protocol-v1'
    const entry = compileVideoContracts(raw)[0]
    expect(videoChannelUnavailableReason(entry, entry.baseUrl)).toBe('protocol_unsupported')
  })

  it('changes the fingerprint when rules or endpoint change even if someone forgets to bump revision', () => {
    const first = compileVideoContracts(catalog)[0].fingerprint
    const raw = structuredClone(catalog)
    raw.channels[0].baseUrl = 'https://different.test/v1'
    expect(compileVideoContracts(raw)[0].fingerprint).not.toBe(first)
  })
})

describe('shared conditional video rules', () => {
  const rules = [{ when: { resolution: '1080p', inputMode: 'reference' as const }, durationOptions: [4, 5], maxReferenceImages: 1 }]
  const input = { resolution: '1080p', inputMode: 'reference' as const, duration: 6, referenceImages: 1, referenceAudios: 0, referenceVideos: 0 }
  it('rejects a conditional combination although each scalar value is otherwise supported', () => {
    expect(videoConstraintIssue(rules, input)).toBe('VIDEO_MODEL_CONDITIONAL_DURATION_UNSUPPORTED')
    expect(videoConstraintIssue(rules, { ...input, duration: 5 })).toBeNull()
    expect(videoConstraintIssue(rules, { ...input, duration: 5, referenceImages: 2 })).toBe('VIDEO_MODEL_CONDITIONAL_REFERENCE_LIMIT_EXCEEDED')
    expect(videoConstraintIssue(rules, { ...input, resolution: '720p' })).toBeNull()
  })
})

describe('video output acceptance', () => {
  const input = { actual: { durationMs: 5000, width: 720, height: 1280, hasAudio: true }, durationSeconds: 5,
    aspectRatio: '9:16', resolution: '720p', audioDefault: 'on' as const,
    outputSizes: [{ resolution: '720p', aspectRatio: '9:16', width: 720, height: 1280 }] }
  it('checks technical facts while leaving content acceptance pending', () => {
    expect(verifyVideoOutput(input)).toMatchObject({ status: 'passed', issues: [], contentAcceptance: 'pending' })
  })
  it('marks mismatches for review without throwing away a paid output or triggering a new submission', () => {
    expect(verifyVideoOutput({ ...input, actual: { durationMs: 8000, width: 480, height: 854, hasAudio: false } })).toMatchObject({
      status: 'needs_review', issues: expect.arrayContaining(['duration_mismatch', 'resolution_mismatch', 'audio_track_mismatch']),
    })
  })
  it('does not mistake an undeclared exact output size for a media mismatch', () => {
    expect(verifyVideoOutput({ ...input, outputSizes: [] })).toMatchObject({
      status: 'passed', issues: [], resolutionCheck: 'not_declared',
    })
    expect(verifyVideoOutput({ ...input, outputSizes: undefined })).toMatchObject({ status: 'passed', issues: [] })
    expect(verifyVideoOutput({ ...input, outputSizes: [], actual: { ...input.actual, durationMs: 9000 } })).toMatchObject({
      status: 'needs_review', issues: ['duration_mismatch'], resolutionCheck: 'not_declared',
    })
  })
})

describe('declared reference file specifications', () => {
  const spec = { mimeTypes: ['image/png'], maxBytes: 1000, minWidth: 320, maxWidth: 1920 }
  const facts = { mimeType: 'image/png', sizeBytes: 1000, width: 720, height: 1280 }
  it('checks exact boundaries and refuses missing evidence for declared limits', () => {
    expect(videoMaterialIssue(spec, facts)).toBeNull()
    expect(videoMaterialIssue(spec, { ...facts, width: null })).toBe('VIDEO_REFERENCE_DIMENSIONS_UNSUPPORTED')
    expect(videoMaterialIssue(spec, { ...facts, width: 2000 })).toBe('VIDEO_REFERENCE_DIMENSIONS_UNSUPPORTED')
    expect(videoMaterialIssue(spec, { ...facts, mimeType: 'image/jpeg' })).toBe('VIDEO_REFERENCE_FORMAT_UNSUPPORTED')
    expect(videoMaterialIssue(spec, { ...facts, sizeBytes: 1001 })).toBe('VIDEO_REFERENCE_SIZE_UNSUPPORTED')
  })
})
