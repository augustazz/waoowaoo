import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { AiOptionValidationError, normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'
import {
  FAL_QWEN_VOICE_DESIGN_MODEL_KEY,
  FAL_QWEN_3_TTS_LANGUAGE_OPTIONS,
  FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
} from '@/lib/ai-providers/fal/models'
import { listApiConfigCatalogModels } from '@/lib/ai-registry/api-config-catalog'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { resolveRuntimeModelSelection } from '@/lib/ai-registry/runtime-selection'
import { listPlatformCatalogModels } from '@/lib/platform-models/catalog'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: fetchMock,
  withProviderProxyScope: async (_proxyUrl: string | undefined, operation: () => Promise<unknown>) => await operation(),
}))
const FAL_PROVIDER_CONFIG = { id: 'fal', name: 'FAL', apiKey: 'test-fal-key' }

const selection = {
  provider: 'fal',
  modelId: FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
  modelKey: FAL_QWEN_VOICE_DESIGN_MODEL_KEY,
  variantSubKind: 'official' as const,
}

/**
 * Critical Provider Contract
 * Authority: Qwen Voice Design registry descriptor and the production FAL voice adapter.
 * Fault seam: only the uncontrollable FAL HTTP endpoint is replaced.
 * Rejects: unsupported language values, exposing provider sampling knobs to callers, or serializing anything except text/prompt/language.
 * Final oracle: every registered language validates, unknown options fail before HTTP, and the exact three-field payload reaches FAL queue submission.
 * Command: npx vitest run tests/integration/provider/fal-voice-capability.contract.test.ts
 */
describe('FAL Qwen voice-design capability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureAiCatalogsRegistered()
  })

  it('declares the exhaustive multilingual language set and rejects provider knobs', () => {
    const capabilities = resolveBuiltinCapabilitiesByModelKey(
      'voice',
      FAL_QWEN_VOICE_DESIGN_MODEL_KEY,
    )?.voice
    expect(capabilities?.languageOptions).toEqual(FAL_QWEN_3_TTS_LANGUAGE_OPTIONS)
    const voice = falAdapter.voice
    if (!voice) throw new Error('TEST_FAL_VOICE_ADAPTER_REQUIRED')
    const schema = voice.describe(selection).optionSchema
    for (const language of FAL_QWEN_3_TTS_LANGUAGE_OPTIONS) {
      expect(() => normalizeAiOptions({ schema, options: { language }, context: 'fal-voice-test' }))
        .not.toThrow()
    }
    expect(() => normalizeAiOptions({
      schema,
      options: { language: 'Esperanto' },
      context: 'fal-voice-test',
    })).toThrow(AiOptionValidationError)
    expect(() => normalizeAiOptions({
      schema,
      options: { language: 'Chinese', temperature: 0.8 },
      context: 'fal-voice-test',
    })).toThrow(AiOptionValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('registers the Qwen voice model as a selectable model in each catalog', () => {
    const platformModels = listPlatformCatalogModels()
    expect(resolveRuntimeModelSelection(
      platformModels,
      FAL_QWEN_VOICE_DESIGN_MODEL_KEY,
      'voice',
    )).toMatchObject({
      provider: 'fal',
      modelId: FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
      mediaType: 'voice',
    })
    expect(listApiConfigCatalogModels()).toContainEqual(expect.objectContaining({
      provider: 'fal',
      modelId: FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID,
      type: 'voice',
    }))
  })

  it('submits only the server-owned voice-design contract', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ request_id: 'voice-request-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const voice = falAdapter.voice
    if (!voice) throw new Error('TEST_FAL_VOICE_ADAPTER_REQUIRED')
    const result = await voice.execute({
      userId: 'user-1',
      providerConfig: FAL_PROVIDER_CONFIG,
      selection,
      description: 'A calm mature woman with a warm low register and measured pace.',
      text: '欢迎来到我们的故事。',
      options: { language: 'Chinese' },
    })

    expect(result).toMatchObject({
      success: true,
      async: true,
      requestId: 'voice-request-1',
      externalId: `FAL:VOICE:${FAL_QWEN_3_TTS_VOICE_DESIGN_1_7B_MODEL_ID}:voice-request-1`,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
    expect(body).toEqual({
      text: '欢迎来到我们的故事。',
      prompt: 'A calm mature woman with a warm low register and measured pace.',
      language: 'Chinese',
    })
  })
})
