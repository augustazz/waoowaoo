import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import type { AiLlmProtocol, AiPublicReasoningMode, LLMCapabilities } from '@/lib/ai-registry/types'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { AI_PROVIDER_MANIFESTS } from '@/lib/ai-providers/manifests'

function customLlmDefaults(modelKey: string) {
  const selection = parseModelKeyStrict(modelKey)
  if (!selection) return undefined
  const providerKey = selection.provider.split(':', 1)[0]
  return AI_PROVIDER_MANIFESTS.find((manifest) => manifest.providerKey === providerKey)?.customLlm
}

export function resolveRegisteredLlmProtocol(modelKey: string): AiLlmProtocol {
  const protocol = resolveRegisteredLlmCapabilities(modelKey)?.protocol
  if (!protocol) {
    throw new Error(`LLM_PROTOCOL_NOT_REGISTERED:${modelKey}`)
  }
  return protocol
}

export function resolveRegisteredPublicReasoningMode(modelKey: string): AiPublicReasoningMode {
  const llm = resolveRegisteredLlmCapabilities(modelKey)
  if (!llm?.protocol) {
    throw new Error(`LLM_PROTOCOL_NOT_REGISTERED:${modelKey}`)
  }
  return llm.publicReasoningMode ?? 'none'
}

export function resolveRegisteredLlmCapabilities(modelKey: string): LLMCapabilities | undefined {
  return resolveBuiltinCapabilitiesByModelKey('llm', modelKey)?.llm
    ?? customLlmDefaults(modelKey)
}
