import type { ModelMessage } from 'ai'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import type {
  AiLlmExecutionResult,
  AiLlmCallOptions,
  AiLlmStreamCallbacks,
} from '@/lib/ai-registry/types'
import { getInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import {
  _ulogError,
  llmLogger,
  logLlmRawOutput,
  recordLlmUsage,
  resolveLlmRuntimeModel,
} from '@/lib/ai-exec/llm-runtime'
import { describeLlmVariantBase } from '@/lib/ai-exec/llm-descriptor'
import { normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { emitStreamStage, resolveStreamStepMeta } from '@/lib/ai-providers/shared/llm-support'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import { runAiSdkLanguageModel } from '@/lib/ai-exec/llm/sdk-runner'
import { assertSelectionSupportsMediaInputs } from '@/lib/ai-exec/media-input-transport'

async function normalizeVisionImageUrls(imageUrls: readonly string[], userId: string): Promise<string[]> {
  const normalized: string[] = []
  for (const imageUrl of imageUrls) {
    const trimmed = typeof imageUrl === 'string' ? imageUrl.trim() : ''
    if (!trimmed) continue
    normalized.push(...await normalizeReferenceImagesForGeneration([trimmed], {
      ownerUserId: userId,
      context: { scope: 'vision-input' },
    }))
  }
  return normalized
}

function buildVisionModelMessages(textPrompt: string, imageUrls: string[]): ModelMessage[] {
  return [{
    role: 'user',
    content: [
      ...imageUrls.map((image) => ({ type: 'image' as const, image })),
      ...(textPrompt ? [{ type: 'text' as const, text: textPrompt }] : []),
    ],
  }]
}

async function executeVision(input: {
  userId: string
  model: string
  textPrompt: string
  imageUrls: string[]
  options: AiLlmCallOptions
  callbacks?: AiLlmStreamCallbacks
  stream: boolean
}): Promise<AiLlmExecutionResult> {
  ensureAiCatalogsRegistered()
  const selection = await resolveLlmRuntimeModel(input.userId, input.model)
  assertSelectionSupportsMediaInputs({
    selection,
    modality: 'vision',
    mediaKinds: input.imageUrls.length > 0 ? ['image'] : [],
  })
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
      modality: 'vision',
      selection,
      executionMode: input.stream ? 'stream' : 'sync',
    }).optionSchema,
    options,
    context: `${input.stream ? 'vision_stream' : 'vision'}:${selection.modelKey}`,
  })
  const reasoning = input.options.reasoning ?? true
  const normalizedImageUrls = await normalizeVisionImageUrls(input.imageUrls, input.userId)
  const openRouterSessionId = resolveAiProviderAdapter(selection.provider).resolveLlmSessionId?.({
    kind: 'vision',
    userId: input.userId,
    projectId,
    action: input.options.action,
    modelKey: selection.modelKey,
    explicitSessionId: input.options.openRouterSessionId,
  })
  const startedAt = Date.now()
  try {
    const result = await withProviderProxyScope(
      providerConfig.proxyUrl,
      async () => await runAiSdkLanguageModel({
        providerKey,
        selection,
        providerConfig,
        modelMessages: buildVisionModelMessages(input.textPrompt, normalizedImageUrls),
        reasoning,
        reasoningEffort,
        modality: 'vision',
        executionMode: input.stream ? 'stream' : 'sync',
        openRouterSessionId,
        options,
        callbacks: input.callbacks,
      }),
    )
    logLlmRawOutput({
      userId: input.userId,
      projectId,
      provider: result.provider,
      modelId: selection.modelId,
      modelKey: selection.modelKey,
      stream: input.stream,
      action: input.options.action,
      text: result.text,
      reasoning: result.reasoning,
      termination: result.termination,
      usage: result.usage,
      providerResponse: result.providerMetadata ?? null,
    })
    recordLlmUsage(selection.modelId, result.usage)
    llmLogger.info({
      action: 'llm.vision.success',
      message: 'llm vision call succeeded',
      provider: result.provider,
      durationMs: Date.now() - startedAt,
      details: {
        model: selection.modelId,
        stream: input.stream,
        imageCount: normalizedImageUrls.length,
        responseId: result.response.id ?? null,
      },
    })
    return result
  } catch (error) {
    llmLogger.warn({
      action: 'llm.vision.failed',
      message: 'llm vision call failed',
      userId: input.userId,
      projectId,
      provider: providerKey,
      durationMs: Date.now() - startedAt,
      details: {
        model: selection.modelId,
        stream: input.stream,
        imageCount: normalizedImageUrls.length,
      },
      error,
    })
    input.callbacks?.onError?.(error, resolveStreamStepMeta(options))
    throw error
  }
}

export async function runVisionCompletion(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: AiLlmCallOptions = {},
): Promise<AiLlmExecutionResult> {
  const internalCallbacks = getInternalLLMStreamCallbacks()
  if (internalCallbacks && !options.__skipAutoStream) {
    return await runVisionStream(
      userId,
      model,
      textPrompt,
      imageUrls,
      { ...options, __skipAutoStream: true },
      internalCallbacks,
    )
  }
  if (!model) {
    _ulogError('[LLM Vision] 模型未配置，调用栈:', new Error().stack)
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }
  return await executeVision({ userId, model, textPrompt, imageUrls, options, stream: false })
}

export async function runVisionStream(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
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
  return await executeVision({ userId, model, textPrompt, imageUrls, options, callbacks, stream: true })
}
