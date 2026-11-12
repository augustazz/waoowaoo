import { z } from 'zod'
import { readImageProvenance } from './image-provenance'
import type { WorkspaceResourceMediaType } from './contracts'
import type { WorkspaceResourceRegenerationReference } from './regeneration'

const frozenInputSchema = z.object({
  resourceId: z.string(), contentVersion: z.number(), role: z.string(), position: z.number(),
  channel: z.enum(['context', 'image', 'audio', 'video']).optional(),
  purpose: z.enum(['identity', 'scene', 'continuity', 'prop', 'style']).optional(),
}).passthrough()
const frozenInputsSchema = z.object({ resource: z.object({
  inputs: z.array(frozenInputSchema),
  imageInputPositions: z.array(z.number()), audioInputPositions: z.array(z.number()), videoInputPositions: z.array(z.number()),
}).passthrough() }).passthrough()

export interface ReferenceProjectionInput {
  readonly workflowEnabled?: boolean
  readonly resourceId: string
  readonly contentVersion: number
  readonly role: string
  readonly mediaType: WorkspaceResourceMediaType
  readonly position?: number
  readonly channel?: WorkspaceResourceRegenerationReference['channel']
  readonly purpose?: WorkspaceResourceRegenerationReference['purpose']
}

/** The provider channel is an execution fact, not the input file's MIME type.
 * Older Tasks carry it in their position arrays; newer ones also freeze it. */
export function projectOrderedReferenceInputs<T extends ReferenceProjectionInput>(
  inputs: readonly T[], taskPayload: unknown, generationOptions: unknown,
): Array<T & WorkspaceResourceRegenerationReference> {
  const frozen = frozenInputsSchema.safeParse(taskPayload)
  const resource = frozen.success ? frozen.data.resource : null
  const provenance = readImageProvenance(generationOptions)
  const identity = (ref: { resourceId: string; contentVersion: number; role: string }) => `${ref.resourceId}:${ref.contentVersion}:${ref.role}`
  const frozenByIdentity = new Map(resource?.inputs.map((reference) => [identity(reference), reference]))
  const plannedByIdentity = new Map(provenance?.references.map((reference, index) => [identity(reference), { ...reference, position: index }]))
  return inputs.map((input, index) => {
    const previous = frozenByIdentity.get(identity(input))
    const planned = plannedByIdentity.get(identity(input))
    const position = previous?.position ?? input.position ?? planned?.position ?? index
    const channel = previous ? (previous.channel ?? (resource!.imageInputPositions.includes(position) ? 'image'
      : resource!.audioInputPositions.includes(position) ? 'audio' : resource!.videoInputPositions.includes(position) ? 'video' : 'context'))
      : input.channel ?? planned?.channel ?? (input.mediaType === 'text' || input.role === 'context' ? 'context' : input.mediaType)
    const purpose = previous?.purpose ?? input.purpose ?? planned?.purpose
    return { ...input, position, channel, ...(purpose ? { purpose } : {}) }
  }).sort((a, b) => a.position - b.position)
}
