import { defineAiProviderManifest } from '@/lib/ai-providers/manifest'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { OPENAI_COMPATIBLE_PROVIDER_KEY } from './config'
import { createCompatibleResponsesLanguageModel } from './language-model'
import { describeCompatibleImage, executeCompatibleImage } from './image'

export const openAiCompatibleProviderManifest = defineAiProviderManifest({
  providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
  adapter: {
    providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
    failure: createAiProviderFailureAdapter(OPENAI_COMPATIBLE_PROVIDER_KEY),
    languageModel: { create: createCompatibleResponsesLanguageModel },
    image: { describe: describeCompatibleImage, execute: executeCompatibleImage },
  },
  apiConfig: {
    visibility: 'visible',
    name: 'Custom API',
    editableBaseUrl: true,
    modelTypes: ['llm', 'image'],
  },
  customLlm: {
    protocol: 'openai-responses',
    publicReasoningMode: 'none',
    codexRuntimeWireApi: 'responses',
  },
  platformCredentials: { envPrefix: 'PLATFORM_OPENAI_COMPATIBLE', requiresBaseUrl: true },
  mediaInputs: [
    { modality: 'vision', transports: { image: ['public-https', 'inline-data-url'] } },
    { modality: 'image', transports: { image: ['public-https', 'inline-data-url'] } },
  ],
  catalogs: { capabilities: [], pricing: [], apiConfigModels: [], platformModels: [] },
})
