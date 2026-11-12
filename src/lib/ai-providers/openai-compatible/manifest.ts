import { defineAiProviderManifest } from '@/lib/ai-providers/manifest'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { OPENAI_COMPATIBLE_PROVIDER_KEY } from './config'
import { createCompatibleResponsesLanguageModel } from './language-model'
import { describeCompatibleImage, executeCompatibleImage } from './image'
import { describeCompatibleVideo, executeCompatibleVideo } from './video'
import { compatibleVideoAsyncTaskProvider } from './async-task'
import { COMPATIBLE_VIDEO_CAPABILITY_ENTRIES } from './video-models'
import { COMPATIBLE_IMAGE_CAPABILITY_ENTRIES } from './image-models'

export const openAiCompatibleProviderManifest = defineAiProviderManifest({
  providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
  adapter: {
    providerKey: OPENAI_COMPATIBLE_PROVIDER_KEY,
    failure: createAiProviderFailureAdapter(OPENAI_COMPATIBLE_PROVIDER_KEY),
    languageModel: { create: createCompatibleResponsesLanguageModel },
    image: { describe: describeCompatibleImage, execute: executeCompatibleImage },
    video: { describe: describeCompatibleVideo, execute: executeCompatibleVideo },
  },
  apiConfig: {
    visibility: 'visible',
    name: 'Custom API',
    editableBaseUrl: true,
    modelTypes: ['llm', 'image', 'video'],
  },
  customLlm: {
    protocol: 'openai-responses',
    publicReasoningMode: 'none',
    codexRuntimeWireApi: 'responses',
  },
  platformCredentials: { envPrefix: 'PLATFORM_OPENAI_COMPATIBLE', requiresBaseUrl: true },
  asyncTasks: [compatibleVideoAsyncTaskProvider],
  mediaInputs: [
    { modality: 'vision', transports: { image: ['public-https', 'inline-data-url'] } },
    { modality: 'image', transports: { image: ['public-https', 'inline-data-url'] } },
    { modality: 'video', transports: { image: ['public-https'], audio: ['public-https'], video: ['public-https'] } },
  ],
  catalogs: { capabilities: [...COMPATIBLE_IMAGE_CAPABILITY_ENTRIES, ...COMPATIBLE_VIDEO_CAPABILITY_ENTRIES], pricing: [], apiConfigModels: [], platformModels: [] },
})
