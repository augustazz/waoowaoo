import type { AsyncTaskProviderRegistration, ParsedAsyncExternalId } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { queryGeminiBatchStatus, queryGoogleVideoStatus } from './poll'

function parseGeminiExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const type = parts[1]
  const requestId = parts.slice(2).join(':')
  if (type !== 'BATCH' || !requestId) {
    throw new Error(`无效 GEMINI externalId: "${externalId}"，应为 GEMINI:BATCH:batchName`)
  }
  return {
    provider: 'GEMINI',
    type: 'BATCH',
    requestId,
  }
}

function parseGoogleExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const type = parts[1]
  const requestId = parts.slice(2).join(':')
  if (type !== 'VIDEO' || !requestId) {
    throw new Error(`无效 GOOGLE externalId: "${externalId}"，应为 GOOGLE:VIDEO:operationName`)
  }
  return {
    provider: 'GOOGLE',
    type: 'VIDEO',
    requestId,
  }
}

export const geminiBatchAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'GEMINI',
  providerKey: 'google',
  canParseExternalId: (externalId) => externalId.startsWith('GEMINI:'),
  parseExternalId: parseGeminiExternalId,
  formatExternalId: (input) => `GEMINI:${input.type}:${input.requestId}`,
  poll: async ({ parsed, context }) => {
    const { apiKey, proxyUrl } = await context.getProviderConfig(context.userId, 'google')
    const result = await withProviderProxyScope(proxyUrl, async () => await queryGeminiBatchStatus(parsed.requestId, apiKey))
    return normalizeAsyncPollResult({
      status: result.status,
      ...(result.status === 'failed' ? { failure: result.failure } : {}),
      imageUrl: result.imageUrl,
      resultUrl: result.imageUrl,
    })
  },
}

export const googleVideoAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'GOOGLE',
  providerKey: 'google',
  canParseExternalId: (externalId) => externalId.startsWith('GOOGLE:'),
  parseExternalId: parseGoogleExternalId,
  formatExternalId: (input) => `GOOGLE:${input.type}:${input.requestId}`,
  poll: async ({ parsed, context }) => {
    const { apiKey, proxyUrl } = await context.getProviderConfig(context.userId, 'google')
    const result = await withProviderProxyScope(proxyUrl, async () => await queryGoogleVideoStatus(parsed.requestId, apiKey))
    return normalizeAsyncPollResult({
      status: result.status,
      ...(result.status === 'failed' ? { failure: result.failure } : {}),
      videoUrl: result.videoUrl,
      resultUrl: result.videoUrl,
      downloadHeaders: result.videoUrl
        ? { 'x-goog-api-key': apiKey }
        : undefined,
    })
  },
}
