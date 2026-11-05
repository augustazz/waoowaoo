import {
  runRegisteredProviderOperation,
  tryResolveAiProviderAdapter,
} from '@/lib/ai-providers'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import type {
  AiProviderConnectionTestReport,
  AiProviderConnectionTestStep,
  AiProviderConnectionTestStepName,
} from '@/lib/ai-providers/runtime-types'

export type TestStepName = AiProviderConnectionTestStepName
export type TestStep = AiProviderConnectionTestStep
export type TestProviderResult = AiProviderConnectionTestReport

type TestProviderPayload = {
  apiType: string
  baseUrl?: string
  proxyUrl?: string
  apiKey: string
  llmModel?: string
}

export async function testProviderConnection(payload: TestProviderPayload): Promise<TestProviderResult> {
  const apiKey = payload.apiKey.trim()
  if (!apiKey) {
    return {
      success: false,
      steps: [{ name: 'models', status: 'fail', messageKey: 'connectionTest.authInvalid' }],
    }
  }

  const adapter = tryResolveAiProviderAdapter(payload.apiType)
  const diagnose = adapter?.connectionTest?.diagnose
  if (!diagnose) {
    return {
      success: false,
      steps: [{ name: 'models', status: 'fail', messageKey: 'connectionTest.providerError' }],
    }
  }

  return await runRegisteredProviderOperation({
    providerId: adapter.providerKey,
    phase: 'connection',
    run: async () => await withProviderProxyScope(
      payload.proxyUrl,
      async () => await diagnose({
        apiKey,
        baseUrl: payload.baseUrl,
        llmModel: payload.llmModel,
      }),
    ),
  })
}
