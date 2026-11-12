import { compiledDeploymentEdition } from '@/lib/edition/current/manifest'
import { editionServer } from '@/lib/edition/current/server'
import {
  readDeploymentEdition,
  type DeploymentEdition,
} from './edition'

export type { DeploymentEdition } from './edition'
export type ProviderCredentialMode = 'user-key' | 'platform-key'
export type MediaObjectDelivery = 'authenticated-proxy' | 'signed-https'
export type ProviderMediaInputTransport = 'inline-data-url' | 'public-https'

export interface DeploymentConfig {
  edition: DeploymentEdition
  providerCredentialMode: ProviderCredentialMode
  mediaObjectDelivery: MediaObjectDelivery
  providerMediaInputTransport: ProviderMediaInputTransport
}

const PROVIDER_CREDENTIAL_MODES: ProviderCredentialMode[] = ['user-key', 'platform-key']

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeProviderCredentialMode(value: unknown): ProviderCredentialMode | null {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (!PROVIDER_CREDENTIAL_MODES.includes(normalized as ProviderCredentialMode)) return null
  return normalized as ProviderCredentialMode
}

function readProviderCredentialMode(edition: DeploymentEdition): ProviderCredentialMode {
  const mode = normalizeProviderCredentialMode(process.env.PROVIDER_CREDENTIAL_MODE)
  if (mode) return mode
  if (process.env.PROVIDER_CREDENTIAL_MODE) {
    throw new Error(`PROVIDER_CREDENTIAL_MODE_INVALID: ${process.env.PROVIDER_CREDENTIAL_MODE}`)
  }
  if (edition !== editionServer.edition) {
    throw new Error(
      `DEPLOYMENT_CONTRACT_EDITION_MISMATCH: contract=${editionServer.edition} runtime=${edition}`,
    )
  }
  return editionServer.providerCredentials.defaultMode
}

function readMediaObjectDelivery(edition: DeploymentEdition): MediaObjectDelivery {
  const value = process.env.MEDIA_OBJECT_DELIVERY?.trim()
  if (!value) return edition === 'cloud' ? 'signed-https' : 'authenticated-proxy'
  if (value === 'authenticated-proxy' || value === 'signed-https') return value
  throw new Error('MEDIA_OBJECT_DELIVERY_INVALID: expected authenticated-proxy or signed-https')
}

function readProviderMediaInputTransport(delivery: MediaObjectDelivery): ProviderMediaInputTransport {
  const value = process.env.PROVIDER_MEDIA_INPUT_TRANSPORT?.trim()
  if (!value) return delivery === 'signed-https' ? 'public-https' : 'inline-data-url'
  if (value === 'inline-data-url' || value === 'public-https') return value
  throw new Error('PROVIDER_MEDIA_INPUT_TRANSPORT_INVALID: expected inline-data-url or public-https')
}

export function getDeploymentConfig(): DeploymentConfig {
  const edition = readDeploymentEdition()
  if (edition !== compiledDeploymentEdition) {
    throw new Error(
      `DEPLOYMENT_EDITION_BUILD_MISMATCH: compiled=${compiledDeploymentEdition} runtime=${edition}`,
    )
  }
  if (editionServer.edition !== compiledDeploymentEdition) {
    throw new Error(
      `DEPLOYMENT_BINDING_CONTRACT_MISMATCH: manifest=${compiledDeploymentEdition} contract=${editionServer.edition}`,
    )
  }
  const mediaObjectDelivery = readMediaObjectDelivery(edition)
  return {
    edition,
    providerCredentialMode: readProviderCredentialMode(edition),
    mediaObjectDelivery,
    providerMediaInputTransport: readProviderMediaInputTransport(mediaObjectDelivery),
  }
}

export function isCloudDeployment(config: DeploymentConfig = getDeploymentConfig()): boolean {
  return config.edition === 'cloud'
}

export function isPlatformProviderCredentialMode(config: DeploymentConfig = getDeploymentConfig()): boolean {
  return config.providerCredentialMode === 'platform-key'
}

export function isUserProviderCredentialMode(config: DeploymentConfig = getDeploymentConfig()): boolean {
  return config.providerCredentialMode === 'user-key'
}

export function toPublicDeploymentConfig(config: DeploymentConfig = getDeploymentConfig()) {
  return {
    edition: config.edition,
    providerCredentialMode: config.providerCredentialMode,
    mediaObjectDelivery: config.mediaObjectDelivery,
    providerMediaInputTransport: config.providerMediaInputTransport,
    isCloud: isCloudDeployment(config),
    usesPlatformProviderKeys: isPlatformProviderCredentialMode(config),
  }
}
