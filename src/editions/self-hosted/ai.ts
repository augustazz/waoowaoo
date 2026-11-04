import type { EditionAiContract } from '@/lib/edition/contracts/ai'

export const editionAi = {
  readFixedParameters: () => ({}),
  providerManifests: [],
  providerManifestExtensions: [],
  apiConfig: {
    featuredProviderKeys: ['openai-compatible', 'ark'],
  },
} satisfies EditionAiContract
