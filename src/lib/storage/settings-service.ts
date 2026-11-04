import { getDeploymentConfig } from '@/lib/deployment/config'
import { S3StorageProvider } from '@/lib/storage/providers/s3'
import { toS3StorageConfig } from '@/lib/storage/s3-config'
import {
  getStorageSettingsState,
  normalizeStorageRuntimeSettings,
  saveStorageSettingsFile,
  type StorageRuntimeSettings,
} from '@/lib/runtime-config/storage-settings'

type StorageSettingsInput = Record<string, unknown>

function isRecord(value: unknown): value is StorageSettingsInput {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false' || value === '') return false
  }
  throw new Error('STORAGE_SETTINGS_FIELD_INVALID:forcePathStyle')
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`STORAGE_SETTINGS_FIELD_INVALID:${field}`)
  }
  return value
}

export function resolveStorageSettingsInput(
  input: unknown,
  existing: StorageRuntimeSettings | null,
): StorageRuntimeSettings {
  if (!isRecord(input)) {
    throw new Error('STORAGE_SETTINGS_BODY_INVALID')
  }

  const endpoint = readOptionalString(input.endpoint, 'endpoint') ?? existing?.endpoint
  const uploadEndpoint = readOptionalString(input.uploadEndpoint, 'uploadEndpoint')
    ?? existing?.uploadEndpoint
    ?? endpoint
  const accessKeyId = readOptionalString(input.accessKeyId, 'accessKeyId') ?? existing?.accessKeyId
  const submittedSecret = readOptionalString(input.secretAccessKey, 'secretAccessKey')
  const secretAccessKey = submittedSecret?.trim()
    ? submittedSecret
    : existing?.secretAccessKey
  const clearSessionToken = readOptionalBoolean(input.clearSessionToken) === true
  const submittedSessionToken = readOptionalString(input.sessionToken, 'sessionToken')
  const sessionToken = clearSessionToken
    ? undefined
    : submittedSessionToken?.trim()
      ? submittedSessionToken
      : existing?.sessionToken

  return normalizeStorageRuntimeSettings({
    endpoint,
    uploadEndpoint,
    region: readOptionalString(input.region, 'region') ?? existing?.region,
    bucket: readOptionalString(input.bucket, 'bucket') ?? existing?.bucket,
    forcePathStyle: readOptionalBoolean(input.forcePathStyle) ?? existing?.forcePathStyle,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  })
}

export async function verifyStorageSettings(settings: StorageRuntimeSettings): Promise<void> {
  const { mediaObjectDelivery } = getDeploymentConfig()
  const provider = new S3StorageProvider(toS3StorageConfig(settings, mediaObjectDelivery))
  await provider.verifyReady()
}

export async function saveAndVerifyStorageSettings(input: unknown): Promise<StorageRuntimeSettings> {
  const existing = getStorageSettingsState().settings
  const settings = resolveStorageSettingsInput(input, existing)
  await verifyStorageSettings(settings)
  return saveStorageSettingsFile(settings)
}
