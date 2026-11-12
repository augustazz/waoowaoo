import { z } from 'zod'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'
import { resolveAssetImageKindForSchemaId } from '@/lib/asset-generation'
import type { WorkspaceResourceJsonObject, WorkspaceResourceJsonValue, WorkspaceResourceMediaType } from './contracts'
import { workspaceResourceParentPath } from './contracts'
import {
  imageGenerationItemSchema,
  videoGenerationItemSchema,
} from './generation-request'
import { workspaceResourceDisplayName } from './path'
import {
  type WorkspaceResourceRegenerationOperationId,
} from './regeneration'
import { WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA } from './schema-registry'
import { readImageProvenance } from './image-provenance'
import { projectOrderedReferenceInputs, type ReferenceProjectionInput } from './reference-projection'

export interface WorkspaceResourceRegenerationSource {
  readonly resourceId: string
  readonly workspacePath: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly schemaId: string
  readonly status: string
  readonly workflowEnabled?: boolean
  /** Version the editable next-generation prompt was prepared from. */
  readonly currentVersion?: number
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly generationOptions: WorkspaceResourceJsonValue | null
  readonly inputs: readonly ReferenceProjectionInput[]
  /** The frozen Task payload of the last generation attempt, when one exists. */
  readonly taskPayload: unknown
}

export interface WorkspaceResourceRegenerationAction {
  readonly operationId: WorkspaceResourceRegenerationOperationId
  readonly input: WorkspaceResourceJsonObject
}

const frozenVideoDurationSchema = z.object({
  durationSeconds: z.number().int().positive(),
}).loose()

function isJsonObject(value: WorkspaceResourceJsonValue | null | undefined): value is WorkspaceResourceJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function frozenString(options: WorkspaceResourceJsonObject | null, key: string): string | undefined {
  const value = options?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function frozenBoolean(options: WorkspaceResourceJsonObject | null, key: string): boolean | undefined {
  const value = options?.[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Projects the exact "run again" request for a generated image or video: the
 * frozen frame ratio, provider options, references and duration of
 * the Resource, expressed in the public batch schema of the same Operation
 * that produced it. An explicitly saved prompt draft for the current version
 * overrides the prompt for the next generation only; historical provenance
 * and failed-task retries retain the original prompt.
 * Returns null whenever the Resource cannot be re-run
 * through that Operation (uploads, pending Resources, retired schemas,
 * missing frozen facts), so the Canvas never offers an action the server
 * would reject.
 */
export function projectWorkspaceResourceRegenerationAction(
  source: WorkspaceResourceRegenerationSource,
): WorkspaceResourceRegenerationAction | null {
  const mediaType = source.mediaType
  if (source.workflowEnabled === false || source.inputs.some((input) => input.workflowEnabled === false)) return null
  if (mediaType !== 'image' && mediaType !== 'video') return null
  if (source.status === 'pending') return null
  const originalPrompt = source.prompt?.trim()
  if (!originalPrompt || !source.modelKey?.trim()) return null
  const mintable: readonly string[] = WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType]
  if (!mintable.includes(source.schemaId)) return null
  const options = isJsonObject(source.generationOptions) ? source.generationOptions : null
  const draft = isJsonObject(options?.regenerationDraft) ? options.regenerationDraft : null
  const prompt = draft?.schemaVersion === 1
    && typeof source.currentVersion === 'number'
    && source.currentVersion > 0
    && draft.sourceContentVersion === source.currentVersion
    && typeof draft.prompt === 'string'
    && draft.prompt.trim()
      ? draft.prompt.trim()
      : originalPrompt
  const frozenAspectRatio = frozenString(options, 'aspectRatio')
  const aspectRatio = frozenAspectRatio && Object.prototype.hasOwnProperty.call(ASPECT_RATIO_CONFIGS, frozenAspectRatio)
    ? frozenAspectRatio
    : undefined
  const references = projectOrderedReferenceInputs(source.inputs, source.taskPayload, source.generationOptions).map((input) => ({
    resourceId: input.resourceId,
    contentVersion: input.contentVersion,
    role: input.role,
    channel: input.channel,
    ...(input.purpose ? { purpose: input.purpose } : {}),
  }))
  const common = {
    itemId: source.resourceId,
    name: workspaceResourceDisplayName({ workspacePath: source.workspacePath, resourceId: source.resourceId }),
    folderPath: workspaceResourceParentPath(source.workspacePath),
    count: 1,
    schemaId: source.schemaId,
    prompt,
    references,
  }
  if (mediaType === 'image') {
    const assetKind = resolveAssetImageKindForSchemaId(source.schemaId)
    const provenance = readImageProvenance(source.generationOptions)
    const parsed = imageGenerationItemSchema.safeParse({
      ...common,
      mediaType: 'image',
      assetKind,
      ...(provenance?.asset ? {
        aliases: provenance.asset.aliases, stableDescription: provenance.asset.stableDescription,
        consumedByShots: provenance.asset.consumedByShots,
      } : {}),
      ...(provenance?.shotId ? { shotId: provenance.shotId } : {}),
      referenceMode: references.some((reference) => reference.channel === 'image') ? 'images' : 'text_only',
      options: {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(frozenString(options, 'resolution') ? { resolution: frozenString(options, 'resolution') } : {}),
        ...(frozenString(options, 'quality') ? { quality: frozenString(options, 'quality') } : {}),
      },
    })
    if (!parsed.success) return null
    return {
      operationId: 'create_image',
      input: { request: { kind: 'new', items: [parsed.data as unknown as WorkspaceResourceJsonValue] } },
    }
  }
  const frozenDuration = frozenVideoDurationSchema.safeParse(source.taskPayload)
  if (!frozenDuration.success) return null
  const parsed = videoGenerationItemSchema.safeParse({
    ...common,
    mediaType: 'video',
    durationSeconds: frozenDuration.data.durationSeconds,
    options: {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(frozenString(options, 'resolution') ? { resolution: frozenString(options, 'resolution') } : {}),
      ...(frozenBoolean(options, 'generateAudio') !== undefined
        ? { generateAudio: frozenBoolean(options, 'generateAudio') }
        : {}),
    },
  })
  if (!parsed.success) return null
  return {
    operationId: 'create_video',
    input: { request: { kind: 'new', items: [parsed.data as unknown as WorkspaceResourceJsonValue] } },
  }
}
