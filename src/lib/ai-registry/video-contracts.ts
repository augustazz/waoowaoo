import { z } from 'zod'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { logWarn } from '@/lib/logging/core'
import data from '../../../config/video-model-contracts.json'
import { validateModelCapabilities, type VideoCapabilities } from './types'
import { parseModelKeyStrict } from './selection'

export const videoRuleSchema = z.object({
  when: z.object({
    resolution: z.string().optional(),
    inputMode: z.enum(['text_to_video', 'first_frame', 'first_last_frame', 'reference']).optional(),
    generateAudio: z.boolean().optional(),
  }).strict(),
  durationOptions: z.array(z.number().int().positive().max(600)).min(1).optional(),
  maxReferenceImages: z.number().int().nonnegative().optional(),
  maxReferenceAudios: z.number().int().nonnegative().optional(),
  maxReferenceVideos: z.number().int().nonnegative().optional(),
  maxReferenceFiles: z.number().int().nonnegative().optional(),
}).strict()
export type VideoContractRule = z.infer<typeof videoRuleSchema>

const source = z.string().url().max(2048)
const capabilities = z.custom<VideoCapabilities>((value) => (
  !!value && typeof value === 'object' && !Array.isArray(value) && validateModelCapabilities('video', { video: value }).length === 0
), 'Invalid video capabilities')
const audio = z.object({
  output: z.enum(['native', 'silent', 'unknown']),
  control: z.enum(['toggle', 'unavailable']),
  default: z.enum(['on', 'off', 'unknown']),
}).strict()
const mediaSpec = z.object({
  mimeTypes: z.array(z.string().min(1)).min(1).optional(), maxBytes: z.number().int().positive().optional(),
  minWidth: z.number().int().positive().optional(), maxWidth: z.number().int().positive().optional(),
  minHeight: z.number().int().positive().optional(), maxHeight: z.number().int().positive().optional(),
}).strict()
const family = z.object({
  id: z.string().min(1).max(96), revision: z.number().int().positive(), source,
  aspectRatios: z.array(z.string().regex(/^\d+:\d+$/)).min(1),
  capabilities, audio, rules: z.array(videoRuleSchema).optional(),
  outputSizes: z.array(z.object({ resolution: z.string().min(1), aspectRatio: z.string().regex(/^\d+:\d+$/),
    width: z.number().int().positive(), height: z.number().int().positive() }).strict()).optional(),
  promptMaxChars: z.number().int().positive().max(100000).optional(),
  mediaSpecs: z.object({ image: mediaSpec.optional(), audio: mediaSpec.optional(), video: mediaSpec.optional() }).strict().optional(),
}).strict()
const binding = z.object({
  modelId: z.string().trim().min(1).max(160), family: z.string().min(1),
  resolutionOptions: z.array(z.string().min(1)).min(1),
}).strict()
const channel = z.object({
  id: z.string().min(1).max(96), revision: z.number().int().positive(), source,
  // Unknown protocols remain visible as unavailable, never fall through to JSON.
  protocol: z.string().min(1).max(96),
  baseUrl: z.string().url(),
  provider: z.string().regex(/^openai-compatible(?::[^:]+)?$/).optional(),
  models: z.array(binding).min(1),
}).strict()

export const videoContractCatalogSchema = z.object({
  schemaVersion: z.literal(1), families: z.array(family), channels: z.array(channel),
}).strict().superRefine((catalog, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message })
  for (const field of ['families', 'channels'] as const) {
    if (new Set(catalog[field].map((entry) => entry.id)).size !== catalog[field].length) error(`Duplicate ${field} ID`)
  }
  const identities = new Set<string>()
  for (const entry of catalog.families) {
    if (!entry.capabilities.supportedInputModes?.length || !entry.capabilities.durationOptions?.length) error(`Incomplete family ${entry.id}`)
    if (entry.audio.control === 'toggle' && entry.capabilities.generateAudioOptions?.length !== 2) error(`Audio toggle options missing: ${entry.id}`)
    if (entry.audio.control === 'unavailable' && (entry.capabilities.generateAudioOptions?.length ?? 0) > 0) error(`Audio control contradicts options: ${entry.id}`)
    if ((entry.audio.output === 'native') !== (entry.capabilities.supportGenerateAudio === true)) error(`Audio output contradicts capabilities: ${entry.id}`)
    if (entry.capabilities.durationOptions?.some((duration) => !Number.isInteger(duration) || duration < 1 || duration > 600)) error(`Invalid duration: ${entry.id}`)
    for (const spec of Object.values(entry.mediaSpecs ?? {})) {
      if (spec.minWidth && spec.maxWidth && spec.minWidth > spec.maxWidth) error(`Invalid width range: ${entry.id}`)
      if (spec.minHeight && spec.maxHeight && spec.minHeight > spec.maxHeight) error(`Invalid height range: ${entry.id}`)
    }
  }
  for (const entry of catalog.channels) {
    const url = new URL(entry.baseUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) error(`Invalid channel baseUrl: ${entry.id}`)
    for (const model of entry.models) {
      if (!catalog.families.some((candidate) => candidate.id === model.family)) error(`Unknown family: ${model.family}`)
      // A model may differ across explicit provider instances; a generic alias
      // must be unambiguous. Provider-specific entries take precedence.
      const identity = `${entry.provider ?? 'openai-compatible'}::${model.modelId}`
      if (identities.has(identity)) error(`Duplicate binding: ${identity}`)
      identities.add(identity)
    }
  }
})

export type VideoContractCatalog = z.infer<typeof videoContractCatalogSchema>
export type DeclaredVideoContract = {
  modelId: string; name: string; provider: string; aspectRatios: string[]
  capabilities: VideoCapabilities; rules: VideoContractRule[]
  protocol: string; baseUrl: string; revision: string; fingerprint: string
  source: string; audio: z.infer<typeof audio>
  outputSizes: NonNullable<z.infer<typeof family>['outputSizes']>
  promptMaxChars?: number
  mediaSpecs?: z.infer<typeof family>['mediaSpecs']
}

export function canonicalVideoContract(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalVideoContract).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalVideoContract(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function compileVideoContracts(raw: unknown): DeclaredVideoContract[] {
  const catalog = videoContractCatalogSchema.parse(raw)
  return catalog.channels.flatMap((entry) => entry.models.map((model) => {
    const spec = catalog.families.find((candidate) => candidate.id === model.family)!
    const contract = {
      modelId: model.modelId, name: model.modelId, provider: entry.provider ?? 'openai-compatible',
      aspectRatios: spec.aspectRatios,
      capabilities: { ...spec.capabilities, generateAudioOptions: spec.capabilities.generateAudioOptions ?? [], resolutionOptions: model.resolutionOptions },
      rules: spec.rules ?? [], protocol: entry.protocol, baseUrl: entry.baseUrl.replace(/\/+$/, ''),
      revision: `${entry.id}@${entry.revision}/${spec.id}@${spec.revision}`,
      source: spec.source, audio: spec.audio,
      outputSizes: spec.outputSizes ?? [],
      ...(spec.promptMaxChars ? { promptMaxChars: spec.promptMaxChars } : {}),
      ...(spec.mediaSpecs ? { mediaSpecs: spec.mediaSpecs } : {}),
    }
    return { ...contract, fingerprint: createHash('sha256').update(canonicalVideoContract(contract)).digest('hex') }
  }))
}

// Deployment bindings live in the shared data mount, never in a public image.
export const LOCAL_VIDEO_CONTRACT_CATALOG_PATH = path.resolve('data/config/video-model-contracts.json')

export function loadVideoContracts(localPath: string | null = LOCAL_VIDEO_CONTRACT_CATALOG_PATH): DeclaredVideoContract[] {
  const defaults = compileVideoContracts(data)
  if (!localPath) return defaults
  try {
    const raw = readFileSync(localPath, 'utf8')
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Catalog exceeds size limit')
    return compileVideoContracts(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Invalid deployment data disables its video bindings, not text/image
      // sessions. Never log the raw file, URLs, or validation payload.
      logWarn('LOCAL_VIDEO_CONTRACT_CATALOG_INVALID: deployment video bindings were not loaded')
    }
    return defaults
  }
}

// Tests exercise public/fixture data; developer deployment files must not change
// test outcomes. The loader itself is tested with explicit temporary paths.
export const DECLARED_VIDEO_CONTRACTS = loadVideoContracts(
  process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' ? null : LOCAL_VIDEO_CONTRACT_CATALOG_PATH,
)

export function resolveDeclaredVideoContract(modelKey: string, contracts = DECLARED_VIDEO_CONTRACTS): DeclaredVideoContract | undefined {
  const parsed = parseModelKeyStrict(modelKey)
  if (!parsed || parsed.provider.split(':')[0] !== 'openai-compatible') return undefined
  return contracts.find((entry) => entry.provider === parsed.provider && entry.modelId === parsed.modelId)
    ?? contracts.find((entry) => entry.provider === 'openai-compatible' && entry.modelId === parsed.modelId)
}

export function videoChannelUnavailableReason(contract: DeclaredVideoContract, baseUrl?: string): 'protocol_unsupported' | 'channel_mismatch' | null {
  if (contract.protocol !== 'json-videos-v1') return 'protocol_unsupported'
  return baseUrl?.replace(/\/+$/, '') === contract.baseUrl ? null : 'channel_mismatch'
}
