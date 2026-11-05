import { describe, expect, it } from 'vitest'
import { tryResolveAiProviderAdapter } from '@/lib/ai-providers'
import {
  isApiConfigCatalogProviderId,
  listApiConfigCatalogProviders,
  listApiConfigCatalogModels,
} from '@/lib/ai-registry/api-config-catalog'
import { AI_PROVIDER_MANIFESTS } from '@/lib/ai-providers/manifests'
import { ApiError } from '@/lib/api-errors'
import { normalizeProvidersInput } from '@/lib/user-api/api-config-provider-normalization'
import { normalizeProviderRuntimeBaseUrl } from '@/lib/ai-registry/runtime-selection'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { getDeploymentConfig } from '@/lib/deployment/config'
import {
  listProviderMediaInputContracts,
} from '@/lib/ai-exec/media-input-transport'

ensureAiCatalogsRegistered()

describe('API config provider registry conformance', () => {
  it('keeps every catalog provider executable, configurable, and platform-declared', () => {
    const catalogProviders = listApiConfigCatalogProviders()
    const catalogProviderIds = catalogProviders.map((provider) => provider.id)
    expect(new Set(catalogProviderIds).size).toBe(catalogProviderIds.length)

    const modelProviderIds = Array.from(new Set(
      listApiConfigCatalogModels().map((model) => model.provider),
    )).sort()
    const customModelProviderIds = AI_PROVIDER_MANIFESTS
      .filter((manifest) => manifest.customLlm)
      .map((manifest) => manifest.providerKey)
    expect([...new Set([...modelProviderIds, ...customModelProviderIds])].sort())
      .toEqual([...catalogProviderIds].sort())
    expect(AI_PROVIDER_MANIFESTS
      .filter((manifest) => manifest.apiConfig)
      .every((manifest) => Boolean(manifest.platformCredentials)))
      .toBe(true)
    expect(new Set(AI_PROVIDER_MANIFESTS.map((manifest) => manifest.providerKey)).size)
      .toBe(AI_PROVIDER_MANIFESTS.length)
    expect(AI_PROVIDER_MANIFESTS.every((manifest) => (
      manifest.adapter.providerKey === manifest.providerKey
    ))).toBe(true)
    expect(listProviderMediaInputContracts().every((contract) => (
      AI_PROVIDER_MANIFESTS.some((manifest) => manifest.providerKey === contract.provider)
    ))).toBe(true)
    if (getDeploymentConfig().edition === 'self-hosted') {
      expect(catalogProviders
        .filter((provider) => provider.featured)
        .map((provider) => provider.id)
        .sort())
        .toEqual(['ark', 'openai-compatible'])
    }

    for (const provider of catalogProviders) {
      expect(isApiConfigCatalogProviderId(provider.id)).toBe(true)
      expect(tryResolveAiProviderAdapter(provider.id)).not.toBeNull()
      expect(normalizeProviderRuntimeBaseUrl(provider.id)).toBe(provider.baseUrl)
      expect(() => normalizeProvidersInput([provider])).not.toThrow()
    }
  })

  it('normalizes per-provider proxy overrides and distinguishes clear from preserve', () => {
    const [configured] = normalizeProvidersInput([{
      id: 'openai-compatible',
      name: 'Custom API',
      proxyUrl: 'http://127.0.0.1:7890',
    }])
    expect(configured?.proxyUrl).toBe('http://127.0.0.1:7890')

    const [cleared] = normalizeProvidersInput([{
      id: 'openai-compatible',
      name: 'Custom API',
      proxyUrl: '',
    }])
    expect(cleared?.proxyUrl).toBe('')

    const [omitted] = normalizeProvidersInput([{
      id: 'openai-compatible',
      name: 'Custom API',
    }])
    expect(omitted?.proxyUrl).toBeUndefined()

    try {
      normalizeProvidersInput([{
        id: 'openai-compatible',
        name: 'Custom API',
        proxyUrl: 'socks5://127.0.0.1:1080',
      }])
      throw new Error('EXPECTED_PROVIDER_PROXY_URL_INVALID')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).details).toMatchObject({
        code: 'PROVIDER_PROXY_URL_INVALID',
        field: 'providers[0].proxyUrl',
      })
    }
  })

  it('continues to reject identities outside the production catalog', () => {
    try {
      normalizeProvidersInput([{ id: 'unknown-provider', name: 'Unknown' }])
      throw new Error('EXPECTED_PROVIDER_NOT_SUPPORTED')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError)
      const apiError = error as ApiError
      expect(apiError.code).toBe('INVALID_PARAMS')
      expect(apiError.details).toMatchObject({
        code: 'PROVIDER_NOT_SUPPORTED',
        field: 'providers[0].id',
      })
    }
  })
})
