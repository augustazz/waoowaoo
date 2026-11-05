import { ApiError } from '@/lib/api-errors'
import { AppError } from '@/lib/errors/app-error'
import { fetchWithProviderProxy, withProviderProxyScope } from '@/lib/http/outbound-proxy'
import { resolveAiProviderManifest } from '@/lib/ai-providers/manifests'
import { captureProviderHttpFailure, readProviderJsonResponse } from '@/lib/ai-providers/failure'
import { normalizeResponsesBaseUrl } from '@/lib/ai-providers/openai-compatible/config'
import { normalizeDiscoveredProviderModels } from '@/lib/ai-providers/openai-compatible/model-discovery'
import { assertUserProviderConfigurationAvailable } from './availability'
import { getProviderConfig } from './runtime-config'

export async function listUserProviderModels(userId: string, providerId: string) {
  assertUserProviderConfigurationAvailable()
  const manifest = resolveAiProviderManifest(providerId)
  if (!manifest.apiConfig?.editableBaseUrl) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROVIDER_MODEL_DISCOVERY_UNSUPPORTED', field: 'providerId' })
  }
  const config = await getProviderConfig(userId, providerId)
  const baseUrl = config.baseUrl
  if (!baseUrl) throw new ApiError('INVALID_PARAMS', { code: 'PROVIDER_BASE_URL_MISSING', field: 'providerId' })
  const response = await withProviderProxyScope(
    config.proxyUrl,
    async () => await fetchWithProviderProxy(`${normalizeResponsesBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    }),
  )
  if (!response.ok) throw await captureProviderHttpFailure({ response, provider: manifest.providerKey, phase: 'connection' })
  const payload = await readProviderJsonResponse({ response, provider: manifest.providerKey, phase: 'connection', maxBytes: 2 * 1024 * 1024 })
  try {
    return { models: normalizeDiscoveredProviderModels(payload) }
  } catch (cause) {
    throw new AppError('EXTERNAL_ERROR', 'Provider returned an invalid model list', { provider: manifest.providerKey, cause })
  }
}
