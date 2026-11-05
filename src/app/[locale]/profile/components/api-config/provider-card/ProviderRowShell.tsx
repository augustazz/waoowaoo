'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AppIcon } from '@/components/ui/icons'
import type { ProviderCardProps, ProviderCardTranslator } from './types'
import type { UseProviderCardStateResult } from './hooks/useProviderCardState'

interface ProviderRowShellProps {
  provider: ProviderCardProps['provider']
  dragHandle?: ProviderCardProps['dragHandle']
  expanded: boolean
  onExpandChange: ProviderCardProps['onExpandChange']
  onDeleteProvider: ProviderCardProps['onDeleteProvider']
  onUpdateProviderName?: ProviderCardProps['onUpdateProviderName']
  modelCount: number
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
  children: ReactNode
}

/** A provider is a credential holder here: its row carries the key, not model choices. */
export function ProviderRowShell({
  provider,
  dragHandle,
  expanded,
  onExpandChange,
  onDeleteProvider,
  onUpdateProviderName,
  modelCount,
  t,
  state,
  children,
}: ProviderRowShellProps) {
  const configured = !!provider.hasApiKey
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(provider.name)
  const canRename = !state.isPresetProvider && !!onUpdateProviderName

  const startEditName = () => {
    setNameDraft(provider.name)
    setIsEditingName(true)
  }

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    onUpdateProviderName?.(provider.id, trimmed)
    setIsEditingName(false)
  }

  const cancelEditName = () => {
    setNameDraft(provider.name)
    setIsEditingName(false)
  }

  return (
    <div className="border-b border-[var(--glass-stroke-base)] last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {dragHandle}
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${configured ? 'bg-[var(--glass-tone-success-fg)]' : 'bg-[var(--glass-stroke-strong)]'}`}
        />
        {isEditingName && canRename ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => { event.preventDefault(); saveName() }}
          >
            <input
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              aria-label={t('providerNamePlaceholder')}
              placeholder={t('providerNamePlaceholder')}
              className="glass-input-base min-w-0 flex-1 px-2 py-1 text-sm"
              autoFocus
            />
            <button type="submit" className="glass-icon-btn-sm" aria-label={t('save')}>
              <AppIcon name="check" className="h-4 w-4" />
            </button>
            <button type="button" className="glass-icon-btn-sm" aria-label={t('cancel')} onClick={cancelEditName}>
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => onExpandChange(!expanded)}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
          >
            <span className="truncate text-[15px] font-bold text-[var(--glass-text-primary)]">{provider.name}</span>
            <span className="hidden shrink-0 text-[12px] text-[var(--glass-text-tertiary)] sm:inline">
              {configured ? t('keyConfigured') : t('notConfigured')}
            </span>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {canRename && !isEditingName && (
            <button
              type="button"
              onClick={startEditName}
              className="glass-icon-btn-sm"
              title={t('renameProvider')}
              aria-label={t('renameProvider')}
            >
              <AppIcon name="editSquare" className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => { onExpandChange(true); state.startEditKey() }}
            className={`glass-btn-base px-2.5 py-1.5 text-[12px] ${configured ? 'glass-btn-soft' : 'glass-btn-primary'}`}
          >
            <AppIcon name={configured ? 'edit' : 'plus'} className="h-3.5 w-3.5" />
            {configured ? t('configure') : t('configureApiKey')}
          </button>
          {state.tutorial && (
            <button
              type="button"
              onClick={() => state.setShowTutorial(true)}
              className="glass-btn-base glass-btn-soft hidden px-2.5 py-1.5 text-[12px] sm:inline-flex"
            >
              <AppIcon name="bookOpen" className="h-3.5 w-3.5" />
              {t('tutorial.button')}
            </button>
          )}
          {!state.isPresetProvider && onDeleteProvider && (
            <button
              type="button"
              onClick={() => onDeleteProvider(provider.id)}
              className="glass-icon-btn-sm hover:text-[var(--glass-tone-danger-fg)]"
              title={t('delete')}
              aria-label={t('delete')}
            >
              <AppIcon name="trash" className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onExpandChange(!expanded)}
            aria-expanded={expanded}
            aria-label={provider.editableBaseUrl ? t('configure') : t('providerModelsCount', { count: modelCount })}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-[var(--glass-text-tertiary)] transition-colors hover:text-[var(--glass-text-secondary)]"
          >
            {!provider.editableBaseUrl && <>
              <span className="hidden md:inline">{t('providerModelsCount', { count: modelCount })}</span>
              <span className="md:hidden">{modelCount}</span>
            </>}
            <AppIcon name={expanded ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {state.showTutorial && state.tutorial && typeof document !== 'undefined'
        ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center glass-overlay"
            onClick={() => state.setShowTutorial(false)}
          >
            <div
              className="glass-surface-modal mx-4 w-full max-w-lg overflow-hidden rounded-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--glass-stroke-base)] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="glass-btn-base glass-btn-primary flex h-8 w-8 items-center justify-center rounded-lg text-white">
                    <AppIcon name="bookOpen" className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">
                      {provider.name} {t('tutorial.title')}
                    </h3>
                    <p className="text-xs text-[var(--glass-text-secondary)]">{t('tutorial.subtitle')}</p>
                  </div>
                </div>
                <button
                  onClick={() => state.setShowTutorial(false)}
                  className="glass-btn-base glass-btn-soft rounded-lg p-1.5"
                >
                  <AppIcon name="close" className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4 p-5">
                {state.tutorial.steps.map((step, index) => (
                  <div key={index} className="flex gap-3">
                    <div className="glass-surface-soft flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] text-xs font-bold text-[var(--glass-text-secondary)]">
                      {index + 1}
                    </div>
                    <div className="flex-1 pt-0.5">
                      <p className="text-sm leading-relaxed text-[var(--glass-text-secondary)]">
                        {t(`tutorial.steps.${step.text}`)}
                      </p>
                      {step.url && (
                        <a
                          href={step.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)] hover:underline"
                        >
                          <AppIcon name="externalLink" className="w-3 h-3" />
                          {t('tutorial.openLink')}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end border-t border-[var(--glass-stroke-base)] px-5 py-3">
                <button
                  onClick={() => state.setShowTutorial(false)}
                  className="glass-btn-base glass-btn-secondary rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {t('tutorial.close')}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}

      {expanded && <div className="border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)]">{children}</div>}
    </div>
  )
}
