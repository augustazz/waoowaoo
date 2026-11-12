import { z } from 'zod'
import { imageItemReferences } from './image-provenance'
import { generationAspectRatioSchema, generationReferenceSchema, type GenerationItem } from './generation-request'

/** User selections belong to one admitted canvas Turn, not model-authored tool arguments. */
export const canvasGenerationIntentSchema = z.object({
  mediaType: z.enum(['image', 'video']),
  folderPath: z.string().trim().min(1).max(512).nullable(),
  aspectRatio: generationAspectRatioSchema.nullable(),
  durationSeconds: z.number().int().positive().nullable(),
  parameters: z.object({
    resolution: z.string().min(1).optional(),
    quality: z.string().min(1).optional(),
    generateAudio: z.boolean().optional(),
  }).strict(),
  references: z.array(generationReferenceSchema).max(32),
}).strict().superRefine((intent, context) => {
  if (intent.mediaType === 'image' && (intent.durationSeconds !== null || intent.parameters.generateAudio !== undefined)) {
    context.addIssue({ code: 'custom', path: ['mediaType'], message: 'Image intent cannot contain video parameters.' })
  }
  if (intent.mediaType === 'video' && (intent.durationSeconds === null || intent.parameters.quality !== undefined)) {
    context.addIssue({ code: 'custom', path: ['durationSeconds'], message: 'Video intent requires duration and cannot contain image quality.' })
  }
})
export type CanvasGenerationIntent = z.infer<typeof canvasGenerationIntentSchema>

/** Project only original generation constraints from persisted Turn context. */
export const canvasGenerationRequestContextSchema = z.object({
  canvasGenerationIntent: canvasGenerationIntentSchema.optional(),
  expectedProductionConfigurationVersion: z.string().trim().min(1).max(128).optional(),
}).superRefine((context, parser) => {
  if (context.canvasGenerationIntent && !context.expectedProductionConfigurationVersion) {
    parser.addIssue({ code: 'custom', path: ['expectedProductionConfigurationVersion'], message: 'Canvas generation requires its observed production configuration version.' })
  }
})
export type CanvasGenerationRequestContext = z.infer<typeof canvasGenerationRequestContextSchema>

export function assertCanvasGenerationIntentMode(intent: CanvasGenerationIntent | undefined, mode: 'retry' | 'revise_failed'): void {
  if (intent) throw new z.ZodError([{ code: 'custom', path: ['request', 'kind'], message: `Canvas generation requires a new output; ${mode} cannot replace the requested creation. Use request.kind=new and preserve the canvas selections.` }])
}

/** Return schema-native corrections; never silently substitute user selections. */
export function assertCanvasGenerationIntentItems(intent: CanvasGenerationIntent | undefined, items: readonly GenerationItem[]): void {
  if (!intent) return
  const issues: z.core.$ZodIssue[] = []
  const issue = (path: (string | number)[], message: string) => issues.push({ code: 'custom', path, message })
  if (items.length !== 1 || items[0]?.count !== 1) issue(['items'], 'This canvas request requires exactly one item with count 1.')
  items.forEach((item, index) => {
    const path = ['items', index]
    if (item.mediaType !== intent.mediaType) issue([...path, 'mediaType'], `Preserve the canvas media type: ${intent.mediaType}.`)
    if ((item.folderPath ?? null) !== intent.folderPath) issue([...path, 'folderPath'], `Preserve the canvas destination: ${JSON.stringify(intent.folderPath)}.`)
    if (item.mediaType === 'image' && item.assetKind !== null) issue([...path, 'assetKind'], 'Canvas image requests are ordinary images: use assetKind null and a non-asset image schema; preserve the selected aspect ratio.')
    if (item.mediaType === 'video' && item.durationSeconds !== intent.durationSeconds) issue([...path, 'durationSeconds'], `Preserve the canvas duration: ${intent.durationSeconds}.`)
    const actual = item.mediaType === 'image' ? imageItemReferences(item) : item.references ?? []
    if (actual.length !== intent.references.length || intent.references.some((reference, position) => {
      const candidate = actual[position]
      return !candidate || reference.resourceId !== candidate.resourceId || reference.contentVersion !== candidate.contentVersion || reference.role !== candidate.role || reference.channel !== candidate.channel
    })) issue([...path, 'references'], `Preserve the ordered canvas references exactly: ${JSON.stringify(intent.references)}.`)
  })
  if (issues.length) throw new z.ZodError(issues)
}

export function assertCanvasGenerationIntentOptions(intent: CanvasGenerationIntent | undefined, options: Readonly<Record<string, unknown>>): void {
  if (!intent) return
  const expected = { ...intent.parameters, ...(intent.aspectRatio === null ? {} : { aspectRatio: intent.aspectRatio }) }
  const issues: z.core.$ZodIssue[] = []
  for (const [field, value] of Object.entries(expected)) {
    if (options[field] !== value) issues.push({ code: 'custom', path: ['items', 0, 'options', field], message: `Preserve the canvas selection ${field}=${JSON.stringify(value)}; do not omit or replace it.` })
  }
  if (issues.length) throw new z.ZodError(issues)
}
