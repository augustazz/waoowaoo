'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import type { DiscoveredProviderModel } from '@/lib/ai-providers/openai-compatible/model-discovery'
import { encodeModelKey, type CustomModel, type Provider } from '../../api-config'

interface CatalogEntry {
  signature: string
  models: DiscoveredProviderModel[]
  loading: boolean
  failed: boolean
}

function signature(provider: Provider) {
  return JSON.stringify([provider.baseUrl, provider.hasApiKey])
}

export function useProviderModelCatalog({ providers, saveStatus, flushConfig }: {
  providers: Provider[]
  saveStatus: string
  flushConfig: () => Promise<void>
}) {
  const [catalogs, setCatalogs] = useState<Record<string, CatalogEntry>>({})
  const requested = useRef(new Map<string, string>())
  const requests = useRef(new Map<string, symbol>())

  const fetchModels = useCallback(async (provider: Provider, flush: boolean) => {
    const token = Symbol()
    const stamp = signature(provider)
    requests.current.set(provider.id, token)
    requested.current.set(provider.id, stamp)
    setCatalogs(previous => ({
      ...previous,
      [provider.id]: { signature: stamp, models: previous[provider.id]?.signature === stamp ? previous[provider.id].models : [], loading: true, failed: false },
    }))
    try {
      if (flush) await flushConfig()
      const response = await apiFetch('/api/user/api-config/provider-models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: provider.id }),
      })
      if (!response.ok) throw new Error('MODEL_DISCOVERY_FAILED')
      const result = await response.json() as { models: DiscoveredProviderModel[] }
      if (!Array.isArray(result.models)) throw new Error('MODEL_DISCOVERY_INVALID')
      if (requests.current.get(provider.id) !== token) return
      setCatalogs(previous => ({ ...previous, [provider.id]: { signature: stamp, models: result.models, loading: false, failed: false } }))
    } catch {
      if (requests.current.get(provider.id) !== token) return
      setCatalogs(previous => ({ ...previous, [provider.id]: { ...previous[provider.id], loading: false, failed: true } }))
    }
  }, [flushConfig])

  useEffect(() => {
    // A replaced key can expose a different directory even when hasApiKey stays
    // true. Wait for its save, then fetch again without retaining the secret.
    for (const provider of providers) {
      if (provider.apiKey === undefined) continue
      requested.current.delete(provider.id)
      requests.current.delete(provider.id)
    }
    if (saveStatus === 'saving' || saveStatus === 'error') return
    for (const provider of providers) {
      if (!provider.editableBaseUrl || !provider.baseUrl || !provider.hasApiKey || provider.apiKey !== undefined) continue
      if (requested.current.get(provider.id) === signature(provider)) continue
      // Fetch saved provider catalogs on page load; opening a picker needs no
      // additional import/enable action and does not write user configuration.
      void fetchModels(provider, false)
    }
  }, [providers, saveStatus, fetchModels])

  const availableModels = useMemo(() => providers.flatMap(provider => {
    const entry = catalogs[provider.id]
    if (!entry || entry.signature !== signature(provider)) return []
    return entry.models.flatMap(model => {
      const types = model.classification === 'unknown' ? provider.modelTypes ?? [] : model.types
      return types.filter(type => provider.modelTypes?.includes(type)).map(type => ({
        modelId: model.id, name: model.name, modelKey: encodeModelKey(provider.id, model.id),
        provider: provider.id, type, enabled: false,
        ...(type === 'video' ? { videoAvailability: model.videoAvailability } : {}),
        unclassified: model.classification === 'unknown',
      } satisfies CustomModel & { unclassified: boolean }))
    })
  }), [providers, catalogs])

  return {
    availableModels,
    refreshModels: (providerId: string) => {
      const provider = providers.find(item => item.id === providerId)
      return provider ? fetchModels(provider, true) : Promise.resolve()
    },
    getDiscovery: (provider: Provider) => {
      const entry = catalogs[provider.id]
      return entry?.signature === signature(provider)
        ? { loading: entry.loading, failed: entry.failed, count: entry.models.length }
        : undefined
    },
  }
}
