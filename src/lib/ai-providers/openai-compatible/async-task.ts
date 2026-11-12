import type { AsyncTaskProviderRegistration } from '@/lib/ai-providers/async-task-types'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { queryCompatibleVideoStatus } from './video'

// Custom API providers are instances. Persist the exact provider ID so a
// resumed job never polls a different gateway or uses another instance's key.
export const compatibleVideoAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'COMPATIBLE',
  providerKey: 'openai-compatible',
  canParseExternalId: (externalId) => externalId.startsWith('COMPATIBLE:'),
  formatExternalId: ({ type, requestId, providerToken }) => {
    if (type !== 'VIDEO' || !requestId || !providerToken
      || !/^openai-compatible(?::[^\s]+)?$/u.test(providerToken)) {
      throw new Error('COMPATIBLE_VIDEO_EXTERNAL_ID_INVALID')
    }
    return `COMPATIBLE:VIDEO:${encodeURIComponent(providerToken)}:${encodeURIComponent(requestId)}`
  },
  parseExternalId: (externalId) => {
    const parts = externalId.split(':')
    if (parts.length !== 4 || parts[0] !== 'COMPATIBLE' || parts[1] !== 'VIDEO') {
      throw new Error('COMPATIBLE_VIDEO_EXTERNAL_ID_INVALID')
    }
    const providerToken = decodeURIComponent(parts[2])
    const requestId = decodeURIComponent(parts[3])
    if (!requestId || !/^openai-compatible(?::[^\s]+)?$/u.test(providerToken)) {
      throw new Error('COMPATIBLE_VIDEO_EXTERNAL_ID_INVALID')
    }
    return { provider: 'COMPATIBLE', type: 'VIDEO', providerToken, requestId }
  },
  poll: async ({ parsed, context }) => {
    if (!parsed.providerToken) throw new Error('COMPATIBLE_VIDEO_PROVIDER_ID_REQUIRED')
    const config = await context.getProviderConfig(context.userId, parsed.providerToken)
    return await withProviderProxyScope(config.proxyUrl, () => queryCompatibleVideoStatus({
      providerConfig: config,
      requestId: parsed.requestId,
    }))
  },
}
