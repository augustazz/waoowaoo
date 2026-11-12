'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon, RatioPreviewIcon } from '@/components/ui/icons'
import { useToast } from '@/contexts/ToastContext'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { requestOperationMutationWithError } from '@/lib/query/mutations/mutation-shared'
import { PROJECT_VIDEO_RATIOS, resolveProjectVideoRatio } from '@/lib/projects/video-ratio'

export function ProjectAspectRatioControl({ projectId }: { readonly projectId: string }) {
  const t = useTranslations('projectWorkflow.canvas.workspace.projectAspectRatio')
  const { data: project } = useProjectData(projectId)
  const queryClient = useQueryClient()
  const { showError, showToast } = useToast()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const ratio = project ? resolveProjectVideoRatio(project.videoRatio) : null
  const mutation = useMutation({
    mutationFn: (videoRatio: string) => requestOperationMutationWithError(
      `/api/projects/${encodeURIComponent(projectId)}/config`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoRatio }) },
      queryClient,
    ),
    onSuccess: () => {
      setOpen(false)
      showToast(t('saved'), 'success')
    },
    onError: (error) => showError(error, t('saveFailed')),
  })

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const orientation = (value: string) => {
    const [width, height] = value.split(':').map(Number)
    return t(width === height ? 'square' : width > height ? 'landscape' : 'portrait')
  }

  return (
    <div ref={root} className="overflow-hidden rounded-2xl border border-slate-200 bg-white" data-project-aspect-ratio>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('current', { ratio: ratio ?? t('unset') })}
        disabled={!project || mutation.isPending}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        {mutation.isPending ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
          : ratio ? <RatioPreviewIcon ratio={ratio} size={15} variant="muted" /> : null}
        <span className="flex-1 text-left">{t('label')}</span>
        <span>{ratio ?? t('unset')}</span>
        {ratio ? <span className="text-slate-400">{orientation(ratio)}</span> : null}
        <AppIcon name="chevronDown" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('label')}
          className="border-t border-slate-100 p-3"
        >
          <p className="text-xs leading-5 text-slate-500">{t('description')}</p>
          <div role="group" aria-label={t('label')} className="mt-3 grid grid-cols-4 gap-2">
            {PROJECT_VIDEO_RATIOS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={option}
                aria-pressed={ratio === option}
                disabled={mutation.isPending}
                onClick={() => {
                  if (option === ratio) setOpen(false)
                  else mutation.mutate(option)
                }}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition disabled:opacity-50 ${ratio === option ? 'border-slate-800 bg-slate-100' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <span className="flex h-8 items-center"><RatioPreviewIcon ratio={option} size={28} selected={ratio === option} variant="muted" /></span>
                <span className="font-semibold">{option}</span>
                <span className="text-[10px] text-slate-500">{orientation(option)}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">{t('existingUnchanged')}</p>
        </div>
      ) : null}
    </div>
  )
}
