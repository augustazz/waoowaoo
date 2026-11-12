import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { generationReferenceSchema, imageReferencePlanSchema, type imageGenerationItemSchema, type imageReferencePurposeSchema } from './generation-request'

type ImageItem = z.infer<typeof imageGenerationItemSchema>
export type ImageReference = z.infer<typeof generationReferenceSchema>

export const imageProvenanceSchema = z.object({
  schemaVersion: z.literal(1),
  itemId: z.string(),
  asset: z.object({
    kind: z.enum(['character', 'location', 'prop']),
    aliases: z.array(z.string()),
    stableDescription: z.string().optional(),
    consumedByShots: z.array(z.string()),
  }).optional(),
  shotId: z.string().optional(),
  referenceMode: z.enum(['images', 'text_only']),
  references: z.array(generationReferenceSchema),
  referencePlan: imageReferencePlanSchema.optional(),
}).strict()

export function readImageProvenance(options: unknown): z.infer<typeof imageProvenanceSchema> | null {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null
  const parsed = imageProvenanceSchema.safeParse(Reflect.get(options, 'imageProvenance'))
  return parsed.success ? parsed.data : null
}

/** The recipe is already ordered by the author of the final Prompt. Do not
 * reorder, trim or guess references at the execution boundary. */
export function imageItemReferences(item: ImageItem): ImageReference[] {
  let references = item.references ?? []
  if (item.referencePlan) {
    if (item.shotId && item.shotId !== item.referencePlan.shotId) {
      throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_REFERENCE_PLAN_CONFLICT', field: 'shotId' })
    }
    const suppliedImages = references.filter((reference) => reference.channel === 'image')
    if (suppliedImages.length > 0 && JSON.stringify(suppliedImages) !== JSON.stringify(item.referencePlan.references)) {
      throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_REFERENCE_PLAN_CONFLICT', field: 'references' })
    }
    references = [...item.referencePlan.references, ...references.filter((reference) => reference.channel === 'context')]
    for (const [field, resource] of Object.entries({ creative_direction: item.referencePlan.direction, source_plan: item.referencePlan.sourcePlan })) {
      if (resource && !references.some((reference) => reference.resourceId === resource.resourceId && reference.contentVersion === resource.contentVersion && reference.channel === 'context')) {
        references.push({ ...resource, role: field, channel: 'context' })
      }
    }
  }
  const images = references.filter((reference) => reference.channel === 'image')
  if (item.referenceMode === 'text_only' && images.length > 0) {
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_REFERENCE_PLAN_CONFLICT', field: 'referenceMode' })
  }
  if (new Set(images.map((reference) => `${reference.resourceId}:${reference.contentVersion}`)).size !== images.length) {
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_REFERENCE_DUPLICATE', field: 'references' })
  }
  return references
}

export function imageProvenance(item: ImageItem, references: readonly ImageReference[]) {
  return imageProvenanceSchema.parse({
    schemaVersion: 1,
    itemId: item.itemId,
    ...(item.assetKind ? { asset: {
      kind: item.assetKind, aliases: item.aliases ?? [], ...(item.stableDescription ? { stableDescription: item.stableDescription } : {}),
      consumedByShots: item.consumedByShots ?? [],
    } } : {}),
    ...(item.shotId || item.referencePlan ? { shotId: item.shotId ?? item.referencePlan?.shotId } : {}),
    referenceMode: references.some((reference) => reference.channel === 'image') ? 'images' : 'text_only',
    references: [...references],
    ...(item.referencePlan ? { referencePlan: item.referencePlan } : {}),
  })
}

/** Only explicit shot bindings are eligible. Matching labels, latest images and
 * unselected alternatives must never establish a person's identity. */
export function recommendShotImageReferences(shotId: string, resources: readonly {
  resourceId: string; contentVersion: number; generationOptions: unknown
}[]): Array<Omit<ImageReference, 'role' | 'channel' | 'purpose'> & {
  role: 'reference_image'; channel: 'image'; purpose: z.infer<typeof imageReferencePurposeSchema>; stableDescription: string | null
}> {
  return resources.flatMap((resource) => {
    const provenance = readImageProvenance(resource.generationOptions)
    const asset = provenance?.asset
    if (!asset?.consumedByShots.includes(shotId)) return []
    const purpose = asset.kind === 'character' ? 'identity' as const : asset.kind === 'location' ? 'scene' as const : 'prop' as const
    return [{ resourceId: resource.resourceId, contentVersion: resource.contentVersion, role: 'reference_image' as const,
      channel: 'image' as const, purpose, stableDescription: asset.stableDescription ?? null }]
  }).sort((a, b) => {
    const priority = { identity: 0, scene: 1, prop: 2 }
    return priority[a.purpose] - priority[b.purpose] || a.resourceId.localeCompare(b.resourceId)
  })
}
