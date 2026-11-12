import type { S3ClientConfig } from '@aws-sdk/client-s3'
import { getDeploymentConfig, type MediaObjectDelivery, type ProviderMediaInputTransport } from '@/lib/deployment/config'
import { StorageConfigError } from '@/lib/storage/errors'
import {
  getStorageSettingsState,
  normalizeStorageRuntimeSettings,
  type StorageRuntimeSettings,
} from '@/lib/runtime-config/storage-settings'

const DEFAULT_S3_REGION = 'us-east-1'

export type S3StorageConfig = {
  readonly endpoint: string
  readonly uploadEndpoint: string
  readonly region: string
  readonly bucket: string
  readonly forcePathStyle: boolean
  readonly mediaObjectDelivery: MediaObjectDelivery
  readonly providerMediaInputTransport?: ProviderMediaInputTransport
  readonly credentials: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string
  }
}

function parseEndpoint(
  name: string,
  rawEndpoint: string,
  mediaObjectDelivery: MediaObjectDelivery,
): string {
  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    throw new StorageConfigError(`${name} must be a valid absolute URL`)
  }

  const allowedProtocols = mediaObjectDelivery === 'signed-https'
    ? new Set(['https:'])
    : new Set(['http:', 'https:'])
  if (!allowedProtocols.has(endpoint.protocol)) {
    throw new StorageConfigError(
      mediaObjectDelivery === 'signed-https'
        ? `${name} must use HTTPS for signed media delivery`
        : `${name} must use HTTP or HTTPS`,
    )
  }
  if (endpoint.username || endpoint.password) {
    throw new StorageConfigError(`${name} must not contain credentials`)
  }
  if (endpoint.search || endpoint.hash) {
    throw new StorageConfigError(`${name} must not contain query parameters or a fragment`)
  }
  if (endpoint.pathname !== '/' && endpoint.pathname !== '') {
    throw new StorageConfigError(`${name} must not contain a path`)
  }

  return endpoint.origin
}

export function toS3StorageConfig(
  settings: StorageRuntimeSettings,
  mediaObjectDelivery: MediaObjectDelivery,
  providerMediaInputTransport: ProviderMediaInputTransport = mediaObjectDelivery === 'signed-https' ? 'public-https' : 'inline-data-url',
): S3StorageConfig {
  const endpointPolicy = providerMediaInputTransport === 'public-https' ? 'signed-https' : mediaObjectDelivery
  return {
    endpoint: parseEndpoint('S3_ENDPOINT', settings.endpoint, endpointPolicy),
    uploadEndpoint: parseEndpoint(
      'S3_UPLOAD_ENDPOINT',
      settings.uploadEndpoint,
      endpointPolicy,
    ),
    region: settings.region || DEFAULT_S3_REGION,
    bucket: settings.bucket,
    forcePathStyle: settings.forcePathStyle,
    mediaObjectDelivery,
    providerMediaInputTransport,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      ...(settings.sessionToken ? { sessionToken: settings.sessionToken } : {}),
    },
  }
}

export function buildS3StorageConfigFromInput(input: {
  readonly endpoint: unknown
  readonly uploadEndpoint?: unknown
  readonly region?: unknown
  readonly bucket: unknown
  readonly forcePathStyle?: unknown
  readonly accessKeyId: unknown
  readonly secretAccessKey: unknown
  readonly sessionToken?: unknown
}, mediaObjectDelivery: MediaObjectDelivery): S3StorageConfig {
  return toS3StorageConfig(
    normalizeStorageRuntimeSettings({
      endpoint: input.endpoint,
      uploadEndpoint: input.uploadEndpoint,
      region: input.region,
      bucket: input.bucket,
      forcePathStyle: input.forcePathStyle,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      sessionToken: input.sessionToken,
    }),
    mediaObjectDelivery,
  )
}

export function loadS3StorageConfig(): S3StorageConfig {
  const { mediaObjectDelivery, providerMediaInputTransport } = getDeploymentConfig()
  const state = getStorageSettingsState()
  if (!state.configured || !state.settings) {
    throw new StorageConfigError(
      'S3 storage is not configured. Set it in the admin settings page or provide S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.',
    )
  }
  return toS3StorageConfig(state.settings, mediaObjectDelivery, providerMediaInputTransport)
}

export function toS3ClientConfig(config: S3StorageConfig, endpoint: string): S3ClientConfig {
  return {
    endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
    followRegionRedirects: false,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }
}
