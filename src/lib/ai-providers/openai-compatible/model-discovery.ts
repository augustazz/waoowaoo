import type { UnifiedModelType } from '@/lib/ai-registry/types'

export interface DiscoveredProviderModel {
  videoAvailability?: import('@/lib/ai-registry/video-availability').VideoModelAvailability
  id: string
  name: string
  types: UnifiedModelType[]
  classification: 'metadata' | 'name' | 'unknown' | 'unsupported'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function tokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(tokens)
  return typeof value === 'string' ? value.toLowerCase().split(/[\s,+/]+/).filter(Boolean) : []
}

function classifyMetadata(model: Record<string, unknown>): UnifiedModelType[] {
  const architecture = record(model.architecture)
  const modality = typeof architecture?.modality === 'string' ? architecture.modality.split('->').at(-1) : undefined
  // Input image support means vision, not image generation. Only outputs classify generation models.
  const outputs = tokens(model.output_modalities ?? architecture?.output_modalities ?? modality)
  const declared = tokens(model.type ?? model.model_type ?? model.modality)
  const values = [...outputs, ...declared]
  if (values.some((value) => ['image', 'image-generation', 'text-to-image', 'image_generation'].includes(value))) return ['image']
  if (values.some((value) => ['video', 'video-generation', 'text-to-video', 'video_generation'].includes(value))) return ['video']
  if (values.some((value) => ['music', 'music-generation', 'music_generation'].includes(value))) return ['music']
  if (values.some((value) => ['voice', 'tts', 'speech', 'text-to-speech'].includes(value))) return ['voice']
  if (values.some((value) => ['llm', 'text', 'chat', 'language', 'text-generation', 'text_generation'].includes(value))) return ['llm']
  return []
}

function classifyName(id: string): UnifiedModelType[] {
  if (/(?:gpt-image|chatgpt-image|grok-imagine-image|dall-e|flux|imagen|stable-diffusion|sdxl|seedream|nano-banana|qwen-image|ideogram|hunyuan-image|gemini.*(?:image|banana))/i.test(id)) return ['image']
  if (/grok-imagine-video/i.test(id)) return ['video']
  if (/(?:seedance|TTseadanco)/i.test(id)) return ['video']
  if (/(?:^|[-_/.])(?:sora|veo|kling|wan|seedance|hailuo|runway)(?:[-_/.\d]|$)/i.test(id)) return ['video']
  if (/(?:^|[-_/.])(?:tts|speech|voice)(?:[-_/.\d]|$)/i.test(id)) return ['voice']
  if (/(?:^|[-_/.])(?:suno|udio|lyria|music)(?:[-_/.\d]|$)/i.test(id)) return ['music']
  if (/(?:^|[-_/.])(?:gpt|codex|claude|gemini|grok|qwen|deepseek|llama|mistral|glm|kimi|o[1-9])(?:[-_/.\d]|$)/i.test(id)) return ['llm']
  return []
}

export function normalizeDiscoveredProviderModels(payload: unknown): DiscoveredProviderModel[] {
  const root = record(payload)
  const entries = Array.isArray(payload) ? payload : root?.data ?? root?.models
  if (!Array.isArray(entries)) throw new Error('PROVIDER_MODEL_LIST_INVALID')
  const models = new Map<string, DiscoveredProviderModel>()
  for (const entry of entries) {
    const item = typeof entry === 'string' ? { id: entry } : record(entry)
    if (!item) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || id.length > 160 || models.has(id)) continue
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 256) : id
    const declared = classifyMetadata(item)
    const unsupported = /(?:embed|rerank|whisper|transcription|moderation)/i.test(`${item.type ?? ''} ${id}`)
    const inferred = declared.length || unsupported ? [] : classifyName(id)
    models.set(id, {
      id, name, types: unsupported ? [] : declared.length ? declared : inferred,
      classification: unsupported ? 'unsupported' : declared.length ? 'metadata' : inferred.length ? 'name' : 'unknown',
    })
  }
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name))
}
