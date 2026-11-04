import { arkProviderManifest } from '@/lib/ai-providers/ark/manifest'
import { elevenLabsProviderManifest } from '@/lib/ai-providers/elevenlabs/manifest'
import { falProviderManifest } from '@/lib/ai-providers/fal/manifest'
import { googleProviderManifest } from '@/lib/ai-providers/google/manifest'
import { openAiProviderManifest } from '@/lib/ai-providers/openai/manifest'
import { openAiCompatibleProviderManifest } from '@/lib/ai-providers/openai-compatible/manifest'
import { openRouterProviderManifest } from '@/lib/ai-providers/openrouter/manifest'
import type { AiProviderManifest } from '@/lib/ai-providers/manifest'

export const CORE_AI_PROVIDER_MANIFESTS = [
  arkProviderManifest,
  elevenLabsProviderManifest,
  falProviderManifest,
  googleProviderManifest,
  openAiProviderManifest,
  openAiCompatibleProviderManifest,
  openRouterProviderManifest,
] as const satisfies readonly AiProviderManifest[]
