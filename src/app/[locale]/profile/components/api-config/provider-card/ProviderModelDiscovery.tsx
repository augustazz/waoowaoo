'use client'

import type { ProviderCardProps, ProviderCardTranslator } from './types'

type DiscoveryProps = Pick<ProviderCardProps, 'provider' | 'discovery' | 'onRefreshModels'> & {
  t: ProviderCardTranslator
}

/** Fetch choices for the existing category pickers; this is not a second picker. */
export function ProviderModelDiscovery({ provider, discovery, onRefreshModels, t }: DiscoveryProps) {
  const configured = Boolean(provider.baseUrl && (provider.hasApiKey || provider.apiKey))
  return (
    <div className="space-y-2 px-4 pb-4 pt-3">
      <div className="flex items-center gap-3">
        <button type="button" disabled={!configured || discovery?.loading} onClick={() => void onRefreshModels()}
          className="glass-btn-base glass-btn-soft px-3 py-1.5 text-xs">
          {t(discovery?.loading ? 'discovery.loading' : 'discovery.fetch')}
        </button>
        {discovery && !discovery.loading && !discovery.failed && (
          <span role="status" className="text-xs text-[var(--glass-text-tertiary)]">{t('discovery.available', { count: discovery.count })}</span>
        )}
      </div>
      {discovery?.failed && <p role="alert" className="text-xs text-red-500">{t('discovery.fetchFailed')}</p>}
    </div>
  )
}
