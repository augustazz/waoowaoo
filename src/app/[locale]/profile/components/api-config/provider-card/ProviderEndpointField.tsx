'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { normalizeResponsesBaseUrl } from '@/lib/ai-providers/openai-compatible/config'
import type { ProviderCardProps, ProviderCardTranslator } from './types'

export function ProviderEndpointField({ provider, t, onUpdate }: {
  provider: ProviderCardProps['provider']
  t: ProviderCardTranslator
  onUpdate: NonNullable<ProviderCardProps['onUpdateBaseUrl']>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)

  return (
    <div className="space-y-2">
      <div className="glass-surface-soft flex items-center gap-3 rounded-xl px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-[var(--glass-text-secondary)]">{t('baseUrl')}</span>
        {editing ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(event) => {
            event.preventDefault()
            try {
              onUpdate(provider.id, normalizeResponsesBaseUrl(draft))
              setInvalid(false)
              setEditing(false)
            } catch {
              setInvalid(true)
            }
          }}>
            <input
              type="url"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
              aria-label={t('baseUrl')}
              aria-invalid={invalid}
              placeholder="https://your-api.example/v1"
              className="glass-input-base min-w-0 flex-1 px-3 py-1.5 text-xs"
              required
              autoFocus
            />
            <button type="submit" className="glass-icon-btn-sm" aria-label={t('save')}><AppIcon name="check" className="h-4 w-4" /></button>
            <button type="button" className="glass-icon-btn-sm" aria-label={t('cancel')} onClick={() => { setEditing(false); setInvalid(false) }}><AppIcon name="close" className="h-4 w-4" /></button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="truncate text-xs text-[var(--glass-text-tertiary)]" title={provider.baseUrl}>{provider.baseUrl || t('notConfigured')}</span>
            <button type="button" className="glass-btn-base glass-btn-soft shrink-0 px-2.5 py-1.5 text-xs" onClick={() => { setDraft(provider.baseUrl || ''); setEditing(true) }}>
              <AppIcon name="edit" className="h-3.5 w-3.5" />{t('configureBaseUrl')}
            </button>
          </div>
        )}
      </div>
      {invalid && <p role="alert" className="text-xs text-red-500">{t('responsesBaseUrlInvalid')}</p>}
      <p className="px-1 text-xs text-[var(--glass-text-tertiary)]">{t('responsesProviderHint')}</p>
    </div>
  )
}
