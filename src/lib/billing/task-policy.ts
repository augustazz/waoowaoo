import {
  calcImage,
  calcMusic,
  calcText,
  calcVideo,
  calcVoice,
} from './cost'
import { BUILTIN_PRICING_VERSION } from '@/lib/ai-registry/pricing-resolution'
import { toChargeableCredits } from './credits'
import { getBillingModeSync } from './mode'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { getTaskDefinition } from '@/lib/task/definition'
import type { TaskType } from '@/lib/task/types'
import type { TaskBillingInfo } from './types'
import { readImageRuntimeGenerationOptions } from '@/lib/image-generation/runtime-options'
import { musicCompositionPlanDurationMs } from '@/lib/music/composition-plan'
import { musicScoreGenerationOptionsSchema } from '@/lib/music/score-specification'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'

type AnyPayload = Record<string, unknown> | null | undefined

function toNumber(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function pickFirstString(values: unknown[]): string | null {
  for (const value of values) {
    const next = readString(value)
    if (next) return next
  }
  return null
}

function quoteTaskPricing(calculateCost: () => number) {
  // OFF disables the application's ledger. Keep model/quantity metadata for
  // approvals and execution, but do not require a platform price for user APIs.
  // SHADOW and ENFORCE must still resolve a real catalog price or fail.
  if (getBillingModeSync() === 'OFF') {
    return { maxFrozenCost: 0, status: 'skipped' as const }
  }
  return {
    maxFrozenCost: toChargeableCredits(calculateCost()),
    pricingVersion: BUILTIN_PRICING_VERSION,
    status: 'quoted' as const,
  }
}

function buildTextTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const inputTokens = Math.max(0, Math.floor(toNumber(payload?.maxInputTokens, 3000)))
  const model = pickFirstString([payload?.analysisModel, payload?.model])
  if (!model) return null

  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'text',
    model,
    quantity: inputTokens,
    unit: 'token',
    ...quoteTaskPricing(() => calcText(model, inputTokens, 0)),
    action: String(taskType),
    metadata: { inputTokens },
  }
}

function buildImageTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([payload?.imageModel, payload?.modelId, payload?.model])
  if (!model) return null
  const quantity = Math.max(1, Math.floor(toNumber(payload?.candidateCount ?? payload?.count, 1)))
  const generationOptions = readImageRuntimeGenerationOptions(payload?.generationOptions)
  const resolution = generationOptions.resolution
  const quality = generationOptions.quality
  const size = generationOptions.size
  const aspectRatio = generationOptions.aspectRatio
  const resource = payload?.protocol === 'workspace_resource_generation_v2'
    ? parseWorkspaceResourceGenerationTaskPayload(payload).resource
    : undefined
  const metadata = {
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resource ? { referenceImageCount: resource.imageInputPositions.length } : {}),
  }
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'image',
    model,
    quantity,
    unit: 'image',
    ...quoteTaskPricing(() => calcImage(model, quantity, metadata)),
    action: String(taskType),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

function buildVideoTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([
    payload?.videoModel,
    payload?.modelId,
    payload?.model,
  ])
  if (!model) return null
  const generationOptions = toRecord(payload?.generationOptions)
  const resolution = readString(generationOptions.resolution) || readString(payload?.resolution)
  const duration = readNumber(payload?.durationSeconds)
  const aspectRatio = readString(generationOptions.aspectRatio) || readString(payload?.aspectRatio)
  const generateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  const quantity = Math.max(1, Math.floor(toNumber(payload?.count, 1)))
  const resource = payload?.protocol === 'workspace_resource_generation_v2'
    ? parseWorkspaceResourceGenerationTaskPayload(payload).resource
    : undefined
  const metadata = {
    ...(resolution ? { resolution } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    generationMode: 'normal',
    ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
    ...(resource ? {
      referenceImageCount: resource.imageInputPositions.length,
      containsVideoInput: resource.videoInputPositions.length > 0,
      containsFirstFrame: resource.inputs.some((input) => (
        resource.imageInputPositions.includes(input.position) && input.role === 'first_frame'
      )),
    } : {}),
  }
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'video',
    model,
    quantity,
    unit: 'video',
    ...quoteTaskPricing(() => calcVideo(model, resolution || '720p', quantity, metadata)),
    action: String(taskType),
    metadata,
  }
}

function buildMusicTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([payload?.musicModel, payload?.modelId, payload?.model])
  if (!model) return null
  const specification = musicScoreGenerationOptionsSchema.safeParse(payload?.generationOptions)
  if (!specification.success) return null
  const durationSeconds = musicCompositionPlanDurationMs(
    specification.data.compositionPlan,
  ) / 1000
  const quantity = Math.max(1, Math.floor(toNumber(payload?.count, 1)))
  const metadata = {
    durationSeconds,
    generationMode: 'composition_plan',
    outputFormat: specification.data.outputFormat,
  }
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'music',
    model,
    quantity,
    unit: 'call',
    ...quoteTaskPricing(() => calcMusic(model, quantity, metadata)),
    action: String(taskType),
    metadata,
  }
}

function buildVoiceTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([payload?.voiceModel, payload?.modelId, payload?.model])
  const previewText = readString(payload?.previewText)
  if (!model || !previewText) return null
  const characters = Math.max(1, Array.from(previewText).length)
  const language = readString(payload?.language)
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'voice',
    model,
    quantity: characters,
    unit: 'character',
    ...quoteTaskPricing(() => calcVoice(model, characters)),
    action: String(taskType),
    metadata: {
      characters,
      ...(language ? { language } : {}),
    },
  }
}

export function isBillableTaskType(taskType: TaskType) {
  return getTaskDefinition(taskType).billingPolicy !== 'none'
}

export function buildDefaultTaskBillingInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  ensureAiCatalogsRegistered()
  const billingPolicy = getTaskDefinition(taskType).billingPolicy
  switch (billingPolicy) {
    case 'none':
      return null
    case 'image':
      return buildImageTaskInfo(taskType, payload)
    case 'video':
      return buildVideoTaskInfo(taskType, payload)
    case 'music':
      return buildMusicTaskInfo(taskType, payload)
    case 'voice':
      return buildVoiceTaskInfo(taskType, payload)
    case 'text':
      return buildTextTaskInfo(taskType, payload)
  }
  const exhaustive: never = billingPolicy
  throw new Error(`TASK_BILLING_POLICY_UNSUPPORTED:${String(exhaustive)}`)
}
