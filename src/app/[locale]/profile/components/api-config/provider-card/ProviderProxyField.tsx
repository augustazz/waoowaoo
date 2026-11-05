'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ProviderCardProps, ProviderCardTranslator } from './types'

function normalizeProxyUrl(value: string): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('PROXY_PROTOCOL_INVALID')
  }
  const serialized = parsed.toString()
  // Avoid turning http://host:7890 into http://host:7890/ in the UI.
  return parsed.pathname === '/' && !parsed.search && !parsed.hash
    ? serialized.replace(/\/$/, '')
    : serialized
}

export function ProviderProxyField({ provider, t, onUpdate }: {
  provider: ProviderCardProps['provider']
  t: ProviderCardTranslator
  onUpdate: NonNullable<ProviderCardProps['onUpdateProxyUrl']>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)

  return (
    <div className="space-y-2">
      <div className="glass-surface-soft flex items-center gap-3 rounded-xl px-3 py-2">
        <span className="shrink-0 text-xs font-medium text-[var(--glass-text-secondary)]">{t('proxyUrl')}</span>
        {editing ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(event) => {
            event.preventDefault()
            const trimmed = draft.trim()
            if (!trimmed) {
              onUpdate(provider.id, '')
              setInvalid(false)
              setEditing(false)
              return
            }
            try {
              onUpdate(provider.id, normalizeProxyUrl(trimmed))
              setInvalid(false)
              setEditing(false)
            } catch {
              setInvalid(true)
            }
          }}>
            <input
              type="text"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
              aria-label={t('proxyUrl')}
              aria-invalid={invalid}
              placeholder={t('proxyUrlPlaceholder')}
              className="glass-input-base min-w-0 flex-1 px-3 py-1.5 text-xs"
              autoFocus
            />
            <button type="submit" className="glass-icon-btn-sm" aria-label={t('save')}><AppIcon name="check" className="h-4 w-4" /></button>
            <button type="button" className="glass-icon-btn-sm" aria-label={t('cancel')} onClick={() => { setEditing(false); setInvalid(false) }}><AppIcon name="close" className="h-4 w-4" /></button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="truncate text-xs text-[var(--glass-text-tertiary)]" title={provider.proxyUrl}>{provider.proxyUrl || t('proxyNotConfigured')}</span>
            <button type="button" className="glass-btn-base glass-btn-soft shrink-0 px-2.5 py-1.5 text-xs" onClick={() => { setDraft(provider.proxyUrl || ''); setEditing(true) }}>
              <AppIcon name="edit" className="h-3.5 w-3.5" />{t('configureProxy')}
            </button>
          </div>
        )}
      </div>
      {invalid && <p role="alert" className="text-xs text-red-500">{t('proxyUrlInvalid')}</p>}
      <p className="px-1 text-xs text-[var(--glass-text-tertiary)]">{t('proxyUrlHint')}</p>
    </div>
  )
}
