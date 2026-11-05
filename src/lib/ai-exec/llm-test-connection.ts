import { ApiError } from '@/lib/api-errors'
import {
  runRegisteredProviderOperation,
  tryResolveAiProviderAdapter,
} from '@/lib/ai-providers'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import type { AiProviderLlmConnectionInput, AiProviderLlmConnectionResult } from '@/lib/ai-providers/runtime-types'

export interface LlmConnectionTestResult {
  provider: string
  message: string
  model?: string
  answer?: string
}

type TestConnectionPayload = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  proxyUrl?: string
  model?: string
}

function normalizeProvider(payload: TestConnectionPayload): string {
  const provider = typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : ''
  if (!provider) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing provider' })
  }
  return provider
}

function requireApiKey(payload: TestConnectionPayload): string {
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (!apiKey) {
    throw new ApiError('INVALID_PARAMS', { message: 'Missing apiKey' })
  }
  return apiKey
}

function resolveLlmConnectionTester(
  provider: string,
): (input: AiProviderLlmConnectionInput) => Promise<AiProviderLlmConnectionResult> {
  const testLlm = tryResolveAiProviderAdapter(provider)?.connectionTest?.testLlm
  if (!testLlm) {
    throw new ApiError('INVALID_PARAMS', { message: `Unsupported provider: ${provider}` })
  }
  return testLlm
}

export async function testLlmConnection(payload: TestConnectionPayload): Promise<LlmConnectionTestResult> {
  const provider = normalizeProvider(payload)
  const testLlm = resolveLlmConnectionTester(provider)
  const tested = await runRegisteredProviderOperation({
    providerId: provider,
    phase: 'connection',
    run: async () => await withProviderProxyScope(
      payload.proxyUrl,
      async () => await testLlm({
        apiKey: requireApiKey(payload),
        baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : undefined,
        model: typeof payload.model === 'string' ? payload.model.trim() : undefined,
      }),
    ),
  })

  return {
    provider,
    message: `${provider} connection ok`,
    ...tested,
  }
}
