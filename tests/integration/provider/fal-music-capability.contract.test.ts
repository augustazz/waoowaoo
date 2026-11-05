import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { AiOptionValidationError, normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'
import {
  FAL_LYRIA_3_PRO_MODEL_ID,
  FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
} from '@/lib/ai-providers/fal/models'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: fetchMock,
  withProviderProxyScope: async (_proxyUrl: string | undefined, operation: () => Promise<unknown>) => await operation(),
}))
const FAL_PROVIDER_CONFIG = { id: 'fal', name: 'FAL', apiKey: 'test-fal-key' }

const selection = {
  provider: 'fal',
  modelId: FAL_LYRIA_3_PRO_MODEL_ID,
  modelKey: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  variantSubKind: 'official' as const,
}

/**
 * Critical Provider Contract
 * Authority: FAL Lyria registry descriptor plus the FAL music submission adapter.
 * Fault seam: the uncontrollable external HTTP endpoint is replaced; descriptor validation and request serialization are production code.
 * Rejects: discrete-only durations, range drift, integer-only validation, changing the frozen prompt, or dropping the deterministic negative prompt on submission.
 * Final oracle: 120, fractional in-range, and 180 pass; out-of-range values fail before HTTP; the exact frozen prompt and negative_prompt reach the provider payload.
 * Command: npx vitest run tests/integration/provider/fal-music-capability.contract.test.ts
 */
describe('FAL Lyria continuous duration capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
  })

  it('declares and validates one continuous 120-180 second range', () => {
    const capabilities = resolveBuiltinCapabilitiesByModelKey('music', FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY)?.music
    expect(capabilities?.durationSecondsRange).toEqual({ min: 120, max: 180 })
    expect(capabilities?.durationSecondsOptions).toBeUndefined()

    const music = falAdapter.music
    if (!music) throw new Error('TEST_FAL_MUSIC_ADAPTER_REQUIRED')
    const schema = music.describe(selection).optionSchema
    for (const durationSeconds of [120, 149.5, 180]) {
      expect(() => normalizeAiOptions({ schema, options: { durationSeconds }, context: 'fal-music-test' }))
        .not.toThrow()
    }
    for (const durationSeconds of [119.999, 180.001]) {
      expect(() => normalizeAiOptions({ schema, options: { durationSeconds }, context: 'fal-music-test' }))
        .toThrow(AiOptionValidationError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits fractional duration guidance and negative prompt through the production adapter', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ request_id: 'request-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const music = falAdapter.music
    if (!music) throw new Error('TEST_FAL_MUSIC_ADAPTER_REQUIRED')
    const prompt = 'Instrumental through-composed restrained underscore.'
    const result = await music.execute({
      userId: 'user-1',
      providerConfig: FAL_PROVIDER_CONFIG,
      selection,
      generation: { kind: 'prompt', prompt },
      options: {
        durationSeconds: 149.5,
        vocalMode: 'instrumental',
        outputFormat: 'mp3',
        negativePrompt: 'pitched vocal timbres, speech-rate prosody',
      },
    })

    expect(result).toMatchObject({ success: true, async: true, requestId: 'request-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    expect(body.negative_prompt).toBe('pitched vocal timbres, speech-rate prosody')
    expect(body.prompt).toBe(prompt)
  })
})
