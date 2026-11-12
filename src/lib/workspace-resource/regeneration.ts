import type { WorkspaceResourceJsonObject, WorkspaceResourceJsonValue } from './contracts'

/**
 * "Run again" contract shared by the server projection and the Canvas editor.
 *
 * The server projects one complete, schema-valid `create_image` /
 * `create_video` batch input for a Resource (its frozen prompt, options,
 * references and duration). The editor never rebuilds that input: it reads
 * the editable facts out of the projected template and writes edits back into
 * the same JSON, so the Operation schema stays the only judge of the request.
 */

export const WORKSPACE_RESOURCE_REGENERATION_OPERATION_IDS = ['create_image', 'create_video'] as const

export type WorkspaceResourceRegenerationOperationId =
  (typeof WORKSPACE_RESOURCE_REGENERATION_OPERATION_IDS)[number]

export type WorkspaceResourceRegenerationReferenceChannel = 'context' | 'image' | 'audio' | 'video'

export interface WorkspaceResourceRegenerationReference {
  /** View-only immutable input metadata; never serialized into generation arguments. */
  readonly durationMs?: number | null
  readonly resourceId: string
  readonly contentVersion: number
  readonly role: string
  readonly channel: WorkspaceResourceRegenerationReferenceChannel
  readonly purpose?: 'identity' | 'scene' | 'continuity' | 'prop' | 'style'
}

export type WorkspaceResourceRegenerationParameters = Readonly<Record<string, string | number | boolean>>

export interface WorkspaceResourceRegenerationTemplate {
  readonly name: string
  readonly mediaType: 'image' | 'video'
  readonly prompt: string
  readonly aspectRatio: string | null
  /** Frozen provider parameters other than the frame (resolution, quality, audio). */
  readonly parameters: WorkspaceResourceRegenerationParameters
  readonly durationSeconds: number | null
  readonly references: readonly WorkspaceResourceRegenerationReference[]
}

export interface WorkspaceResourceRegenerationEdits {
  readonly name: string
  readonly prompt: string
  readonly aspectRatio: string | null
  readonly parameters: WorkspaceResourceRegenerationParameters
  readonly durationSeconds: number | null
  readonly references: readonly WorkspaceResourceRegenerationReference[]
}

const REFERENCE_CHANNELS: readonly WorkspaceResourceRegenerationReferenceChannel[] = ['context', 'image', 'audio', 'video']

function isJsonObject(value: WorkspaceResourceJsonValue | undefined): value is WorkspaceResourceJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isWorkspaceResourceRegenerationOperationId(
  value: string,
): value is WorkspaceResourceRegenerationOperationId {
  return WORKSPACE_RESOURCE_REGENERATION_OPERATION_IDS.some((candidate) => candidate === value)
}

function requireItem(input: WorkspaceResourceJsonObject): WorkspaceResourceJsonObject {
  const request = input.request
  if (!isJsonObject(request) || !Array.isArray(request.items) || request.items.length !== 1) {
    throw new Error('WORKSPACE_RESOURCE_REGENERATION_TEMPLATE_INVALID')
  }
  const item = request.items[0]
  if (!isJsonObject(item)) throw new Error('WORKSPACE_RESOURCE_REGENERATION_TEMPLATE_INVALID')
  return item
}

function readReference(value: WorkspaceResourceJsonValue): WorkspaceResourceRegenerationReference {
  if (!isJsonObject(value)) throw new Error('WORKSPACE_RESOURCE_REGENERATION_REFERENCE_INVALID')
  const { resourceId, contentVersion, role, channel } = value
  if (
    typeof resourceId !== 'string'
    || typeof contentVersion !== 'number'
    || typeof role !== 'string'
    || typeof channel !== 'string'
    || !REFERENCE_CHANNELS.some((candidate) => candidate === channel)
  ) {
    throw new Error('WORKSPACE_RESOURCE_REGENERATION_REFERENCE_INVALID')
  }
  return {
    resourceId,
    contentVersion,
    role,
    channel: channel as WorkspaceResourceRegenerationReferenceChannel,
    ...(typeof value.purpose === 'string' && ['identity', 'scene', 'continuity', 'prop', 'style'].includes(value.purpose)
      ? { purpose: value.purpose as WorkspaceResourceRegenerationReference['purpose'] } : {}),
  }
}

export function readWorkspaceResourceRegenerationTemplate(
  input: WorkspaceResourceJsonObject,
): WorkspaceResourceRegenerationTemplate {
  const item = requireItem(input)
  if (typeof item.name !== 'string') throw new Error('WORKSPACE_RESOURCE_REGENERATION_TEMPLATE_INVALID')
  const mediaType = item.mediaType
  if (mediaType !== 'image' && mediaType !== 'video') {
    throw new Error('WORKSPACE_RESOURCE_REGENERATION_TEMPLATE_INVALID')
  }
  if (typeof item.prompt !== 'string') throw new Error('WORKSPACE_RESOURCE_REGENERATION_TEMPLATE_INVALID')
  const options = isJsonObject(item.options) ? item.options : null
  const aspectRatio = typeof options?.aspectRatio === 'string' ? options.aspectRatio : null
  const parameters: Record<string, string | number | boolean> = {}
  for (const [field, value] of Object.entries(options ?? {})) {
    if (field === 'aspectRatio') continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') parameters[field] = value
  }
  const durationSeconds = typeof item.durationSeconds === 'number' ? item.durationSeconds : null
  const references = Array.isArray(item.references) ? item.references.map(readReference) : []
  return {
    name: item.name,
    mediaType,
    prompt: item.prompt,
    aspectRatio,
    parameters,
    durationSeconds,
    references,
  }
}

export function applyWorkspaceResourceRegenerationEdits(
  input: WorkspaceResourceJsonObject,
  edits: WorkspaceResourceRegenerationEdits,
  expectedConfigurationVersion: string | null,
): WorkspaceResourceJsonObject {
  if (!expectedConfigurationVersion) throw new Error('WORKSPACE_RESOURCE_REGENERATION_CONFIGURATION_REQUIRED')
  const template = readWorkspaceResourceRegenerationTemplate(input)
  const item = requireItem(input)
  const request = input.request as WorkspaceResourceJsonObject
  const options: Record<string, WorkspaceResourceJsonValue> = {}
  // Regeneration is a new output: historical frames cannot override the project.
  for (const [field, value] of Object.entries(edits.parameters)) {
    if (field !== 'aspectRatio') options[field] = value
  }
  const nextItem: Record<string, WorkspaceResourceJsonValue> = {
    ...item,
    name: edits.name.trim(),
    prompt: edits.prompt,
    references: edits.references.map((reference) => ({
      resourceId: reference.resourceId,
      contentVersion: reference.contentVersion,
      role: reference.role,
      channel: reference.channel,
      ...(reference.purpose ? { purpose: reference.purpose } : {}),
    })),
  }
  if (template.mediaType === 'image') {
    nextItem.referenceMode = edits.references.some((reference) => reference.channel === 'image') ? 'images' : 'text_only'
    // The editor's explicit list is authoritative; an old recipe must not
    // silently put a removed reference back into the next generation.
    delete nextItem.referencePlan
  }
  if (Object.keys(options).length > 0) nextItem.options = options
  else delete nextItem.options
  if (template.mediaType === 'video') {
    if (edits.durationSeconds === null) throw new Error('WORKSPACE_RESOURCE_REGENERATION_DURATION_REQUIRED')
    nextItem.durationSeconds = edits.durationSeconds
  }
  return {
    ...input,
    request: {
      ...request,
      expectedConfigurationVersion,
      items: [nextItem],
    },
  }
}
