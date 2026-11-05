import type { AsyncTaskProviderRegistration, ParsedAsyncExternalId } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { queryOpenRouterVideoStatus } from './video'

function parseOpenRouterExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const type = parts[1]
  const requestId = parts.slice(2).join(':')
  if (type !== 'VIDEO' || !requestId) {
    throw new Error(`无效 OPENROUTER externalId: "${externalId}"，应为 OPENROUTER:VIDEO:requestId`)
  }
  return {
    provider: 'OPENROUTER',
    type: 'VIDEO',
    requestId,
  }
}

export const openRouterAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'OPENROUTER',
  providerKey: 'openrouter',
  canParseExternalId: (externalId) => externalId.startsWith('OPENROUTER:'),
  parseExternalId: parseOpenRouterExternalId,
  formatExternalId: (input) => `OPENROUTER:${input.type}:${input.requestId}`,
  poll: async ({ parsed, context }) => {
    const { apiKey, baseUrl, proxyUrl } = await context.getProviderConfig(context.userId, 'openrouter')
    if (!baseUrl) {
      throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (video)')
    }
    const result = await withProviderProxyScope(proxyUrl, async () => await queryOpenRouterVideoStatus({
      baseUrl,
      apiKey,
      requestId: parsed.requestId,
    }))
    return normalizeAsyncPollResult({
      status: result.status,
      ...(result.status === 'failed' ? { failure: result.failure } : {}),
      videoUrl: result.videoUrl,
      resultUrl: result.resultUrl,
      downloadHeaders: result.downloadHeaders,
    })
  },
}
