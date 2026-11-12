'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import type { WorkspaceCanvasGenerationCapabilitiesView } from '@/lib/workspace-resource/canvas-generation-capabilities'
import type { WorkspaceAssistantTurnOutcomeView } from '../../workspace-assistant-focus'
import { resolveWorkspaceAssistantUserMessageId } from '../../components/workspace-assistant/workspace-assistant-command-receipt'
import { canvasGenerationFormIssues, canvasEditableParameters } from '../create/canvas-generation-form'
import type { WorkspaceAssistantDraftSubmitRequest } from '../contracts/workspace-canvas-interactions'
import {
  canvasDraftSourceKey,
  canvasReferenceRole,
  canvasDraftReferenceRoles,
  defaultCanvasDraftReferenceRole,
  type CanvasDraftComposition,
  type CanvasDraftMediaType,
  type CanvasDraftReference,
  type CanvasDraftReferenceCandidate,
  type CanvasDraftReferenceRole,
  type CanvasGenerationCapability,
} from '../create/canvas-draft'

export interface CanvasDraftPosition {
  readonly x: number
  readonly y: number
}

export type CanvasCreateDraft =
  | { readonly phase: 'menu'; readonly id: string; readonly position: CanvasDraftPosition }
  | {
      readonly phase: 'compose'
      readonly id: string
      readonly position: CanvasDraftPosition
      readonly composition: CanvasDraftComposition
    }
  | {
      readonly phase: 'submitted'
      readonly id: string
      readonly position: CanvasDraftPosition
      readonly mediaType: CanvasDraftMediaType
      readonly aspectRatio: string | null
      /** Deterministic identity of the user message this draft sent. */
      readonly sourceMessageId: string
      /** True once the Turn started by that message was seen in the assistant view. */
      readonly turnObserved: boolean
      readonly pinnedResourceIds: readonly string[]
    }

export type CanvasComposeDraft = Extract<CanvasCreateDraft, { phase: 'compose' }>
export type CanvasSubmittedDraft = Extract<CanvasCreateDraft, { phase: 'submitted' }>

/** The configured model's capability for one generation kind, or null when no model is configured. */
export function canvasGenerationCapabilityFor(
  capabilities: WorkspaceCanvasGenerationCapabilitiesView | null,
  mediaType: CanvasDraftMediaType,
  purpose: 'assistant' | 'manual' = 'assistant',
): CanvasGenerationCapability | null {
  if (!capabilities) return null
  if (mediaType === 'image') {
    const view = purpose === 'assistant' ? capabilities.assistantImage : capabilities.image
    return view ? { mediaType, view } : null
  }
  const view = purpose === 'assistant' ? capabilities.assistantVideo : capabilities.video
  return view ? { mediaType, view } : null
}

function resolveSubmittedDraftTransition(
  draft: CanvasSubmittedDraft,
  outcome: WorkspaceAssistantTurnOutcomeView | null,
  newResourceIds: readonly string[],
): CanvasSubmittedDraft | 'close' | null {
  if (!outcome) return draft.turnObserved ? 'close' : null
  if (newResourceIds.length > 0 || !draft.turnObserved) {
    return {
      ...draft,
      turnObserved: true,
      pinnedResourceIds: [...draft.pinnedResourceIds, ...newResourceIds],
    }
  }
  return outcome.terminal && outcome.resourceTargetIds.length === 0 ? 'close' : null
}

/**
 * Owner of the one Canvas draft (menu → compose → submitted). Every choice a
 * draft offers is bound to the configured model's capability View. Submission
 * goes through the assistant's single send authority; afterwards the draft
 * only waits for the Turn it started to reserve Resources, pins them at the
 * draft position, and retires once a pinned node is projected or the Turn
 * ends without producing anything.
 */
export function useCanvasCreateDraft(params: {
  readonly projectId: string
  readonly folderPath: string | null
  readonly projectAspectRatio: string | null
  readonly capabilities: WorkspaceCanvasGenerationCapabilitiesView | null
  readonly turnOutcomes: readonly WorkspaceAssistantTurnOutcomeView[]
  readonly projectedResourceIds: ReadonlySet<string>
  readonly buildMessage: (composition: CanvasDraftComposition) => string
  readonly submitToAssistant: (request: WorkspaceAssistantDraftSubmitRequest) => void
  readonly pinResources: (resourceIds: readonly string[], position: CanvasDraftPosition) => void
}) {
  const {
    projectId, folderPath, projectAspectRatio, capabilities, turnOutcomes, projectedResourceIds,
    buildMessage, submitToAssistant, pinResources,
  } = params
  const [storedDraft, setDraft] = useState<CanvasCreateDraft | null>(null)
  // Open drafts follow project changes immediately; submitted drafts keep their snapshot.
  const draft = useMemo(() => storedDraft?.phase === 'compose'
    ? { ...storedDraft, composition: { ...storedDraft.composition, aspectRatio: projectAspectRatio } }
    : storedDraft, [storedDraft, projectAspectRatio])
  const submittingRef = useRef<{ readonly draftId: string; readonly controller: AbortController } | null>(null)

  const close = useCallback((draftId?: string) => {
    if (draftId === undefined || submittingRef.current?.draftId === draftId) submittingRef.current?.controller.abort()
    setDraft((current) => (current && (draftId === undefined || current.id === draftId) ? null : current))
  }, [])

  const openMenu = useCallback((position: CanvasDraftPosition) => {
    submittingRef.current?.controller.abort()
    setDraft({ phase: 'menu', id: crypto.randomUUID(), position })
  }, [])

  const startCompose = useCallback((input: {
    readonly position: CanvasDraftPosition
    readonly mediaType: CanvasDraftMediaType
    readonly references?: readonly CanvasDraftReference[]
  }) => {
    submittingRef.current?.controller.abort()
    const capability = canvasGenerationCapabilityFor(capabilities, input.mediaType)
    setDraft({
      phase: 'compose',
      id: crypto.randomUUID(),
      position: input.position,
      composition: {
        mediaType: input.mediaType,
        configurationVersion: capability?.view.configurationVersion ?? null,
        durationSeconds: null,
        text: '',
        aspectRatio: projectAspectRatio,
        parameters: {},
        references: input.references ?? [],
      },
    })
  }, [capabilities, projectAspectRatio])

  const updateComposition = useCallback((patch: Partial<Omit<CanvasDraftComposition, 'mediaType' | 'references'>>) => {
    submittingRef.current?.controller.abort()
    setDraft((current) => (
      current?.phase === 'compose'
        ? { ...current, composition: { ...current.composition, ...patch } }
        : current
    ))
  }, [])

  const setParameter = useCallback((field: string, value: CapabilityValue | undefined) => {
    submittingRef.current?.controller.abort()
    setDraft((current) => {
      if (current?.phase !== 'compose') return current
      const parameters: Record<string, CapabilityValue> = { ...current.composition.parameters }
      if (value === undefined) delete parameters[field]
      else parameters[field] = value
      return { ...current, composition: { ...current.composition, parameters } }
    })
  }, [])

  const addReference = useCallback((reference: CanvasDraftReferenceCandidate): boolean => {
    submittingRef.current?.controller.abort()
    if (draft?.phase !== 'compose') return false
    const existing = draft.composition.references
    if (existing.some((candidate) => candidate.resourceId === reference.resourceId)) return false
    const role = defaultCanvasDraftReferenceRole(
      draft.composition.mediaType, reference.mediaType, existing.map(canvasReferenceRole),
      canvasGenerationCapabilityFor(capabilities, draft.composition.mediaType),
    )
    if (!role) return false
    setDraft({ ...draft, composition: { ...draft.composition, references: [...existing, { ...reference, role }] } })
    return true
  }, [capabilities, draft])

  const removeReference = useCallback((resourceId: string) => {
    submittingRef.current?.controller.abort()
    setDraft((current) => (
      current?.phase === 'compose'
        ? {
            ...current,
            composition: {
              ...current.composition,
              references: current.composition.references.filter((reference) => reference.resourceId !== resourceId),
            },
          }
        : current
    ))
  }, [])

  const setReferenceRole = useCallback((resourceId: string, role: CanvasDraftReferenceRole) => {
    submittingRef.current?.controller.abort()
    setDraft((current) => {
      if (current?.phase !== 'compose') return current
      const reference = current.composition.references.find((candidate) => candidate.resourceId === resourceId)
      if (!reference) return current
      const others = current.composition.references.filter((candidate) => candidate.resourceId !== resourceId)
      const capability = canvasGenerationCapabilityFor(capabilities, current.composition.mediaType)
      if (!canvasDraftReferenceRoles(current.composition.mediaType, reference.mediaType, capability, others.map(canvasReferenceRole)).includes(role)) return current
      return { ...current, composition: { ...current.composition, references: current.composition.references.map((candidate) => (
        candidate.resourceId === resourceId ? { ...candidate, role } : candidate
      )) } }
    })
  }, [capabilities])

  const reviewConfiguration = useCallback(() => {
    submittingRef.current?.controller.abort()
    setDraft((current) => {
      if (current?.phase !== 'compose') return current
      const capability = canvasGenerationCapabilityFor(capabilities, current.composition.mediaType)
      if (!capability) return current
      return { ...current, composition: { ...current.composition,
        configurationVersion: capability.view.configurationVersion,
        parameters: canvasEditableParameters(capability, current.composition.parameters),
      } }
    })
  }, [capabilities])

  const moveReference = useCallback((resourceId: string, direction: -1 | 1) => {
    submittingRef.current?.controller.abort()
    setDraft((current) => {
      if (current?.phase !== 'compose') return current
      const references = [...current.composition.references]
      const index = references.findIndex((reference) => reference.resourceId === resourceId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= references.length) return current
      ;[references[index], references[target]] = [references[target], references[index]]
      return { ...current, composition: { ...current.composition, references } }
    })
  }, [])

  const submit = useCallback(async () => {
    if (draft?.phase !== 'compose' || !draft.composition.text.trim()) return
    const capability = canvasGenerationCapabilityFor(capabilities, draft.composition.mediaType)
    if (!capability || submittingRef.current || canvasGenerationFormIssues(capability, { ...draft.composition, references: draft.composition.references.map(canvasReferenceRole) }).length > 0) return
    const draftId = draft.id
    const controller = new AbortController()
    submittingRef.current = { draftId, controller }
    const sourceKey = canvasDraftSourceKey(draftId)
    let sourceMessageId: string
    try {
      sourceMessageId = await resolveWorkspaceAssistantUserMessageId({
        scopeKey: projectId,
        sourceKey,
        immutableInput: null,
      })
    } finally {
      if (submittingRef.current?.controller === controller) submittingRef.current = null
    }
    if (controller.signal.aborted) return
    setDraft((current) => (
      current?.id === draftId && current.phase === 'compose'
        ? {
            phase: 'submitted',
            id: draftId,
            position: current.position,
            mediaType: current.composition.mediaType,
            aspectRatio: draft.composition.aspectRatio,
            sourceMessageId,
            turnObserved: false,
            pinnedResourceIds: [],
          }
        : current
    ))
    submitToAssistant({
      kind: 'submit',
      canvasGenerationIntent: {
        mediaType: draft.composition.mediaType,
        folderPath,
        aspectRatio: draft.composition.aspectRatio,
        durationSeconds: draft.composition.durationSeconds,
        parameters: draft.composition.parameters,
        references: draft.composition.references.map((reference) => ({
          resourceId: reference.resourceId, contentVersion: reference.contentVersion,
          role: reference.role, channel: canvasReferenceRole(reference).channel,
          ...(reference.purpose ? { purpose: reference.purpose } : {}),
        })),
      },
      expectedProductionConfigurationVersion: capability.view.configurationVersion,
      requestId: crypto.randomUUID(),
      sourceKey,
      text: buildMessage(draft.composition),
      imageReferences: draft.composition.references
        .filter((reference) => reference.mediaType === 'image')
        .map((reference) => ({ resourceId: reference.resourceId, previewUrl: reference.previewUrl })),
      onFailed: () => close(draftId),
    })
  }, [buildMessage, capabilities, close, draft, folderPath, projectId, submitToAssistant])

  // Link the submitted draft to the Turn its message started. Placement uses
  // the Turn's own Task targets; the draft retires when the Turn produced
  // nothing or vanished from the view after being seen.
  useEffect(() => {
    if (draft?.phase !== 'submitted') return
    const outcome = turnOutcomes.find((candidate) => candidate.sourceMessageId === draft.sourceMessageId) ?? null
    const newResourceIds = outcome
      ? outcome.resourceTargetIds.filter((id) => !draft.pinnedResourceIds.includes(id))
      : []
    if (newResourceIds.length > 0) pinResources(newResourceIds, draft.position)
    const transition = resolveSubmittedDraftTransition(draft, outcome, newResourceIds)
    if (transition === null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The assistant view is the external system; the draft records the Turn facts it delivers.
    setDraft((current) => (
      current?.id === draft.id ? (transition === 'close' ? null : transition) : current
    ))
  }, [draft, pinResources, turnOutcomes])

  useEffect(() => {
    if (draft?.phase !== 'submitted' || draft.pinnedResourceIds.length === 0) return
    if (!draft.pinnedResourceIds.some((resourceId) => projectedResourceIds.has(resourceId))) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The projected node replaces the placeholder; the draft retires in response to that external fact.
    close(draft.id)
  }, [close, draft, projectedResourceIds])

  return {
    draft,
    openMenu,
    startCompose,
    updateComposition,
    setParameter,
    reviewConfiguration,
    addReference,
    removeReference,
    setReferenceRole,
    moveReference,
    submit,
    close,
  } as const
}
