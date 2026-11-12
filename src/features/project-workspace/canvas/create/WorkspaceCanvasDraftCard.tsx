'use client'

import { CanvasDraftReferencePicker } from './CanvasDraftReferencePicker'
import { canvasReferenceRole } from './canvas-draft'
import { canvasGenerationFormIssues, canvasUsesAdaptiveFrame } from './canvas-generation-form'
import { GenerationReferenceLimits } from '../controls/GenerationReferenceLimits'
import { GenerationFormIssues } from '../controls/GenerationFormIssues'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { GenerationParameterFields } from '../controls/GenerationParameterFields'
import { LoadingSpinner, SELECTABLE_TEXT_CLASS } from '../nodes/renderers/renderer-shared'
import { resolveWorkspaceCanvasMediaShell } from '../node-presentation-profiles'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import type { CanvasComposeDraft, CanvasSubmittedDraft } from '../hooks/useCanvasCreateDraft'
import {
  canvasDraftReferenceRoles,
  type CanvasDraftMediaType,
  type CanvasDraftReference,
  type CanvasDraftReferenceRole,
  type CanvasDraftReferenceCandidate,
  type CanvasGenerationCapability,
} from './canvas-draft'

const COMPOSE_PANEL_WIDTH = 480
/** Card chrome around the media frame, matching the resource card shell. */
const FRAME_CHROME_WIDTH = 30
const FRAME_CHROME_HEIGHT = 58

const DRAFT_ICON: Readonly<Record<CanvasDraftMediaType, AppIconName>> = {
  image: 'image',
  video: 'video',
}

const REFERENCE_ICON: Readonly<Record<CanvasDraftReference['mediaType'], AppIconName>> = {
  image: 'image',
  video: 'video',
  audio: 'audioWave',
  text: 'fileText',
}

const DRAFT_SCHEMA: Readonly<Record<CanvasDraftMediaType, string>> = {
  image: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
  video: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
}

function DraftFrame({
  mediaType,
  aspectRatio,
  projectAspectRatio,
  title,
  children,
}: {
  readonly mediaType: CanvasDraftMediaType
  readonly aspectRatio: string | null
  readonly projectAspectRatio: string | null
  readonly title: string
  readonly children: ReactNode
}) {
  const shell = resolveWorkspaceCanvasMediaShell({
    kind: 'resourceCard',
    mediaType,
    schemaId: DRAFT_SCHEMA[mediaType],
    generationOptions: aspectRatio ? { aspectRatio } : null,
    projectAspectRatio,
  })
  return (
    <article
      className="rounded-[18px] border border-dashed border-slate-300 bg-white/72 backdrop-blur-xl transition-[width,height] duration-150"
      style={{ width: shell.width + FRAME_CHROME_WIDTH, height: shell.height + FRAME_CHROME_HEIGHT }}
    >
      <header className="flex min-h-[24px] items-center gap-2 px-3.5 pb-1.5 pt-2.5">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] bg-slate-100 text-[var(--glass-text-tertiary)]">
          <AppIcon name={DRAFT_ICON[mediaType]} className="h-3 w-3" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-[var(--glass-text-secondary)]">
          {title}
        </h2>
      </header>
      <div className="px-3.5 pb-3.5 pt-0.5">
        <div
          className="flex items-center justify-center overflow-hidden rounded-2xl bg-slate-100/80 text-[var(--glass-text-tertiary)]"
          style={{ width: shell.width, height: shell.height }}
        >
          {children}
        </div>
      </div>
    </article>
  )
}

function ReferenceChip({
  reference,
  references,
  draftMediaType,
  capability,
  disabled,
  onRemove,
  onChangeRole,
  onMove,
}: {
  readonly references: readonly CanvasDraftReference[]
  readonly reference: CanvasDraftReference
  readonly draftMediaType: CanvasDraftMediaType
  readonly capability: CanvasGenerationCapability | null
  readonly disabled: boolean
  readonly onRemove: () => void
  readonly onChangeRole: (role: CanvasDraftReferenceRole) => void
  readonly onMove?: (direction: -1 | 1) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.create')
  const roles = canvasDraftReferenceRoles(draftMediaType, reference.mediaType, capability, references.filter((other) => other.resourceId !== reference.resourceId).map(canvasReferenceRole))
  return (
    <li className="flex items-center gap-2 rounded-[12px] bg-white px-2 py-1.5 ring-1 ring-slate-200">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-slate-100 text-[var(--glass-text-tertiary)]">
        {reference.previewUrl && reference.mediaType === 'image' ? (
          // Protected server View URL, never a raw storage key.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reference.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : reference.previewUrl && reference.mediaType === 'video' ? (
          <video src={`${reference.previewUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <AppIcon name={REFERENCE_ICON[reference.mediaType]} className="h-4 w-4" />
        )}
      </span>
      <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-xs font-medium text-[var(--glass-text-primary)]`} title={reference.name}>
        {references.indexOf(reference) + 1}. {reference.name} · v{reference.contentVersion}
        {reference.purpose ? <span className="ml-1 text-[10px] text-slate-500">{t(`referencePurpose.${reference.purpose}`)}</span> : null}
      </span>
      {onMove ? <span className="flex gap-1">
        <button type="button" disabled={disabled || references.indexOf(reference) === 0} onClick={() => onMove(-1)} aria-label={t('moveReferenceUp')} className="text-xs disabled:opacity-30">↑</button>
        <button type="button" disabled={disabled || references.indexOf(reference) === references.length - 1} onClick={() => onMove(1)} aria-label={t('moveReferenceDown')} className="text-xs disabled:opacity-30">↓</button>
      </span> : null}
      {roles.length > 0 && (roles.length > 1 || !roles.includes(reference.role)) ? (
        <select
          value={roles.includes(reference.role) ? reference.role : ''}
          disabled={disabled}
          aria-label={t('referenceRoleLabel')}
          className="nodrag h-7 rounded-[8px] border border-slate-200 bg-white px-1.5 text-[11px] text-[var(--glass-text-secondary)] outline-none focus:border-slate-400"
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => onChangeRole(event.target.value as CanvasDraftReferenceRole)}
        >
          <option value="" disabled>{t('parameterRequired')}</option>
          {roles.map((role) => (
            <option key={role} value={role}>{t(`referenceRole.${role}`)}</option>
          ))}
        </select>
      ) : (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-[var(--glass-text-tertiary)]">
          {t(`referenceRole.${reference.role}`)}
        </span>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label={t('removeReference', { name: reference.name })}
        title={t('removeReference', { name: reference.name })}
        className="nodrag inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--glass-text-tertiary)] transition hover:bg-slate-100 hover:text-[var(--glass-text-primary)] disabled:opacity-50"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <AppIcon name="close" className="h-3 w-3" />
      </button>
    </li>
  )
}

/**
 * The in-place draft at the double-clicked position: a placeholder card the
 * size of the future result, with the brief panel below it. Only what the
 * user alone can decide lives here (what, references); the assistant
 * writes the final prompt and the plan approval shows the cost.
 */
export function WorkspaceCanvasDraftCard({
  draft,
  projectId,
  folderPath,
  onAddReference,
  onUploadedReference,
  projectAspectRatio,
  capability,
  capabilitiesLoading,
  capabilitiesFailed,
  dropTargetRef,
  dropHighlighted,
  onChangeText,
  onChangeDuration,
  onReviewConfiguration,
  onChangeParameter,
  onRemoveReference,
  onChangeReferenceRole,
  onMoveReference,
  onSubmit,
  onClose,
}: {
  readonly projectId: string
  readonly folderPath: string | null
  readonly onAddReference: (candidate: CanvasDraftReferenceCandidate) => boolean
  readonly onUploadedReference: (resourceId: string, reused: boolean) => void
  readonly draft: CanvasComposeDraft | CanvasSubmittedDraft
  readonly projectAspectRatio: string | null
  /** Configured model capability for this draft's kind; null means no model is configured. */
  readonly capability: CanvasGenerationCapability | null
  readonly capabilitiesLoading: boolean
  readonly capabilitiesFailed: boolean
  /** The reference section is the drop target for "use as reference" drags. */
  readonly dropTargetRef: RefObject<HTMLDivElement | null>
  readonly dropHighlighted: boolean
  readonly onChangeText: (text: string) => void
  readonly onChangeDuration: (seconds: number) => void
  readonly onReviewConfiguration: () => void
  readonly onChangeParameter: (field: string, value: CapabilityValue | undefined) => void
  readonly onRemoveReference: (resourceId: string) => void
  readonly onChangeReferenceRole: (resourceId: string, role: CanvasDraftReferenceRole) => void
  readonly onMoveReference?: (resourceId: string, direction: -1 | 1) => void
  readonly onSubmit: () => void
  readonly onClose: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.create')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [referencesBusy, setReferencesBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const composing = draft.phase === 'compose'
  const mediaType = composing ? draft.composition.mediaType : draft.mediaType
  const aspectRatio = composing ? draft.composition.aspectRatio : draft.aspectRatio
  const modelReady = capability !== null
  const referenceRoles = composing ? draft.composition.references.map(canvasReferenceRole) : []
  const issues = composing ? canvasGenerationFormIssues(capability, { ...draft.composition, references: referenceRoles }) : []
  const adaptiveFrame = canvasUsesAdaptiveFrame(capability, referenceRoles)
  const durations = capability?.mediaType === 'video' ? capability.view.durationsSeconds : []
  const frameWidth = resolveWorkspaceCanvasMediaShell({
    kind: 'resourceCard',
    mediaType,
    schemaId: DRAFT_SCHEMA[mediaType],
    generationOptions: aspectRatio ? { aspectRatio } : null,
    projectAspectRatio,
  }).width + FRAME_CHROME_WIDTH

  // The draft stays open while the user selects cards to reference; only
  // Escape, Cancel or submitting closes it.
  useEffect(() => {
    if (composing) textareaRef.current?.focus()
  }, [composing])

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !composing) return
    event.stopPropagation()
    onClose()
  }
  const canSubmit = composing && !referencesBusy && modelReady && issues.length === 0 && draft.composition.text.trim().length > 0

  return (
    <div
      className="nodrag nopan pointer-events-auto absolute"
      style={{ transform: `translate(${draft.position.x}px, ${draft.position.y}px)`, width: frameWidth, zIndex: 50 }}
      data-canvas-draft-id={draft.id}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={closeOnEscape}
    >
      <DraftFrame
        mediaType={mediaType}
        aspectRatio={aspectRatio}
        projectAspectRatio={projectAspectRatio}
        title={t(`draftTitle.${mediaType}`)}
      >
        {composing ? (
          <span className="flex flex-col items-center gap-1.5 px-4 text-center">
            <AppIcon name={DRAFT_ICON[mediaType]} className="h-6 w-6" />
            <span className="text-[11px]">{t('frameHint')}</span>
          </span>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4 text-center">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--glass-text-secondary)]">
              <LoadingSpinner />
              <span>{t('submitted')}</span>
            </span>
            <span className="text-[11px]">{t('submittedHint')}</span>
          </span>
        )}
      </DraftFrame>

      {composing ? (
        <section
          className={`mt-3 space-y-3 rounded-[20px] border bg-white/96 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-colors ${dropHighlighted ? 'border-slate-500' : 'border-slate-200'}`}
          style={{ width: COMPOSE_PANEL_WIDTH, marginLeft: (frameWidth - COMPOSE_PANEL_WIDTH) / 2 }}
        >
          <textarea
            ref={textareaRef}
            {...workspaceCanvasScrollableRegionProps<HTMLTextAreaElement>()}
            value={draft.composition.text}
            rows={3}
            placeholder={t(`briefPlaceholder.${mediaType}`)}
            aria-label={t(`briefPlaceholder.${mediaType}`)}
            className="nodrag nowheel max-h-40 min-h-[4.5rem] w-full resize-y rounded-[12px] border border-transparent bg-slate-50 px-3 py-2.5 text-sm leading-6 text-[var(--glass-text-primary)] outline-none transition placeholder:text-[var(--glass-text-tertiary)] focus:border-slate-300 focus:bg-white"
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => onChangeText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault()
                onSubmit()
              }
            }}
          />

          {!modelReady ? (
            <p className="rounded-[12px] bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-[11px] leading-4 text-[var(--glass-tone-danger-fg)]">
              {capabilitiesLoading
                ? t('capabilitiesLoading')
                : capabilitiesFailed
                  ? t('capabilitiesFailed')
                  : t(`modelMissing.${mediaType}`)}
            </p>
          ) : null}
          {!adaptiveFrame && aspectRatio ? (
            <p className="text-[11px] text-[var(--glass-text-tertiary)]">
              {t('projectAspectRatio', { ratio: aspectRatio })}
            </p>
          ) : null}
          {adaptiveFrame ? <p className="text-xs text-slate-500">{t('adaptiveFrame')}</p> : null}
          {capability?.mediaType === 'video' && capability.view.pricingLimited ? <p className="text-[11px] text-slate-500">{t('pricingLimited')}</p> : null}
          {mediaType === 'video' && durations.length > 0 ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              {t('duration')}
              <select className="nodrag h-8 rounded-lg border border-slate-200 bg-white px-2" value={draft.composition.durationSeconds !== null && durations.includes(draft.composition.durationSeconds) ? draft.composition.durationSeconds : ''}
                onChange={(event) => onChangeDuration(Number(event.target.value))}>
                <option value="" disabled>{t('parameterRequired')}</option>
                {durations.map((seconds) => <option key={seconds} value={seconds}>{t('durationSeconds', { seconds })}</option>)}
              </select>
            </label>
          ) : null}

          <div ref={dropTargetRef} className={dropHighlighted ? 'rounded-xl ring-2 ring-slate-400' : undefined}>
            <p className="text-[11px] font-medium text-[var(--glass-text-secondary)]">{t('references')}</p>
            <GenerationReferenceLimits capability={capability} />
            {draft.composition.references.length > 0 ? (
              <ul className="mt-1.5 space-y-1.5">
                {draft.composition.references.map((reference) => (
                  <ReferenceChip
                    key={reference.resourceId}
                    reference={reference}
                    references={draft.composition.references}
                    draftMediaType={mediaType}
                    capability={capability}
                    disabled={false}
                    onRemove={() => onRemoveReference(reference.resourceId)}
                    onChangeRole={(role) => onChangeReferenceRole(reference.resourceId, role)}
                    onMove={onMoveReference ? (direction) => onMoveReference(reference.resourceId, direction) : undefined}
                  />
                ))}
              </ul>
            ) : null}
            <CanvasDraftReferencePicker
              projectId={projectId}
              folderPath={folderPath}
              capability={capability}
              references={draft.composition.references}
              onAdd={onAddReference}
              onUploaded={onUploadedReference}
              onBusyChange={setReferencesBusy}
            />
          </div>

          {capability && capability.view.parameters.length > 0 ? (
            <div>
              <button
                type="button"
                className="nodrag inline-flex items-center gap-1 text-[11px] font-medium text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                <AppIcon name={advancedOpen ? 'chevronDown' : 'chevronRight'} className="h-3 w-3" />
                {t('advanced')}
              </button>
              {advancedOpen ? (
                <div className="mt-2">
                  <GenerationParameterFields
                    parameters={capability.view.parameters}
                    values={draft.composition.parameters}
                    disabled={false}
                    onChange={onChangeParameter}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <GenerationFormIssues issues={issues} onReviewConfiguration={onReviewConfiguration} />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="glass-btn-base glass-btn-secondary px-3 py-1.5 text-xs"
              onClick={onClose}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              className="glass-btn-base glass-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              onClick={onSubmit}
            >
              <AppIcon name="sparkles" className="h-3.5 w-3.5" />
              {t('submit')}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
