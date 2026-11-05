import type {
  AsyncTaskProviderRegistration,
  FormatAsyncExternalIdInput,
  ParsedAsyncExternalId,
} from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { cancelFalTask, queryFalStatus } from './queue'

function parseFalExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const type = parts[1]
  if (type === 'VIDEO' || type === 'IMAGE' || type === 'MUSIC' || type === 'VOICE') {
    if (parts.length < 4) {
      throw new Error(`无效 FAL externalId: "${externalId}"，应为 FAL:TYPE:endpoint:requestId`)
    }
    const endpoint = parts.slice(2, -1).join(':')
    const requestId = parts[parts.length - 1]
    if (!endpoint || !requestId) {
      throw new Error(`无效 FAL externalId: "${externalId}"，缺少 endpoint 或 requestId`)
    }
    return {
      provider: 'FAL',
      type,
      endpoint,
      requestId,
    }
  }
  throw new Error(`无效 FAL externalId: "${externalId}"，TYPE 仅支持 VIDEO/IMAGE/MUSIC/VOICE`)
}

function formatFalExternalId(input: FormatAsyncExternalIdInput): string {
  if (!input.endpoint) {
    throw new Error('FAL externalId requires endpoint')
  }
  return `FAL:${input.type}:${input.endpoint}:${input.requestId}`
}

export const falAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'FAL',
  providerKey: 'fal',
  canParseExternalId: (externalId) => externalId.startsWith('FAL:'),
  parseExternalId: parseFalExternalId,
  formatExternalId: formatFalExternalId,
  poll: async ({ parsed, context }) => {
    const endpoint = parsed.endpoint
    if (!endpoint) throw new Error('FAL_ENDPOINT_MISSING')
    const { apiKey, proxyUrl } = await context.getProviderConfig(context.userId, 'fal')
    const result = await withProviderProxyScope(
      proxyUrl,
      async () => await queryFalStatus(endpoint, parsed.requestId, apiKey),
    )
    if (result.failed) {
      if (!result.failure) {
        throw new Error('FAL_FAILED_STATUS_CLASSIFICATION_REQUIRED')
      }
      return normalizeAsyncPollResult({
        status: 'failed',
        failure: result.failure,
        resultUrl: result.resultUrl,
        imageUrl: result.resultUrl,
        videoUrl: result.resultUrl,
      })
    }
    const pending = !result.failed && !result.completed
    return normalizeAsyncPollResult({
      status: result.completed ? 'completed' : 'pending',
      // FAL 官方队列区分 IN_QUEUE（排队）与 IN_PROGRESS（生成中）；分别计入
      // 排队预算与生成预算（async-wait 的双计时协议）。
      ...(pending ? { pendingPhase: result.status === 'IN_QUEUE' ? 'queued' as const : 'running' as const } : {}),
      resultUrl: result.resultUrl,
      imageUrl: result.resultUrl,
      videoUrl: result.resultUrl,
    })
  },
  cancel: async ({ parsed, context }) => {
    const endpoint = parsed.endpoint
    if (!endpoint) throw new Error('FAL_ENDPOINT_MISSING')
    const { apiKey, proxyUrl } = await context.getProviderConfig(context.userId, 'fal')
    await withProviderProxyScope(
      proxyUrl,
      async () => await cancelFalTask(endpoint, parsed.requestId, apiKey),
    )
  },
}
