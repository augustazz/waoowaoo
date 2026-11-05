import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  preference: {} as Record<string, unknown>,
  fetch: vi.fn(),
  claim: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userPreference: {
      findUnique: vi.fn(async () => mocks.preference),
      upsert: vi.fn(async ({ update }: { update: Record<string, unknown> }) => {
        Object.assign(mocks.preference, update)
        return mocks.preference
      }),
    },
  },
}))
vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: mocks.fetch,
  withProviderProxyScope: async (_proxyUrl: string | undefined, operation: () => Promise<unknown>) => await operation(),
}))
vi.mock('@/lib/codex-model-gateway/active-turn-guard', () => ({
  requireCodexModelGatewayModelActiveTurn: vi.fn(async () => ({ turnId: 'turn-1', attempt: 1 })),
}))
vi.mock('@/lib/codex-model-gateway/provider-attempt', () => ({
  claimCodexProviderAttempt: mocks.claim,
  succeedCodexProviderAttempt: mocks.succeed,
  failCodexProviderAttempt: mocks.fail,
  cancelCodexProviderAttempt: mocks.cancel,
}))

import { getUserApiConfig, putUserApiConfig } from '@/lib/user-api/api-config-service'
import { createUserApiConfigConnectionDiagnosticOperations } from '@/lib/operations/api-only/user-api-config-connection-ops'
import { createUserApiConfigOperations } from '@/lib/operations/domains/config/user-api-config-ops'
import { listUserProviderModels } from '@/lib/user-api/provider-model-discovery'
import { modelAspectRatios } from '@/lib/ai-registry/model-aspect-ratios'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { executeCompatibleImage, describeCompatibleImage } from '@/lib/ai-providers/openai-compatible/image'
import { normalizeResponsesBaseUrl } from '@/lib/ai-providers/openai-compatible/config'
import { createAiLanguageModel } from '@/lib/ai-exec/language-model'
import { resolveRegisteredLlmProtocol, resolveRegisteredPublicReasoningMode } from '@/lib/ai-registry/llm-protocol'
import { resolveCodexModelGatewayRuntimeConfig, resolveCodexModelGatewayUpstream } from '@/lib/codex-model-gateway/selection'
import { proxyCodexResponsesRequest } from '@/lib/codex-model-gateway/proxy'
import { issueWaoRuntimeToken } from '@/lib/wao-mcp/runtime-token'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'

const scope = { userId: 'custom-user', projectId: 'custom-project', assistantId: 'workspace-command' } as const
const apiKey = 'test-only-custom-provider-key'
const modelId = 'openai/my-local-model'
const modelKey = `openai-compatible::${modelId}`
const baseUrl = 'http://localhost:9911/v1'

async function configure(provider = 'openai-compatible', id = modelId) {
  await putUserApiConfig(scope.userId, {
    providers: [{ id: provider, name: 'Test provider', baseUrl: `${baseUrl}/`, apiKey }],
    models: [{ provider, modelId: id, type: 'llm', name: 'Local model' }],
    defaultModels: { assistantModel: `${provider}::${id}` },
  })
}

async function request(id = modelId) {
  return proxyCodexResponsesRequest({
    scope: { ...scope, nonce: 'test-runtime-nonce' },
    request: new Request('http://localhost/api/internal/codex-runtime/model/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model: id, input: [{ role: 'user', content: 'hello' }], stream: true, client_metadata: { turn_id: 'turn-1' } }),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DEPLOYMENT_EDITION', 'self-hosted')
  vi.stubEnv('PROVIDER_CREDENTIAL_MODE', 'user-key')
  vi.stubEnv('BILLING_MODE', 'OFF')
  vi.stubEnv('API_ENCRYPTION_KEY', 'custom-provider-test-encryption-only')
  vi.stubEnv('NEXTAUTH_SECRET', 'custom-provider-test-auth-secret-only')
  mocks.preference = {}
  mocks.claim.mockImplementation(async (input: Record<string, unknown>) => ({ ...input, id: 'attempt-1', sequence: BigInt(1) }))
})

describe('custom Responses provider', () => {
  it('saves arbitrary model IDs and encrypted credentials, exposes only credential presence', async () => {
    await configure()
    expect(mocks.preference.customProviders).not.toContain(apiKey)
    const config = await getUserApiConfig(scope.userId)
    expect(config.providers).toEqual([{ id: 'openai-compatible', name: 'Test provider', baseUrl, hasApiKey: true }])
    expect(config.defaultModels.assistantModel).toBe(modelKey)
    expect(config.models).toEqual([expect.objectContaining({ modelId, modelKey, type: 'llm' })])
    expect(config.catalog.providers).toContainEqual(expect.objectContaining({ id: 'openai-compatible', editableBaseUrl: true, modelTypes: ['llm', 'image'], featured: true }))
    await putUserApiConfig(scope.userId, {
      providers: [{ id: 'openai-compatible', name: 'Test provider', baseUrl: 'http://localhost:9922/api' }],
    })
    expect(await resolveCodexModelGatewayUpstream(scope)).toMatchObject({ providerApiKey: apiKey, responsesEndpoint: 'http://localhost:9922/api/responses' })
  })

  it('persists a per-provider proxy and preserves it when omitted from later saves', async () => {
    await configure()
    await putUserApiConfig(scope.userId, {
      providers: [{ id: 'openai-compatible', name: 'Test provider', baseUrl, proxyUrl: 'http://127.0.0.1:7890' }],
    })
    expect((await getUserApiConfig(scope.userId)).providers).toEqual([{
      id: 'openai-compatible',
      name: 'Test provider',
      baseUrl,
      proxyUrl: 'http://127.0.0.1:7890',
      hasApiKey: true,
    }])
    expect(await resolveCodexModelGatewayUpstream(scope)).toMatchObject({
      providerProxyUrl: 'http://127.0.0.1:7890',
    })

    await putUserApiConfig(scope.userId, {
      providers: [{ id: 'openai-compatible', name: 'Test provider', baseUrl }],
    })
    expect((await getUserApiConfig(scope.userId)).providers[0]?.proxyUrl).toBe('http://127.0.0.1:7890')
  })

  it('keeps upstream credentials out of the Codex runtime configuration', async () => {
    await configure()
    expect(await resolveCodexModelGatewayUpstream(scope)).toEqual({
      providerKey: 'openai-compatible', modelId, modelKey, runtimeModelId: modelId,
      responsesEndpoint: `${baseUrl}/responses`, providerApiKey: apiKey,
    })
    const { token } = issueWaoRuntimeToken({ scope })
    const runtime = await resolveCodexModelGatewayRuntimeConfig({ scope, runtimeReachableWaoBaseUrl: 'http://app:3000', runtimeBearerToken: token })
    expect(runtime).toMatchObject({ runtimeModelId: modelId, wireApi: 'responses', baseUrl: 'http://app:3000/api/internal/codex-runtime/model', bearerToken: token })
    expect(JSON.stringify(runtime)).not.toContain(apiKey)
    expect(JSON.stringify(runtime)).not.toContain(baseUrl)
  })

  it('registers arbitrary IDs for the auxiliary Responses language adapter', async () => {
    await configure()
    expect(resolveRegisteredLlmProtocol(modelKey)).toBe('openai-responses')
    expect(resolveRegisteredPublicReasoningMode(modelKey)).toBe('none')
    const upstream = await resolveCodexModelGatewayUpstream(scope)
    const model = createAiLanguageModel({
      providerKey: 'openai-compatible',
      selection: { provider: 'openai-compatible', modelId, modelKey },
      providerConfig: { id: 'openai-compatible', name: 'Test', apiKey: upstream.providerApiKey, baseUrl },
      executionMode: 'sync',
      reasoning: false,
      reasoningEffort: 'none',
    })
    expect(model).toMatchObject({ modelId })
    expect(() => resolveRegisteredLlmProtocol('unknown::model')).toThrow('LLM_PROTOCOL_NOT_REGISTERED')
  })

  it('starts Assistant reasoning configuration for arbitrary IDs without builtin model capabilities', async () => {
    await configure()
    for (const purpose of ['assistant', 'analysis', 'utility'] as const) {
      expect(await resolveReasoningEffort({ userId: scope.userId, modelKey, purpose })).toBe('none')
    }
    await expect(resolveReasoningEffort({ userId: scope.userId, modelKey: 'unknown::model', purpose: 'assistant' }))
      .rejects.toThrow('LLM_CAPABILITIES_REQUIRED')
  })

  it('forwards authenticated tool streams and settles the custom provider', async () => {
    await configure()
    const sse = 'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","name":"tool","call_id":"call-1","arguments":"{}"}}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1","status":"completed"}}\n\n'
    mocks.fetch.mockResolvedValue(new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }))
    expect(await (await request()).text()).toBe(sse)
    expect(mocks.fetch).toHaveBeenCalledWith(`${baseUrl}/responses`, expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` }) }))
    const body = JSON.parse(new TextDecoder().decode(mocks.fetch.mock.calls[0][1].body))
    expect(body.model).toBe(modelId)
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'openai-compatible', modelKey }))
    expect(mocks.succeed).toHaveBeenCalledOnce()
  })

  it('attributes HTTP authentication failures to the custom service', async () => {
    await configure()
    mocks.fetch.mockResolvedValue(Response.json({ error: { message: 'Invalid test key', type: 'authentication_error', code: 'invalid_api_key' } }, { status: 401 }))
    await (await request()).text()
    expect(mocks.fail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failure: expect.objectContaining({ context: expect.objectContaining({ provider: 'openai-compatible' }) }) }))
  })

  it('attributes interrupted streams to the custom service', async () => {
    await configure()
    mocks.fetch.mockResolvedValue(new Response('data: {"type":"response.created"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    await (await request()).text().catch(() => undefined)
    expect(mocks.fail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failure: expect.objectContaining({ context: expect.objectContaining({ provider: 'openai-compatible', phase: 'stream' }) }) }))
    expect(mocks.succeed).not.toHaveBeenCalled()
  })

  it('attributes connection errors to the custom service', async () => {
    await configure()
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(request()).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_FAILED' })
    expect(mocks.fail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failure: expect.objectContaining({ context: expect.objectContaining({ provider: 'openai-compatible' }) }) }))
  })

  it('offers the custom provider without an OpenRouter entry in the page catalog', async () => {
    const config = await getUserApiConfig(scope.userId)
    expect(config.catalog.providers.map((provider) => provider.id)).toContain('openai-compatible')
    expect(config.catalog.providers.map((provider) => provider.id)).not.toContain('openrouter')
    expect(config.catalog.models.every((model) => model.provider !== 'openrouter')).toBe(true)
  })

  it('saves and reloads a custom model selection before credentials are configured', async () => {
    await configure('google', 'gemini-test')
    await putUserApiConfig(scope.userId, {
      providers: [
        { id: 'google', name: 'Google', apiKey },
        { id: 'openai-compatible:local', name: 'My local API', baseUrl },
      ],
      models: [
        { provider: 'google', modelId: 'gemini-test', type: 'llm' },
        { provider: 'openai-compatible:local', modelId, type: 'llm' },
      ],
      defaultModels: { assistantModel: `openai-compatible:local::${modelId}` },
    })
    const config = await getUserApiConfig(scope.userId)
    expect(config.defaultModels.assistantModel).toBe(`openai-compatible:local::${modelId}`)
    expect(config.providers).toContainEqual(expect.objectContaining({ id: 'openai-compatible:local', hasApiKey: false }))
    await expect(resolveCodexModelGatewayUpstream(scope)).rejects.toMatchObject({ code: 'ASSISTANT_MODEL_UNSUPPORTED' })
  })

  it('rejects unsupported video models for the custom provider', async () => {
    await expect(putUserApiConfig(scope.userId, {
      providers: [{ id: 'openai-compatible', name: 'Test', baseUrl, apiKey }],
      models: [{ provider: 'openai-compatible', modelId, type: 'video' }],
    })).rejects.toThrow()
  })

  it('accepts instance selection keys and rejects client-supplied discovery credentials', () => {
    const save = createUserApiConfigOperations().put_user_api_config.inputSchema
    expect(save.safeParse({ defaultModels: { assistantModel: 'openai-compatible:local::exact/model' } }).success).toBe(true)
    expect(save.safeParse({ defaultModels: { assistantModel: 'unqualified-model' } }).success).toBe(false)
    const discovery = createUserApiConfigConnectionDiagnosticOperations().api_user_api_config_list_provider_models.inputSchema
    expect(discovery.safeParse({ providerId: 'openai-compatible:local' }).success).toBe(true)
    expect(discovery.safeParse({ providerId: '' }).success).toBe(false)
    expect(discovery.safeParse({ providerId: 'openai-compatible', apiKey, baseUrl }).success).toBe(false)
  })

  it('discovers models using the selected instance and its encrypted saved credentials', async () => {
    await configure('openai-compatible:local')
    mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: 'gpt-image-1' }, { id: 'gpt-5', input_modalities: ['text', 'image'], output_modalities: ['text'] }] }))
    const result = await listUserProviderModels(scope.userId, 'openai-compatible:local')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledWith(`${baseUrl}/models`, expect.objectContaining({ method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }))
    expect(result.models).toContainEqual(expect.objectContaining({ id: 'gpt-image-1', types: ['image'] }))
    expect(result.models).toContainEqual(expect.objectContaining({ id: 'gpt-5', types: ['llm'] }))
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })

  it.each([401, 404, 429])('reports discovery HTTP %s without returning a false empty list', async status => {
    await configure()
    mocks.fetch.mockResolvedValue(Response.json({ error: { message: 'Test provider error' } }, { status }))
    await expect(listUserProviderModels(scope.userId, 'openai-compatible')).rejects.toThrow()
  })

  it('rejects malformed lists and network failures', async () => {
    await configure()
    mocks.fetch.mockResolvedValue(Response.json({ object: 'invalid' }))
    await expect(listUserProviderModels(scope.userId, 'openai-compatible')).rejects.toThrow('invalid model list')
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(listUserProviderModels(scope.userId, 'openai-compatible')).rejects.toThrow()
  })

  it('does not contact upstream without saved credentials', async () => {
    await putUserApiConfig(scope.userId, { providers: [{ id: 'openai-compatible', name: 'Test', baseUrl }] })
    await expect(listUserProviderModels(scope.userId, 'openai-compatible')).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('saves arbitrary image models and describes their execution', async () => {
    await putUserApiConfig(scope.userId, {
      providers: [{ id: 'openai-compatible', name: 'Test', baseUrl, apiKey }],
      models: [{ provider: 'openai-compatible', modelId: 'local-image', type: 'image' }],
    })
    expect((await getUserApiConfig(scope.userId)).models).toContainEqual(expect.objectContaining({ modelId: 'local-image', type: 'image' }))
    expect(describeCompatibleImage({ variantSubKind: 'official' as const, provider: 'openai-compatible', modelId, modelKey })).toMatchObject({ modality: 'image', execution: { mode: 'sync' } })
  })

  const imageInput = {
    userId: scope.userId, prompt: 'Mock image only',
    providerConfig: { id: 'openai-compatible', name: 'Test', apiKey, baseUrl },
    selection: { variantSubKind: 'official' as const, provider: 'openai-compatible', modelId: 'local-image', modelKey: 'openai-compatible::local-image' },
  }

  it('calls the configured Images API with exact ID and decodes base64 output', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: [{ b64_json: 'cG5n' }] }))
    expect(await executeCompatibleImage(imageInput)).toMatchObject({ success: true, imageUrl: 'data:image/png;base64,cG5n' })
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`${baseUrl}/images/generations`)
    expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`)
    expect(JSON.parse(init.body)).toEqual({ model: 'local-image', prompt: 'Mock image only', n: 1 })
  })

  it.each(['grok-imagine-image', 'grok-imagine-image-quality', 'xai/grok-imagine-image'])('preserves the project 9:16 frame through preflight and %s submission', async id => {
    const selection = { variantSubKind: 'official' as const, provider: 'openai-compatible:local', modelId: id, modelKey: `openai-compatible:local::${id}` }
    expect(modelAspectRatios(selection.modelKey, 'image')).toContain('9:16')
    expect(modelAspectRatios(selection.modelKey, 'image')).not.toContain('9:21')
    const options = normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { aspectRatio: '9:16' } })
    // Planning freezes scalar options and validates them again before execution.
    expect(normalizeMediaOptionsForSelection({ selection, modality: 'image', options })).toEqual({ aspectRatio: '9:16' })
    mocks.fetch.mockResolvedValue(Response.json({ data: [{ url: 'https://example.com/portrait.png' }] }))
    await executeCompatibleImage({ ...imageInput, selection, options })
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${baseUrl}/images/generations`)
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ model: id, prompt: imageInput.prompt, n: 1, aspect_ratio: '9:16' })
  })

  it('rejects unsupported Grok image frames before contacting the service', () => {
    const selection = { variantSubKind: 'official' as const, provider: 'openai-compatible', modelId: 'grok-imagine-image', modelKey: 'openai-compatible::grok-imagine-image' }
    expect(() => normalizeMediaOptionsForSelection({ selection, modality: 'image', options: { aspectRatio: '9:21' } })).toThrow('aspectRatio')
    // Unknown aliases must not be advertised as having Grok Imagine capabilities.
    expect(modelAspectRatios('openai-compatible::grok-4.6', 'image')).toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('uses multipart image edits for references and supports URL results', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: [{ url: 'https://example.com/result.png' }] }))
    expect(await executeCompatibleImage({ ...imageInput, options: { referenceImages: ['data:image/png;base64,cG5n'], size: '1024x1024' } })).toMatchObject({ imageUrl: 'https://example.com/result.png' })
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe(`${baseUrl}/images/edits`)
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('model')).toBe('local-image')
    expect(init.body.getAll('image[]')).toHaveLength(1)
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('rejects image HTTP failures and missing outputs', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: { message: 'Test failure' } }, { status: 401 }))
    await expect(executeCompatibleImage(imageInput)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_INVALID',
      disposition: 'pre_accept_rejected',
    })
    mocks.fetch.mockResolvedValue(Response.json({ data: [] }))
    await expect(executeCompatibleImage(imageInput)).rejects.toThrow('no images')
  })

  it('classifies a channel-router get_channel_failed rejection as pre-accept', async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      error: {
        type: 'new_api_error',
        code: 'get_channel_failed',
        message: 'No available channel for model local-image',
      },
    }, { status: 500 }))
    await expect(executeCompatibleImage(imageInput)).rejects.toMatchObject({
      name: 'ProviderSubmissionError',
      code: 'PROVIDER_SUBMISSION_REJECTED',
      disposition: 'pre_accept_rejected',
    })
  })

  it('keeps ambiguous upstream 5xx failures as unknown outcomes', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ error: { message: 'Upstream exploded' } }, { status: 500 }))
    const error = await executeCompatibleImage(imageInput).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toMatchObject({ name: 'ProviderHttpError', statusCode: 500 })
    expect(error).not.toHaveProperty('disposition')
  })

  it.each(['ftp://localhost/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment', 'https://example.com/v1/responses', 'https://example.com/v1/chat/completions'])('rejects invalid Base URL %s', async (url) => {
    expect(() => normalizeResponsesBaseUrl(url)).toThrow()
    await expect(putUserApiConfig(scope.userId, { providers: [{ id: 'openai-compatible', name: 'Test', baseUrl: url }] })).rejects.toThrow()
  })
})
