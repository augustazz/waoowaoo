'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceResourceView } from '@/lib/query/hooks'
import { workspaceResourceContentText } from '@/lib/workspace-resource/contracts'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import type { WorkspaceResourceCardMemberView } from '../contracts/workspace-canvas-interactions'

function ResourcePreviewBody({ card }: { readonly card: WorkspaceResourceCardMemberView }) {
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  const previewLabels = useTranslations('projectWorkflow.canvas.workspace.preview')
  const { projectId } = useWorkspaceProvider()
  const summary = card.presentation.summary
  // Text/structured previews are bounded summaries; the modal upgrades to the
  // full content through the single-resource read while showing the summary.
  const isTextPreview = card.resource.status === 'ready'
    && (summary.kind === 'text' || summary.kind === 'structured')
  const contentQuery = useWorkspaceResourceView({
    projectId,
    resourceId: isTextPreview ? card.resource.resourceId : null,
  })
  const fullContentText = workspaceResourceContentText(contentQuery.data?.current?.content)
  if (card.resource.status !== 'ready') {
    return (
      <div className="flex min-h-[18rem] items-center justify-center rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-tertiary)]">
        {statusLabels(card.resource.status)}
      </div>
    )
  }
  if (summary.kind === 'media' && summary.url) {
    if (summary.mediaType === 'image') {
      // The URL is already the protected media projection from the View.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={summary.url} alt={card.resource.name} className="max-h-[68vh] w-full rounded-2xl object-contain" />
    }
    if (summary.mediaType === 'video') {
      return <video src={summary.url} poster={summary.posterUrl ?? undefined} controls autoPlay className="max-h-[68vh] w-full rounded-2xl bg-black object-contain" />
    }
    if (summary.mediaType === 'audio') {
      return (
        <div className="flex min-h-[18rem] items-center justify-center rounded-2xl bg-slate-50 px-8">
          <audio src={summary.url} controls autoPlay className="w-full" />
        </div>
      )
    }
  }
  if (summary.kind === 'text') {
    return <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-5 text-sm leading-6 text-slate-700">{fullContentText ?? summary.text}</pre>
  }
  if (summary.kind === 'structured') {
    if (fullContentText || summary.preview) {
      return <pre className="max-h-[68vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-50 p-5 text-sm leading-6 text-slate-700">{fullContentText ?? summary.preview}</pre>
    }
    return (
      <div className="flex min-h-[18rem] items-center justify-center rounded-2xl bg-slate-50 text-sm text-[var(--glass-text-tertiary)]">
        {summary.entryCount === null
          ? previewLabels('structuredUnknown')
          : previewLabels('structuredEntries', { count: summary.entryCount })}
      </div>
    )
  }
  return <div className="min-h-[18rem] rounded-2xl bg-slate-50" />
}

export function WorkspaceResourcePreviewModal({
  members,
  initialResourceId,
  onClose,
  onDiscuss,
  onOpenScreenplay,
}: {
  readonly members: readonly WorkspaceResourceCardMemberView[]
  readonly initialResourceId: string
  readonly onClose: () => void
  readonly onDiscuss: (card: WorkspaceResourceCardMemberView) => void
  readonly onOpenScreenplay?: (resourceId: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.preview')
  const stageT = useTranslations('projectWorkflow.canvas.workspace.stages')
  const initialIndex = Math.max(0, members.findIndex((card) => card.resource.resourceId === initialResourceId))
  const [index, setIndex] = useState(initialIndex)
  const card = members[index] ?? members[0] ?? null
  const canNavigate = members.length > 1

  useEffect(() => {
    if (!canNavigate) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setIndex((current) => (current - 1 + members.length) % members.length)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setIndex((current) => (current + 1) % members.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canNavigate, members.length])

  const footer = useMemo(() => card ? (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs tabular-nums text-[var(--glass-text-tertiary)]">
        {t('position', { current: index + 1, total: members.length })}
      </span>
      <div className="flex items-center gap-2">
        {onOpenScreenplay && card.resource.status === 'ready' && card.resource.schemaId === WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY ? (
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => onOpenScreenplay(card.resource.resourceId)}
          >
            {stageT('openScript')}
          </button>
        ) : null}
        <button
          type="button"
          className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
          onClick={() => onDiscuss(card)}
        >
          {t('discuss')}
        </button>
      </div>
    </div>
  ) : null, [card, index, members.length, onDiscuss, onOpenScreenplay, stageT, t])

  if (!card) return null
  return (
    <GlassModalShell
      open
      onClose={onClose}
      title={card.resource.name}
      description={canNavigate ? t('groupDescription', { count: members.length }) : t('singleDescription')}
      footer={footer}
      size="xl"
    >
      <div className="relative">
        <ResourcePreviewBody card={card} />
        {canNavigate ? (
          <>
            <button
              type="button"
              aria-label={t('previous')}
              title={t('previous')}
              className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70"
              onClick={() => setIndex((current) => (current - 1 + members.length) % members.length)}
            >
              <AppIcon name="chevronLeft" className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={t('next')}
              title={t('next')}
              className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70"
              onClick={() => setIndex((current) => (current + 1) % members.length)}
            >
              <AppIcon name="chevronRight" className="h-5 w-5" />
            </button>
          </>
        ) : null}
      </div>
    </GlassModalShell>
  )
}
