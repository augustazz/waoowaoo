'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import { useToast } from '@/contexts/ToastContext'
import {
  useWorkspaceResourceVersion,
  useWorkspaceResourceVersions,
  useWorkspaceResourceView,
} from '@/lib/query/hooks'
import { queryKeys } from '@/lib/query/keys'
import { requestOperationMutationWithError } from '@/lib/query/mutations/mutation-shared'
import {
  workspaceResourceContentText,
  type WorkspaceResourceContent,
  type WorkspaceResourceJsonValue,
  type WorkspaceResourceVersionDetailView,
  type WorkspaceResourceVersionSummaryView,
  type WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import { diffTextLines } from './diff-text'
import { parseScreenplayScenes, type ScreenplayLine, type ScreenplayScene } from './parse-screenplay'

type WorkbenchAction = 'review' | 'hook' | 'compress' | 'conflict' | 'ending' | 'rewrite'
type WorkbenchPanel = 'scenes' | 'versions'

interface ScreenplayDocument {
  readonly title: string
  readonly logline: string | null
  readonly synopsis: string | null
  readonly text: string
  readonly assumptions: readonly string[]
  readonly openQuestions: readonly string[]
  readonly sourceLabel: string | null
}

function asObject(value: WorkspaceResourceJsonValue | null | undefined): Record<string, WorkspaceResourceJsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringField(object: Record<string, WorkspaceResourceJsonValue> | null, key: string): string | null {
  const value = object?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringListField(object: Record<string, WorkspaceResourceJsonValue> | null, key: string): readonly string[] {
  const value = object?.[key]
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => (typeof entry === 'string' && entry.trim() ? [entry.trim()] : []))
}

function sourceLabel(content: WorkspaceResourceContent | null): string | null {
  if (content?.kind !== 'structured') return null
  const object = asObject(content.data)
  const source = asObject(object?.source ?? null)
  return stringField(source, 'label')
}

function readScreenplayDocument(
  resource: WorkspaceResourceView | undefined,
  content: WorkspaceResourceContent | null,
): ScreenplayDocument {
  const structured = content?.kind === 'structured' ? asObject(content.data) : null
  const fallbackText = workspaceResourceContentText(content) ?? ''
  return {
    title: stringField(structured, 'title') ?? resource?.name ?? '',
    logline: stringField(structured, 'logline'),
    synopsis: stringField(structured, 'synopsis'),
    text: stringField(structured, 'screenplayText') ?? fallbackText,
    assumptions: stringListField(structured, 'assumptions'),
    openQuestions: stringListField(structured, 'openQuestions'),
    sourceLabel: sourceLabel(content),
  }
}

function sceneLabel(scene: ScreenplayScene, fallback: string): string {
  return scene.heading ?? fallback
}

function formatVersionDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function versionPreviewText(version: WorkspaceResourceVersionSummaryView): string | null {
  if (!version.contentPreview) return null
  if (version.contentKind !== 'structured') return version.contentPreview
  // Structured previews are serialized JSON. Flatten them so the list shows
  // meaningful field values instead of two lines of indentation and braces.
  const flattened = version.contentPreview.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
  return flattened.length > 180 ? `${flattened.slice(0, 180)}…` : flattened
}

function ScreenplayLineView({ line }: { readonly line: ScreenplayLine }) {
  if (line.kind === 'blank') return <div className="h-3" aria-hidden="true" />
  if (line.kind === 'parenthetical') {
    return <p className="my-1 pl-6 text-[13px] italic leading-6 text-slate-500">{line.text}</p>
  }
  if (line.kind === 'dialogue') {
    return (
      <div className="my-1 flex gap-3 leading-7">
        <span className="w-20 shrink-0 text-right text-[13px] font-semibold text-slate-900">
          {line.character}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-[14px] text-slate-700">{line.text}</span>
      </div>
    )
  }
  return <p className="my-1.5 whitespace-pre-wrap text-[14px] leading-7 text-slate-700">{line.text}</p>
}

function SceneBody({
  scenes,
  bodyRef,
}: {
  readonly scenes: readonly ScreenplayScene[]
  readonly bodyRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={bodyRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-inner"
    >
      {scenes.map((scene) => (
        <section
          key={scene.index}
          data-scene-index={scene.index}
          className="scroll-mt-4 pb-6 last:pb-0"
        >
          {scene.heading ? (
            <h3 className="mb-2 border-b border-slate-100 pb-2 text-[13px] font-bold uppercase tracking-wide text-slate-900">
              {scene.heading}
            </h3>
          ) : null}
          {scene.lines.map((line, index) => (
            <ScreenplayLineView key={`${String(scene.index)}-${String(index)}`} line={line} />
          ))}
        </section>
      ))}
    </div>
  )
}

function MetaRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-slate-700">{value}</dd>
    </div>
  )
}

function MetaList({ label, values }: { readonly label: string; readonly values: readonly string[] }) {
  if (values.length === 0) return null
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">{label}</dt>
      <dd className="mt-1">
        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-6 text-slate-700">
          {values.map((value, index) => <li key={`${String(index)}-${value}`}>{value}</li>)}
        </ul>
      </dd>
    </div>
  )
}

function VersionList({
  versions,
  currentVersion,
  selectedVersion,
  loading,
  failed,
  emptyLabel,
  onSelect,
  onRetry,
}: {
  readonly versions: readonly WorkspaceResourceVersionSummaryView[]
  readonly currentVersion: number
  readonly selectedVersion: number | null
  readonly loading: boolean
  readonly failed: boolean
  readonly emptyLabel: string
  readonly onSelect: (version: number) => void
  readonly onRetry: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.scriptWorkbench')
  if (loading) {
    return <p className="px-2 py-3 text-xs text-[var(--glass-text-tertiary)]">{t('versionsLoading')}</p>
  }
  if (failed) {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-xs text-[var(--glass-text-secondary)]">
        <span>{t('versionsFailed')}</span>
        <button type="button" className="font-semibold" onClick={onRetry}>{t('retry')}</button>
      </div>
    )
  }
  if (versions.length === 0) {
    return <p className="px-2 py-3 text-xs text-[var(--glass-text-tertiary)]">{emptyLabel}</p>
  }
  return (
    <ol className="space-y-1">
      {versions.map((version) => (
        <li key={version.version}>
          <button
            type="button"
            className={`w-full rounded-lg px-2 py-2 text-left text-[12px] transition ${
              selectedVersion === version.version
                ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:bg-white/70'
            }`}
            onClick={() => onSelect(version.version)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="tabular-nums">{t('version', { version: version.version })}</span>
              {version.version === currentVersion ? (
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  {t('current')}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[10px] text-slate-400">{formatVersionDate(version.createdAt)}</span>
            {versionPreviewText(version) ? (
              <span className="mt-1 block max-h-8 overflow-hidden text-[10px] leading-4 text-slate-400">
                {versionPreviewText(version)}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ol>
  )
}

function ScreenplayDiff({
  before,
  after,
  fromVersion,
  toVersion,
}: {
  readonly before: string
  readonly after: string
  readonly fromVersion: number
  readonly toVersion: number
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.scriptWorkbench')
  const result = useMemo(() => diffTextLines(before, after), [before, after])
  const listRef = useRef<HTMLDivElement | null>(null)
  const firstChangeIndex = result.supported
    ? result.lines.findIndex((line) => line.kind !== 'same')
    : -1

  useEffect(() => {
    if (!result.supported || firstChangeIndex < 0) return
    const container = listRef.current
    if (!container) return
    const row = container.querySelector<HTMLElement>(`[data-diff-index="${String(firstChangeIndex)}"]`)
    if (!row) return
    const top = row.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop
    container.scrollTop = Math.max(0, top - 24)
  }, [result, firstChangeIndex])

  if (!result.supported) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-2xl bg-slate-50 px-6 text-center text-sm text-[var(--glass-text-tertiary)]">
        {t('diffTooLarge')}
      </div>
    )
  }

  const changed = firstChangeIndex >= 0
  const addedCount = result.lines.reduce((total, line) => total + (line.kind === 'added' ? 1 : 0), 0)
  const removedCount = result.lines.reduce((total, line) => total + (line.kind === 'removed' ? 1 : 0), 0)
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className="text-xs font-semibold text-slate-700">
          {t('diffTitle', { from: fromVersion, to: toVersion })}
        </span>
        <span className="flex items-center gap-3 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-emerald-200" />
            {t('diffAdded')}
            <span className="tabular-nums font-semibold text-emerald-700">{addedCount}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-rose-200" />
            {t('diffRemoved')}
            <span className="tabular-nums font-semibold text-rose-700">{removedCount}</span>
          </span>
        </span>
      </div>
      {changed ? (
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
          {result.lines.map((line, index) => (
            <div
              key={`${line.kind}-${String(line.oldLine ?? 'x')}-${String(line.newLine ?? 'x')}-${String(index)}`}
              data-diff-index={index}
              className={
                line.kind === 'added'
                  ? 'bg-emerald-50/70 text-emerald-900'
                  : line.kind === 'removed'
                    ? 'bg-rose-50/70 text-rose-900'
                    : 'text-slate-600'
              }
            >
              <div className="grid grid-cols-[2.5rem_2.5rem_minmax(0,1fr)]">
                <span className={`select-none px-2 text-right text-[10px] ${
                  line.kind === 'added' ? 'text-emerald-400' : line.kind === 'removed' ? 'text-rose-400' : 'text-slate-300'
                }`}>
                  {line.oldLine ?? ''}
                </span>
                <span className={`select-none border-r border-slate-100 px-2 text-right text-[10px] ${
                  line.kind === 'added' ? 'text-emerald-400' : line.kind === 'removed' ? 'text-rose-400' : 'text-slate-300'
                }`}>
                  {line.newLine ?? ''}
                </span>
                <span className="flex min-w-0 gap-1 px-2 py-0.5">
                  <span className="w-3 shrink-0 select-none">
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : '\u00A0'}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{line.text || '\u00A0'}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-slate-50 text-sm text-[var(--glass-text-tertiary)]">
          {t('diffEmpty')}
        </div>
      )}
    </div>
  )
}

export function ScreenplayWorkbench({
  resourceId,
  onClose,
  onAssistantDraft,
}: {
  readonly resourceId: string
  readonly onClose: () => void
  readonly onAssistantDraft: (text: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.scriptWorkbench')
  const { projectId } = useWorkspaceProvider()
  const { showError, showToast } = useToast()
  const queryClient = useQueryClient()
  const contentQuery = useWorkspaceResourceView({ projectId, resourceId })
  const currentContent = contentQuery.data?.current?.content ?? null
  const screenplay = readScreenplayDocument(contentQuery.data, currentContent)
  const currentVersion = contentQuery.data?.contentVersion ?? 0
  const schemaId = contentQuery.data?.schemaId ?? ''
  const canEdit = schemaId === WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY
    && currentContent?.kind === 'structured'
  const workspacePath = contentQuery.data?.workspacePath ?? ''

  const [panel, setPanel] = useState<WorkbenchPanel>('scenes')
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeSceneIndex, setActiveSceneIndex] = useState(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const versionsQuery = useWorkspaceResourceVersions({
    projectId,
    resourceId,
    enabled: panel === 'versions',
  })
  const selectedVersionQuery = useWorkspaceResourceVersion({
    projectId,
    resourceId,
    version: selectedVersion,
    enabled: panel === 'versions' && selectedVersion !== null,
  })
  const selectedDetail: WorkspaceResourceVersionDetailView | null = selectedVersionQuery.data ?? null
  const selectedScreenplay = selectedDetail
    ? readScreenplayDocument(undefined, selectedDetail.content)
    : null
  const viewingVersion = selectedVersion !== null
  const viewingOldVersion = selectedVersion !== null && selectedVersion !== currentVersion
  const canDiff = viewingOldVersion
    && selectedScreenplay !== null
    && selectedScreenplay.text !== screenplay.text
  const displayText = viewingVersion
    ? selectedScreenplay?.text ?? ''
    : screenplay.text
  const displayScenes = parseScreenplayScenes(displayText)
  const sceneListScenes = viewingVersion && !selectedScreenplay ? [] : displayScenes
  const title = viewingVersion ? selectedScreenplay?.title ?? screenplay.title : screenplay.title

  const selectVersion = (version: number) => {
    setSelectedVersion(version)
    setShowDiff(false)
  }

  const selectScene = (scene: ScreenplayScene) => {
    if (viewingVersion) return
    setActiveSceneIndex(scene.index)
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-scene-index="${String(scene.index)}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const buildPrompt = (action: WorkbenchAction): string => (
    t(`prompts.${action}`, {
      title: screenplay.title,
      path: workspacePath,
      version: String(currentVersion),
      resourceId,
    })
  )

  const runAction = (action: WorkbenchAction) => {
    onAssistantDraft(buildPrompt(action))
    onClose()
  }

  const openAssistant = () => {
    onAssistantDraft(t('openAssistantPrompt', {
      title: screenplay.title,
      version: String(currentVersion),
      resourceId,
    }))
    onClose()
  }

  const copyText = () => {
    if (!displayText) return
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(displayText).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    }).catch(() => undefined)
  }

  const startEdit = () => {
    if (!canEdit) return
    setEditing(true)
    setEditText(screenplay.text)
    setPanel('scenes')
    setSelectedVersion(null)
    setShowDiff(false)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditText('')
  }

  const submitRevision = async (
    content: WorkspaceResourceContent,
    successMessage: (version: number) => string,
    failureMessage: string,
  ) => {
    if (saving) return
    setSaving(true)
    try {
      const result = await requestOperationMutationWithError(
        `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}/revisions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `revise_project_document:${resourceId}:${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            resourceId,
            expectedContentVersion: currentVersion,
            content,
          }),
        },
        queryClient,
      )
      const nextVersion = result && typeof result === 'object' && 'contentVersion' in result
        ? Number(result.contentVersion)
        : currentVersion + 1
      showToast(successMessage(nextVersion), 'success')
      setEditing(false)
      setEditText('')
      setPanel('scenes')
      setSelectedVersion(null)
      setShowDiff(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.workspaceResourcesAll(projectId) })
    } catch (error) {
      const conflict = typeof error === 'object'
        && error !== null
        && 'status' in error
        && (error as { readonly status?: unknown }).status === 409
      if (conflict) showToast(t('versionConflict'), 'error')
      else showError(error, failureMessage)
      await contentQuery.refetch()
      await versionsQuery.refetch()
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    if (!currentContent || currentContent.kind !== 'structured' || !canEdit) return
    const object = asObject(currentContent.data)
    if (!object) {
      showError(new Error('PROJECT_DOCUMENT_STRUCTURE_INVALID'), t('saveFailed'))
      return
    }
    await submitRevision(
      { kind: 'structured', data: { ...object, screenplayText: editText } },
      (version) => t('saveSuccess', { version }),
      t('saveFailed'),
    )
  }

  const restoreSelectedVersion = async () => {
    if (!selectedDetail?.content) return
    await submitRevision(
      selectedDetail.content,
      (version) => t('restoreSuccess', { version }),
      t('restoreFailed'),
    )
  }

  const footer = editing ? (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--glass-text-tertiary)]">{t('editHint')}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          onClick={cancelEdit}
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          disabled={saving}
          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
          onClick={() => { void saveEdit() }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  ) : viewingOldVersion ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-amber-700">
          {t('viewingVersion', { version: selectedVersion ?? 0 })}
        </span>
        {canDiff ? (
          <button
            type="button"
            className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
            onClick={() => setShowDiff((current) => !current)}
          >
            {showDiff ? t('showContent') : t('compare')}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          onClick={() => { setSelectedVersion(null); setShowDiff(false) }}
        >
          {t('backToCurrent')}
        </button>
        <button
          type="button"
          disabled={saving || !selectedDetail?.content}
          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
          onClick={() => { void restoreSelectedVersion() }}
        >
          {saving ? t('restoring') : t('restore')}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {(['review', 'hook', 'compress', 'conflict', 'ending', 'rewrite'] as const).map((action) => (
          <button
            key={action}
            type="button"
            disabled={!screenplay.text || saving}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => runAction(action)}
          >
            {t(`actions.${action}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!displayText}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          onClick={copyText}
        >
          {copied ? t('copied') : t('copy')}
        </button>
        {canEdit ? (
          <button
            type="button"
            disabled={saving}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={startEdit}
          >
            {t('edit')}
          </button>
        ) : null}
        <button
          type="button"
          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
          onClick={openAssistant}
        >
          {t('openInAssistant')}
        </button>
      </div>
    </div>
  )

  return (
    <GlassModalShell
      open
      onClose={onClose}
      title={(
        <span className="flex min-w-0 items-center gap-2">
          <AppIcon name="fileText" className="h-5 w-5 shrink-0 text-slate-500" />
          <span className="truncate">{title || t('eyebrow')}</span>
          {currentVersion > 0 ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
              {t('version', { version: currentVersion })}
            </span>
          ) : null}
        </span>
      )}
      description={(
        <span className="block truncate text-xs text-[var(--glass-text-tertiary)]">
          {workspacePath || t('description')}
        </span>
      )}
      footer={contentQuery.isLoading || contentQuery.isError ? null : footer}
      size="xl"
    >
      {contentQuery.isLoading ? (
        <div className="flex min-h-[20rem] items-center justify-center rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-tertiary)]">
          {t('loading')}
        </div>
      ) : contentQuery.isError ? (
        <div className="flex min-h-[20rem] flex-col items-center justify-center gap-3 rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-secondary)]">
          <span>{t('loadFailed')}</span>
          <button
            type="button"
            className="font-semibold text-[var(--glass-text-primary)]"
            onClick={() => { void contentQuery.refetch() }}
          >
            {t('retry')}
          </button>
        </div>
      ) : (
        <div className="grid h-[68vh] min-h-[20rem] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
          <aside className="flex max-h-[30vh] min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70 md:max-h-none">
            <div className="flex rounded-full bg-slate-200/70 p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                  panel === 'scenes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => { setPanel('scenes'); setSelectedVersion(null); setShowDiff(false) }}
              >
                {t('sceneList')}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                  panel === 'versions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => { setPanel('versions'); setShowDiff(false) }}
              >
                {t('history')}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {panel === 'scenes' ? (
                <ol className="space-y-1">
                  {sceneListScenes.map((scene) => (
                    <li key={scene.index}>
                      <button
                        type="button"
                        className={`w-full rounded-lg px-2 py-1.5 text-left text-[12px] leading-5 transition ${
                          scene.index === activeSceneIndex && !viewingVersion
                            ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200'
                            : 'text-slate-600 hover:bg-white/70'
                        }`}
                        onClick={() => selectScene(scene)}
                      >
                        <span className="mr-1.5 tabular-nums text-[10px] text-slate-400">{scene.index + 1}</span>
                        {sceneLabel(scene, t('wholeText'))}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <VersionList
                  versions={versionsQuery.data ?? []}
                  currentVersion={currentVersion}
                  selectedVersion={selectedVersion}
                  loading={versionsQuery.isLoading}
                  failed={versionsQuery.isError}
                  emptyLabel={t('versionsEmpty')}
                  onSelect={selectVersion}
                  onRetry={() => { void versionsQuery.refetch() }}
                />
              )}
            </div>
            {panel === 'scenes' ? (
              <dl className="shrink-0 space-y-3 border-t border-slate-200 pt-3">
                {screenplay.logline ? <MetaRow label={t('logline')} value={screenplay.logline} /> : null}
                {screenplay.synopsis ? <MetaRow label={t('synopsis')} value={screenplay.synopsis} /> : null}
                <MetaList label={t('assumptions')} values={screenplay.assumptions} />
                <MetaList label={t('openQuestions')} values={screenplay.openQuestions} />
                {screenplay.sourceLabel ? <MetaRow label={t('source')} value={screenplay.sourceLabel} /> : null}
              </dl>
            ) : null}
          </aside>
          {editing ? (
            <div className="flex min-h-0 flex-col gap-2">
              <textarea
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                className="min-h-0 flex-1 resize-none rounded-2xl border border-slate-200 bg-white p-4 font-mono text-[13px] leading-6 text-slate-700 outline-none ring-0 focus:border-slate-400"
                spellCheck={false}
              />
            </div>
          ) : viewingVersion ? (
            selectedVersionQuery.isLoading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-tertiary)]">
                {t('versionsLoading')}
              </div>
            ) : selectedVersionQuery.isError ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-secondary)]">
                <span>{t('versionsFailed')}</span>
                <button
                  type="button"
                  className="font-semibold text-[var(--glass-text-primary)]"
                  onClick={() => { void selectedVersionQuery.refetch() }}
                >
                  {t('retry')}
                </button>
              </div>
            ) : selectedDetail?.content ? (
              viewingOldVersion && showDiff ? (
                <ScreenplayDiff
                  before={selectedScreenplay?.text ?? ''}
                  after={screenplay.text}
                  fromVersion={selectedVersion ?? 0}
                  toVersion={currentVersion}
                />
              ) : (
                <SceneBody
                  scenes={displayScenes}
                  bodyRef={bodyRef}
                />
              )
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-tertiary)]">
                {t('contentUnavailable')}
              </div>
            )
          ) : (
            <SceneBody
              scenes={displayScenes}
              bodyRef={bodyRef}
            />
          )}
        </div>
      )}
    </GlassModalShell>
  )
}
