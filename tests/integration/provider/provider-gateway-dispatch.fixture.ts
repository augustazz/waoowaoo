import { beforeEach, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

// A preflight rejection may leave a queued wire response unconsumed.
// Clear implementations as well as call history before the next protocol case.
beforeEach(() => fetchMock.mockReset())

vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: fetchMock,
  withProviderProxyScope: async (_proxyUrl: string | undefined, operation: () => Promise<unknown>) => await operation(),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function chatCompletionResponse(model: string, answer: string): Response {
  return jsonResponse({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [{
      index: 0,
      finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content: answer, refusal: null },
    }],
  })
}

function responsesApiResponse(model: string, answer: string): Response {
  return jsonResponse({
    id: 'resp-test',
    created_at: 0,
    model,
    output: [{
      type: 'message',
      role: 'assistant',
      id: 'msg-test',
      content: [{
        type: 'output_text',
        text: answer,
        logprobs: null,
        annotations: [],
      }],
    }],
  })
}

function responsesApiStream(events: readonly Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function requestUrlOf(call: [RequestInfo | URL, RequestInit?]): string {
  const [input] = call
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const [
  catalogBootstrap,
  llmConnection,
  providerConnection,
  videoModelHelpers,
  ark,
  google,
  openRouter,
  openRouterSession,
  falModels,
] = await Promise.all([
  import('@/lib/ai-exec/catalog-bootstrap'),
  import('@/lib/ai-exec/llm-test-connection'),
  import('@/lib/ai-exec/provider-test'),
  import('@/lib/ai-registry/video-model-helpers'),
  import('@/lib/ai-providers/ark/adapter'),
  import('@/lib/ai-providers/google/adapter'),
  import('@/lib/ai-providers/openrouter/adapter'),
  import('@/lib/ai-providers/openrouter/session'),
  import('@/lib/ai-providers/fal/models'),
])
const { ensureAiCatalogsRegistered } = catalogBootstrap
const { testLlmConnection } = llmConnection
const { testProviderConnection } = providerConnection
const { supportsAssetReferenceMultiReferenceVideoModel } = videoModelHelpers
const { arkAdapter } = ark
const { googleAdapter } = google
const { openRouterAdapter } = openRouter
const { buildOpenRouterSessionId, normalizeOpenRouterSessionId } = openRouterSession
const {
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
} = falModels

export { beforeEach, describe, expect, it } from 'vitest'
export {
  arkAdapter,
  buildOpenRouterSessionId,
  chatCompletionResponse,
  ensureAiCatalogsRegistered,
  FAL_HAPPY_HORSE_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_O3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_PRO_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_KLING_V3_STANDARD_IMAGE_TO_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  FAL_SEEDANCE_2_VIDEO_MODEL_ID,
  fetchMock,
  googleAdapter,
  jsonResponse,
  normalizeOpenRouterSessionId,
  openRouterAdapter,
  requestUrlOf,
  responsesApiResponse,
  responsesApiStream,
  supportsAssetReferenceMultiReferenceVideoModel,
  testLlmConnection,
  testProviderConnection,
  vi,
}
