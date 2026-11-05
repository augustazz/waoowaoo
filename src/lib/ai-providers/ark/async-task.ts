import type { AsyncTaskProviderRegistration, ParsedAsyncExternalId } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { querySeedanceVideoStatus } from './poll'

function parseArkExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const type = parts[1]
  const requestId = parts.slice(2).join(':')
  if ((type !== 'VIDEO' && type !== 'IMAGE') || !requestId) {
    throw new Error(`无效 ARK externalId: "${externalId}"，应为 ARK:TYPE:requestId`)
  }
  return {
    provider: 'ARK',
    type,
    requestId,
  }
}

export const arkAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'ARK',
  providerKey: 'ark',
  canParseExternalId: (externalId) => externalId.startsWith('ARK:'),
  parseExternalId: parseArkExternalId,
  formatExternalId: (input) => `ARK:${input.type}:${input.requestId}`,
  poll: async ({ parsed, context }) => {
    const { apiKey, baseUrl, proxyUrl } = await context.getProviderConfig(context.userId, 'ark')
    if (!baseUrl) throw new Error('PROVIDER_BASE_URL_MISSING: ark (video-poll)')
    const result = await withProviderProxyScope(
      proxyUrl,
      async () => await querySeedanceVideoStatus(parsed.requestId, { apiKey, baseUrl }),
    )
    return normalizeAsyncPollResult({
      status: result.status,
      ...(result.status === 'failed' ? { failure: result.failure } : {}),
      videoUrl: result.videoUrl,
      resultUrl: result.videoUrl,
      ...(typeof result.actualVideoTokens === 'number' ? { actualVideoTokens: result.actualVideoTokens } : {}),
    })
  },
}
