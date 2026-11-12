'use client'

import { canvasGenerationFormIssues, canvasEditableParameters } from '../create/canvas-generation-form'
import { canvasReferenceIssue, type CanvasGenerationCapability } from '../create/canvas-draft'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { WorkspaceResourceInputSummary } from '@/lib/workspace-resource/contracts'
import type {
  WorkspaceResourceRegenerationEdits,
  WorkspaceResourceRegenerationParameters,
  WorkspaceResourceRegenerationReference,
  WorkspaceResourceRegenerationTemplate,
} from '@/lib/workspace-resource/regeneration'

function referenceKey(reference: WorkspaceResourceRegenerationReference): string {
  return `${reference.resourceId}:${String(reference.contentVersion)}:${reference.role}:${reference.channel}:${reference.purpose ?? ''}`
}

/**
 * Local edit state over a server-projected "run again" template. The caller
 * keys the owning component by Resource identity, so a new selection starts
 * from that Resource's frozen facts instead of carrying edits across cards.
 */
export function useWorkspaceNodeGenerationEdits(template: WorkspaceResourceRegenerationTemplate | null, capability: CanvasGenerationCapability | null, inputSummaries: readonly WorkspaceResourceInputSummary[], projectAspectRatio: string | null) {
  const t = useTranslations('projectWorkflow.canvas.workspace.details.editor')
  const [configurationVersion, setConfigurationVersion] = useState(capability?.view.configurationVersion ?? null)
  // Opening a card may precede the first capability response. Capture that
  // first version without treating initial loading as a configuration change;
  // later versions still require an explicit review and preserve user edits.
  if (configurationVersion === null && capability) {
    setConfigurationVersion(capability.view.configurationVersion)
  }
  const [prompt, setPrompt] = useState(template?.prompt ?? '')
  const templateName = template?.name
  const defaultName = useMemo(() => templateName ? t('newVersionName', {
    name: templateName.slice(0, 48),
    time: new Date().toISOString().replace('T', ' ').slice(0, 23),
  }) : '', [templateName, t])
  const [nameOverride, setName] = useState<string | null>(null)
  const name = nameOverride ?? defaultName
  const aspectRatio = projectAspectRatio
  const [durationSeconds, setDurationSeconds] = useState<number | null>(template?.durationSeconds ?? null)
  const [parameters, setParameters] = useState<WorkspaceResourceRegenerationParameters>(template?.parameters ?? {})
  const [references, setReferences] = useState<readonly WorkspaceResourceRegenerationReference[]>(() => (template?.references ?? []).map((reference) => ({ ...reference, durationMs: inputSummaries.find((input) => input.resourceId === reference.resourceId && input.contentVersion === reference.contentVersion)?.durationMs ?? null })))
  const setParameter = useCallback((field: string, value: string | number | boolean | undefined) => {
    setParameters((current) => {
      const next: Record<string, string | number | boolean> = { ...current }
      if (value === undefined) delete next[field]
      else next[field] = value
      return next
    })
  }, [])

  const removeReference = useCallback((reference: WorkspaceResourceRegenerationReference) => {
    const key = referenceKey(reference)
    setReferences((current) => current.filter((candidate) => referenceKey(candidate) !== key))
  }, [])
  const addReference = useCallback((reference: WorkspaceResourceRegenerationReference) => {
    const key = referenceKey(reference)
    setReferences((current) => (
      current.some((candidate) => referenceKey(candidate) === key) || canvasReferenceIssue(capability, [...current, reference]) ? current : [...current, reference]
    ))
  }, [capability])
  const hasReference = useCallback(
    (reference: WorkspaceResourceRegenerationReference) => references.some(
      (candidate) => referenceKey(candidate) === referenceKey(reference),
    ),
    [references],
  )

  const edits = useMemo<WorkspaceResourceRegenerationEdits>(() => ({
    name: name.trim(),
    prompt: prompt.trim(),
    aspectRatio,
    parameters: canvasEditableParameters(capability, parameters),
    durationSeconds,
    references,
  }), [aspectRatio, capability, durationSeconds, name, parameters, prompt, references])
  const issues = canvasGenerationFormIssues(capability, { ...edits, configurationVersion })
  const valid = template !== null && edits.name.length > 0 && edits.name !== template.name
    && edits.prompt.length > 0 && issues.length === 0
  const reviewConfiguration = () => {
    if (!capability) return
    setConfigurationVersion(capability.view.configurationVersion)
    setParameters(canvasEditableParameters(capability, parameters))
  }

  return {
    edits,
    configurationVersion,
    issues,
    reviewConfiguration,
    valid,
    prompt,
    setPrompt,
    name,
    setName,
    aspectRatio,
    durationSeconds,
    setDurationSeconds,
    parameters,
    setParameter,
    references,
    hasReference,
    removeReference,
    addReference,
  } as const
}
