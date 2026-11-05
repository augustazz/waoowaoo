import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import type {
  AiLlmExecutionResult,
  AiLlmCallOptions,
  AiLlmStreamCallbacks,
  ChatMessage,
} from '@/lib/ai-registry/types'
import { getInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import {
  _ulogError,
  llmLogger,
  logLlmRawInput,
  logLlmRawOutput,
  recordLlmUsage,
  resolveLlmRuntimeModel,
} from '@/lib/ai-exec/llm-runtime'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { describeLlmVariantBase } from '@/lib/ai-exec/llm-descriptor'
import { normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { emitStreamStage, resolveStreamStepMeta } from '@/lib/ai-providers/shared/llm-support'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import { prepareAiTextModelMessages } from '@/lib/ai-exec/language-model'
import { runAiSdkLanguageModel } from '@/lib/ai-exec/llm/sdk-runner'

type ResolvedTextExecution = {
  selection: Awaited<ReturnType<typeof resolveLlmRuntimeModel>>
  providerConfig: Awaited<ReturnType<typeof getProviderConfig>>
  providerKey: string
  projectId?: string
  reasoning: boolean
  reasoningEffort: Awaited<ReturnType<typeof resolveReasoningEffort>>
  openRouterSessionId?: string
  options: AiLlmCallOptions
}

async function resolveTextExecution(input: {
  userId: string
  model: string
  messages: ChatMessage[]
  options: AiLlmCallOptions
  stream: boolean
}): Promise<ResolvedTextExecution> {
  ensureAiCatalogsRegistered()
  const selection = await resolveLlmRuntimeModel(input.userId, input.model)
  const providerKey = getProviderKey(selection.provider).toLowerCase()
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  const projectId = typeof input.options.projectId === 'string' && input.options.projectId.trim()
    ? input.options.projectId.trim()
    : undefined
  const reasoningEffort = await resolveReasoningEffort({
    userId: input.userId,
    modelKey: selection.modelKey,
    purpose: 'analysis',
    projectId,
    explicit: input.options.reasoningEffort,
  })
  const options = { ...input.options, reasoningEffort }
  normalizeAiOptions({
    schema: describeLlmVariantBase({
      modality: 'llm',
      selection,
      executionMode: input.stream ? 'stream' : 'sync',
    }).optionSchema,
    options,
    context: `${input.stream ? 'llm_stream' : 'llm'}:${selection.modelKey}`,
  })
  const reasoning = input.options.reasoning ?? true
  const openRouterSessionId = resolveAiProviderAdapter(selection.provider).resolveLlmSessionId?.({
    kind: 'llm',
    userId: input.userId,
    projectId,
    action: input.options.action,
    modelKey: selection.modelKey,
    explicitSessionId: input.options.openRouterSessionId,
  })
  logLlmRawInput({
    userId: input.userId,
    projectId,
    provider: providerKey,
    modelId: selection.modelId,
    modelKey: selection.modelKey,
    stream: input.stream,
    reasoning,
    reasoningEffort,
    action: input.options.action,
    openRouterSessionId,
    messages: input.messages,
  })
  return {
    selection,
    providerConfig,
    providerKey,
    projectId,
    reasoning,
    reasoningEffort,
    openRouterSessionId,
    options,
  }
}

function logTextResult(input: {
  userId: string
  resolved: ResolvedTextExecution
  result: AiLlmExecutionResult
  stream: boolean
}): void {
  logLlmRawOutput({
    userId: input.userId,
    projectId: input.resolved.projectId,
    provider: input.result.provider,
    modelId: input.resolved.selection.modelId,
    modelKey: input.resolved.selection.modelKey,
    stream: input.stream,
    action: input.resolved.options.action,
    text: input.result.text,
    reasoning: input.result.reasoning,
    termination: input.result.termination,
    usage: input.result.usage,
    providerResponse: input.result.providerMetadata ?? null,
  })
  recordLlmUsage(input.resolved.selection.modelId, input.result.usage)
}

async function executeText(input: {
  userId: string
  model: string
  messages: ChatMessage[]
  options: AiLlmCallOptions
  callbacks?: AiLlmStreamCallbacks
  stream: boolean
}): Promise<AiLlmExecutionResult> {
  const resolved = await resolveTextExecution(input)
  const startedAt = Date.now()
  try {
    const result = await withProviderProxyScope(
      resolved.providerConfig.proxyUrl,
      async () => await runAiSdkLanguageModel({
        providerKey: resolved.providerKey,
        selection: resolved.selection,
        providerConfig: resolved.providerConfig,
        modelMessages: prepareAiTextModelMessages(resolved.selection.provider, input.messages),
        sourceMessages: input.messages,
        reasoning: resolved.reasoning,
        reasoningEffort: resolved.reasoningEffort,
        modality: 'llm',
        executionMode: input.stream ? 'stream' : 'sync',
        openRouterSessionId: resolved.openRouterSessionId,
        options: resolved.options,
        callbacks: input.callbacks,
      }),
    )
    logTextResult({ userId: input.userId, resolved, result, stream: input.stream })
    llmLogger.info({
      action: 'llm.call.success',
      message: 'llm call succeeded',
      provider: result.provider,
      durationMs: Date.now() - startedAt,
      details: {
        model: resolved.selection.modelId,
        stream: input.stream,
        responseId: result.response.id ?? null,
      },
    })
    return result
  } catch (error) {
    llmLogger.error({
      action: input.stream ? 'llm.stream.failed' : 'llm.call.failed',
      message: input.stream ? 'llm stream failed' : 'llm call failed',
      userId: input.userId,
      projectId: resolved.projectId,
      provider: resolved.providerKey,
      durationMs: Date.now() - startedAt,
      details: {
        model: resolved.selection.modelId,
        action: input.options.action ?? null,
      },
      error,
    })
    input.callbacks?.onError?.(error, resolveStreamStepMeta(resolved.options))
    throw error
  }
}

export async function runLlmStream(
  userId: string,
  model: string | null | undefined,
  messages: ChatMessage[],
  options: AiLlmCallOptions = {},
  callbacks?: AiLlmStreamCallbacks,
): Promise<AiLlmExecutionResult> {
  const streamStep = resolveStreamStepMeta(options)
  emitStreamStage(callbacks, streamStep, 'submit')
  if (!model) {
    const error = new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
    callbacks?.onError?.(error, streamStep)
    throw error
  }
  return await executeText({ userId, model, messages, options, callbacks, stream: true })
}

export async function runLlmCompletion(
  userId: string,
  model: string | null | undefined,
  messages: ChatMessage[],
  options: AiLlmCallOptions = {},
): Promise<AiLlmExecutionResult> {
  const internalCallbacks = getInternalLLMStreamCallbacks()
  if (internalCallbacks && !options.__skipAutoStream) {
    return await runLlmStream(
      userId,
      model,
      messages,
      { ...options, __skipAutoStream: true },
      internalCallbacks,
    )
  }
  if (!model) {
    _ulogError('[LLM] 模型未配置，调用栈:', new Error().stack)
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }
  return await executeText({ userId, model, messages, options, stream: false })
}
