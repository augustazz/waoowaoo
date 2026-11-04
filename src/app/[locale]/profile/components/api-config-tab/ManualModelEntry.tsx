'use client'

import { useState } from 'react'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import { encodeModelKey, type CustomModel, type Provider } from '../api-config'
import type { ProviderCardTranslator } from '../api-config/provider-card/types'

/** Fallback inside the category picker for providers without a model directory. */
export function ManualModelEntry({ type, providers, onSelect, t }: {
  type: UnifiedModelType
  providers: Provider[]
  onSelect: (model: Omit<CustomModel, 'enabled'>) => Promise<void>
  t: ProviderCardTranslator
}) {
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedProvider = providers.find(provider => provider.id === providerId) ?? providers[0]

  return (
    <details className="border-t border-[var(--glass-stroke-base)] p-3">
      <summary className="cursor-pointer text-xs text-[var(--glass-text-secondary)]">{t('discovery.manual')}</summary>
      <form className="mt-3 space-y-2" onSubmit={async event => {
        event.preventDefault()
        const form = event.currentTarget
        const id = modelId.trim()
        if (!id || !selectedProvider || saving) return
        setSaving(true)
        setError('')
        try {
          await onSelect({ provider: selectedProvider.id, modelId: id, modelKey: encodeModelKey(selectedProvider.id, id), name: id, type })
          setModelId('')
          form.closest('details')?.removeAttribute('open')
        } catch (cause) {
          setError(t(cause instanceof Error && cause.message === 'MODEL_TYPE_CONFLICT' ? 'discovery.typeConflict' : 'saveFailed'))
        } finally {
          setSaving(false)
        }
      }}>
        {providers.length > 1 && (
          <select aria-label={t('discovery.provider')} value={selectedProvider?.id ?? ''} disabled={saving}
            onChange={event => setProviderId(event.target.value)} className="glass-input-base w-full rounded-lg px-2 py-2 text-xs">
            {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        )}
        <input aria-label={t('modelActualId')} placeholder={t('modelActualId')} value={modelId} disabled={saving}
          onChange={event => setModelId(event.target.value)} required className="glass-input-base w-full rounded-lg px-3 py-2 text-xs" />
        <button type="submit" disabled={saving || !modelId.trim()} className="glass-btn-base glass-btn-primary px-3 py-1.5 text-xs">
          {t(saving ? 'saving' : 'save')}
        </button>
        {error && <p role="alert" className="text-xs text-[var(--glass-tone-warning-fg)]">{error}</p>}
      </form>
    </details>
  )
}
