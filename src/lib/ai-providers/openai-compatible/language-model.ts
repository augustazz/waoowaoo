import { createOpenAI } from '@ai-sdk/openai'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { normalizeResponsesBaseUrl } from './config'

export function createCompatibleResponsesLanguageModel(input: AiProviderLanguageModelContext) {
  const baseUrl = input.providerConfig.baseUrl?.trim()
  if (!baseUrl) throw new Error('PROVIDER_BASE_URL_MISSING: openai-compatible')
  const provider = createOpenAI({
    name: input.providerKey,
    baseURL: normalizeResponsesBaseUrl(baseUrl),
    apiKey: input.providerConfig.apiKey,
    fetch: fetchWithProviderProxy,
  })
  return provider.responses(input.selection.modelId)
}
