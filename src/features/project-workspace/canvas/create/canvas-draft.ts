import { validateGenerationReferences, type GenerationReferenceRole } from '@/lib/ai-registry/generation-reference-policy'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import type {
  WorkspaceCanvasImageGenerationCapabilityView,
  WorkspaceCanvasVideoGenerationCapabilityView,
} from '@/lib/workspace-resource/canvas-generation-capabilities'
import type { WorkspaceResourceMediaType } from '@/lib/workspace-resource/contracts'
import type { WorkspaceResourceRegenerationReference } from '@/lib/workspace-resource/regeneration'
import type { WorkspaceResourceCardView } from '../contracts/workspace-canvas-interactions'

/**
 * A Canvas draft is pure UI state: what the user wants at a position on the
 * Canvas before the assistant turns it into a real generation. It never
 * becomes a node or a Resource by itself; the assistant's Operation does.
 * Every choice a draft offers is bound to the project's configured model
 * through the capability View; nothing here invents a default the model
 * would reject.
 */
export type CanvasDraftMediaType = 'image' | 'video'

export type CanvasDraftReferenceRole =
  | 'reference_image'
  | 'first_frame'
  | 'last_frame'
  | 'reference_video'
  | 'reference_audio'
  | 'context'

export interface CanvasDraftReference {
  readonly resourceId: string
  readonly contentVersion: number
  readonly name: string
  readonly workspacePath: string
  readonly mediaType: WorkspaceResourceMediaType
  readonly previewUrl: string | null
  readonly durationMs: number | null
  readonly role: CanvasDraftReferenceRole
  readonly purpose?: WorkspaceResourceRegenerationReference['purpose']
}

export type CanvasDraftReferenceCandidate = Omit<CanvasDraftReference, 'role'>

export type CanvasGenerationParameters = Readonly<Record<string, CapabilityValue>>

export interface CanvasDraftComposition {
  readonly mediaType: CanvasDraftMediaType
  readonly configurationVersion: string | null
  readonly durationSeconds: number | null
  readonly text: string
  readonly aspectRatio: string | null
  readonly parameters: CanvasGenerationParameters
  readonly references: readonly CanvasDraftReference[]
}

export type CanvasGenerationCapability =
  | { readonly mediaType: 'image'; readonly view: WorkspaceCanvasImageGenerationCapabilityView }
  | { readonly mediaType: 'video'; readonly view: WorkspaceCanvasVideoGenerationCapabilityView }

/** The reference facts of a projected resource card, ready to attach to a draft. */
export function canvasDraftReferenceCandidate(card: WorkspaceResourceCardView): CanvasDraftReferenceCandidate | null {
  const resource = card.resource
  if (resource.status !== 'ready' || resource.workflowEnabled === false) return null
  const summary = card.presentation.summary
  return {
    resourceId: resource.resourceId,
    contentVersion: resource.contentVersion,
    name: resource.name,
    workspacePath: resource.workspacePath,
    mediaType: resource.mediaType,
    previewUrl: summary.kind === 'media' ? summary.url : null,
    durationMs: summary.kind === 'media' ? summary.durationMs : null,
    ...(resource.schemaId === 'project.character_image' ? { purpose: 'identity' as const }
      : resource.schemaId === 'project.location_image' ? { purpose: 'scene' as const }
        : resource.schemaId === 'project.prop_image' ? { purpose: 'prop' as const } : {}),
  }
}

export function canvasReferenceRole(reference: Pick<CanvasDraftReference, 'mediaType' | 'role' | 'durationMs'>): GenerationReferenceRole {
  return { durationMs: reference.durationMs, role: reference.role, channel: reference.mediaType === 'text' ? 'context' : reference.mediaType }
}

export function canvasReferenceIssue(
  capability: CanvasGenerationCapability | null,
  references: readonly GenerationReferenceRole[],
) {
  if (!capability || capability.view.unavailableReason) return { code: 'MODEL_UNAVAILABLE', field: 'references' as const }
  const image = capability.view
  return validateGenerationReferences({
    mediaType: capability.mediaType,
    references,
    limits: capability.mediaType === 'video' ? capability.view : {
      maxReferenceImages: image.maxReferenceImages,
      maxReferenceAudios: 0, maxReferenceVideos: 0, maxReferenceFiles: image.maxReferenceImages,
      referenceAudioRequiresVisual: false, supportedInputModes: [],
    },
  })
}

/** Offer only roles that leave the complete reference set valid. */
export function canvasDraftReferenceRoles(
  draftMediaType: CanvasDraftMediaType,
  referenceMediaType: WorkspaceResourceMediaType,
  capability: CanvasGenerationCapability | null,
  existing: readonly GenerationReferenceRole[] = [],
): readonly CanvasDraftReferenceRole[] {
  if (!capability || capability.mediaType !== draftMediaType) return []
  const roles: readonly CanvasDraftReferenceRole[] = referenceMediaType === 'text' ? ['context']
    : referenceMediaType === 'image' ? draftMediaType === 'image' ? ['reference_image'] : ['first_frame', 'last_frame', 'reference_image']
      : referenceMediaType === 'video' ? ['reference_video'] : ['reference_audio']
  return roles.filter((role) => !canvasReferenceIssue(capability, [
    ...existing, { role, channel: referenceMediaType === 'text' ? 'context' : referenceMediaType },
  ]))
}

export function defaultCanvasDraftReferenceRole(
  draftMediaType: CanvasDraftMediaType,
  referenceMediaType: WorkspaceResourceMediaType,
  existing: readonly GenerationReferenceRole[],
  capability: CanvasGenerationCapability | null,
): CanvasDraftReferenceRole | null {
  return canvasDraftReferenceRoles(draftMediaType, referenceMediaType, capability, existing)[0] ?? null
}

/** The same role policy applied to a "run again" edit of a generated card. */
export function regenerationReferenceForCandidate(
  generationMediaType: CanvasDraftMediaType,
  candidate: CanvasDraftReferenceCandidate,
  existing: readonly WorkspaceResourceRegenerationReference[],
  capability: CanvasGenerationCapability | null,
): WorkspaceResourceRegenerationReference | null {
  const role = defaultCanvasDraftReferenceRole(
    generationMediaType,
    candidate.mediaType,
    existing,
    capability,
  )
  if (!role) return null
  return {
    resourceId: candidate.resourceId,
    contentVersion: candidate.contentVersion,
    durationMs: candidate.durationMs,
    role,
    channel: candidate.mediaType === 'text' ? 'context' : candidate.mediaType,
    ...(candidate.purpose ? { purpose: candidate.purpose } : {}),
  }
}

export function canvasDraftSourceKey(draftId: string): string {
  return `canvas-draft:${draftId}`
}

export type CanvasDraftMessageTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string

export function formatCanvasParameterValue(value: CapabilityValue, t: CanvasDraftMessageTranslator): string {
  if (typeof value === 'boolean') return t(value ? 'parameterValue.on' : 'parameterValue.off')
  return String(value)
}

/**
 * The user message a draft sends. It states the user's requirement, the
 * chosen frame, parameters and the attached references by name; the assistant
 * owns the final prompt. Image references travel as attachments, so the
 * message never carries Resource identities as text.
 */
export function buildCanvasDraftMessage(input: {
  readonly composition: CanvasDraftComposition
  readonly folderPath: string | null
  readonly projectAspectRatio?: string | null
  readonly t: CanvasDraftMessageTranslator
}): string {
  const { composition, folderPath, t } = input
  const brief = composition.text.trim()
  const lines: string[] = [
    t(composition.mediaType === 'image' ? 'message.imageIntro' : 'message.videoIntro', { brief }),
  ]
  if (composition.aspectRatio) lines.push(t(composition.aspectRatio === input.projectAspectRatio ? 'message.projectAspectRatio' : 'message.aspectRatio', { ratio: composition.aspectRatio }))
  for (const [field, value] of Object.entries(composition.parameters)) {
    lines.push(t('message.parameter', { field: t(`parameter.${field}`), value: formatCanvasParameterValue(value, t) }))
  }
  if (composition.mediaType === 'video' && composition.durationSeconds !== null) {
    lines.push(t('message.videoDuration', { seconds: composition.durationSeconds }))
  }
  lines.push(folderPath ? t('message.folder', { path: folderPath }) : t('message.folderRoot'))
  if (composition.references.length > 0) {
    lines.push(t('message.referencesTitle'))
    for (const reference of composition.references) {
      const role = reference.purpose ? `${t(`referenceRole.${reference.role}`)} / ${t(`referencePurpose.${reference.purpose}`)}` : t(`referenceRole.${reference.role}`)
      lines.push(reference.mediaType === 'image'
        ? t('message.referenceAttached', { role, name: reference.name })
        : t('message.referencePath', { role, name: reference.name, path: reference.workspacePath }))
    }
  }
  lines.push(t('message.promptOwnership'))
  return lines.join('\n')
}
