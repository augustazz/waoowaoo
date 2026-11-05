import type { ModelCapabilities, UnifiedModelType } from '@/lib/ai-registry/types'
import type { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'

export interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

export type UserModelsPayload = Record<UnifiedModelType, UserModelOption[]>

export type DefaultModelField = 'assistantModel'

export interface StoredProvider {
  id: string
  name: string
  baseUrl?: string
  proxyUrl?: string
  apiKey?: string
}

export interface StoredModel {
  modelId: string
  modelKey: string
  name: string
  type: UnifiedModelType
  provider: string
  // Non-authoritative display field; billing always uses server pricing catalog.
  price: number
  priceMin?: number
  priceMax?: number
  priceLabel?: string
  priceInput?: number
  priceOutput?: number
  capabilities?: ModelCapabilities
}

export interface PricingDisplayItem {
  min: number
  max: number
  label: string
  input?: number
  output?: number
}

export type PricingDisplayMap = Record<string, PricingDisplayItem>

export interface DefaultModelsPayload {
  assistantModel?: string
}

export interface WorkflowConcurrencyPayload {
  analysis?: number
  image?: number
  video?: number
}

export interface ApiConfigPutBody {
  models?: unknown
  providers?: unknown
  defaultModels?: unknown
  capabilityDefaults?: unknown
  workflowConcurrency?: unknown
}

export const DEFAULT_MODEL_FIELDS: readonly DefaultModelField[] = ['assistantModel']
export const CAPABILITY_MODEL_TYPES: readonly UnifiedModelType[] = [
  'image',
  'video',
  'llm',
  'music',
  'voice',
]
