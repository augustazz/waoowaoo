import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import { openRouterAsyncTaskProvider } from '@/lib/ai-providers/openrouter/async-task'
import {
  OPENROUTER_API_CONFIG_CATALOG_MODELS,
  OPENROUTER_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
  OPENROUTER_BUILTIN_PRICING_CATALOG_ENTRIES,
  OPENROUTER_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/openrouter/models'
import { defineAiProviderManifest } from '@/lib/ai-providers/manifest'
import { OPENROUTER_DEFAULT_BASE_URL } from '@/lib/ai-providers/openrouter/config'

const BOTH_TRANSPORTS = ['public-https', 'inline-data-url'] as const
const PUBLIC_HTTPS_ONLY = ['public-https'] as const

export const openRouterProviderManifest = defineAiProviderManifest({
  providerKey: 'openrouter',
  adapter: openRouterAdapter,
  apiConfig: {
    visibility: 'hidden',
    name: 'OpenRouter',
    baseUrl: OPENROUTER_DEFAULT_BASE_URL,
  },
  platformCredentials: {
    envPrefix: 'PLATFORM_OPENROUTER',
    requiresBaseUrl: true,
  },
  asyncTasks: [openRouterAsyncTaskProvider],
  catalogs: {
    capabilities: OPENROUTER_BUILTIN_CAPABILITY_CATALOG_ENTRIES,
    pricing: OPENROUTER_BUILTIN_PRICING_CATALOG_ENTRIES,
    apiConfigModels: OPENROUTER_API_CONFIG_CATALOG_MODELS,
    platformModels: OPENROUTER_PLATFORM_MODEL_PRESETS,
  },
  mediaInputs: [
    { modality: 'vision', transports: { image: BOTH_TRANSPORTS } },
    { modality: 'image', transports: { image: BOTH_TRANSPORTS } },
    {
      modality: 'video',
      transports: {
        image: BOTH_TRANSPORTS,
        audio: PUBLIC_HTTPS_ONLY,
        video: PUBLIC_HTTPS_ONLY,
      },
    },
  ],
})
