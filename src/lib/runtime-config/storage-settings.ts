import { decryptApiKey, encryptApiKey } from '@/lib/crypto-utils'
import { StorageConfigError } from '@/lib/storage/errors'
import {
  getRuntimeConfigFileStat,
  readRuntimeConfigFile,
  writeRuntimeConfigFile,
} from '@/lib/runtime-config/files'

const STORAGE_CONFIG_FILE = 'storage.json'
const STORAGE_CONFIG_VERSION = 1
const DEFAULT_S3_REGION = 'us-east-1'

export interface StorageRuntimeSettings {
  readonly endpoint: string
  readonly uploadEndpoint: string
  readonly region: string
  readonly bucket: string
  readonly forcePathStyle: boolean
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

export type StorageSettingsSource = 'file' | 'env' | 'none'

export interface StorageSettingsState {
  readonly source: StorageSettingsSource
  readonly configured: boolean
  readonly settings: StorageRuntimeSettings | null
}

export interface StorageSettingsPublic {
  readonly endpoint: string
  readonly uploadEndpoint: string
  readonly region: string
  readonly bucket: string
  readonly forcePathStyle: boolean
  readonly accessKeyId: string
  readonly hasSecretAccessKey: boolean
  readonly hasSessionToken: boolean
}

interface StorageSettingsFile {
  readonly version: number
  readonly endpoint: string
  readonly uploadEndpoint: string
  readonly region: string
  readonly bucket: string
  readonly forcePathStyle: boolean
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

let cachedFileSettings: { readonly key: string; readonly settings: StorageRuntimeSettings } | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredString(
  value: unknown,
  field: string,
  options: { readonly allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw new StorageConfigError(`STORAGE_SETTINGS_FIELD_INVALID:${field}`)
  }
  const normalized = value.trim()
  if (!normalized && !options.allowEmpty) {
    throw new StorageConfigError(`STORAGE_SETTINGS_FIELD_REQUIRED:${field}`)
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new StorageConfigError(`STORAGE_SETTINGS_FIELD_INVALID:${field}`)
  }
  return normalized
}

function parseEndpoint(value: unknown, field: string): string {
  const raw = readRequiredString(value, field)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new StorageConfigError(`STORAGE_SETTINGS_ENDPOINT_INVALID:${field}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new StorageConfigError(`STORAGE_SETTINGS_ENDPOINT_PROTOCOL_INVALID:${field}`)
  }
  if (parsed.username || parsed.password) {
    throw new StorageConfigError(`STORAGE_SETTINGS_ENDPOINT_CREDENTIALS_INVALID:${field}`)
  }
  if (parsed.search || parsed.hash) {
    throw new StorageConfigError(`STORAGE_SETTINGS_ENDPOINT_QUERY_INVALID:${field}`)
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new StorageConfigError(`STORAGE_SETTINGS_ENDPOINT_PATH_INVALID:${field}`)
  }
  return parsed.origin
}

function parseBucket(value: unknown): string {
  const bucket = readRequiredString(value, 'bucket')
  if (bucket.length > 255 || /[/\\]/.test(bucket)) {
    throw new StorageConfigError('STORAGE_SETTINGS_BUCKET_INVALID')
  }
  return bucket
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false' || normalized === '') return false
  }
  throw new StorageConfigError('STORAGE_SETTINGS_FORCE_PATH_STYLE_INVALID')
}

export function normalizeStorageRuntimeSettings(input: {
  readonly endpoint: unknown
  readonly uploadEndpoint?: unknown
  readonly region?: unknown
  readonly bucket: unknown
  readonly forcePathStyle?: unknown
  readonly accessKeyId: unknown
  readonly secretAccessKey: unknown
  readonly sessionToken?: unknown
}): StorageRuntimeSettings {
  const endpoint = parseEndpoint(input.endpoint, 'endpoint')
  const uploadEndpoint = input.uploadEndpoint === undefined || input.uploadEndpoint === ''
    ? endpoint
    : parseEndpoint(input.uploadEndpoint, 'uploadEndpoint')
  const region = input.region === undefined || input.region === '' || input.region === null
    ? DEFAULT_S3_REGION
    : readRequiredString(input.region, 'region')
  const accessKeyId = readRequiredString(input.accessKeyId, 'accessKeyId')
  const secretAccessKey = readRequiredString(input.secretAccessKey, 'secretAccessKey')
  const sessionToken = input.sessionToken === undefined || input.sessionToken === null || input.sessionToken === ''
    ? undefined
    : readRequiredString(input.sessionToken, 'sessionToken')

  return {
    endpoint,
    uploadEndpoint,
    region,
    bucket: parseBucket(input.bucket),
    forcePathStyle: input.forcePathStyle === undefined ? false : parseBoolean(input.forcePathStyle),
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  }
}

function parseStorageSettingsFile(value: unknown): StorageRuntimeSettings {
  if (!isRecord(value)) {
    throw new StorageConfigError('STORAGE_SETTINGS_FILE_INVALID')
  }
  if (value.version !== STORAGE_CONFIG_VERSION) {
    throw new StorageConfigError(`STORAGE_SETTINGS_VERSION_UNSUPPORTED:${String(value.version)}`)
  }

  const encryptedSecret = readRequiredString(value.secretAccessKey, 'secretAccessKey')
  const encryptedSessionToken = typeof value.sessionToken === 'string' && value.sessionToken.trim()
    ? value.sessionToken.trim()
    : undefined

  let secretAccessKey: string
  let sessionToken: string | undefined
  try {
    secretAccessKey = decryptApiKey(encryptedSecret)
    sessionToken = encryptedSessionToken ? decryptApiKey(encryptedSessionToken) : undefined
  } catch (error) {
    throw new StorageConfigError(
      `STORAGE_SETTINGS_SECRET_DECRYPT_FAILED:${error instanceof Error ? error.message : 'unknown'}`,
    )
  }

  return normalizeStorageRuntimeSettings({
    endpoint: value.endpoint,
    uploadEndpoint: value.uploadEndpoint,
    region: value.region,
    bucket: value.bucket,
    forcePathStyle: value.forcePathStyle,
    accessKeyId: value.accessKeyId,
    secretAccessKey,
    sessionToken,
  })
}

export function readStorageSettingsFile(): StorageRuntimeSettings | null {
  const stat = getRuntimeConfigFileStat(STORAGE_CONFIG_FILE)
  if (!stat) {
    cachedFileSettings = null
    return null
  }
  if (cachedFileSettings?.key === stat.key) {
    return cachedFileSettings.settings
  }

  const parsed = readRuntimeConfigFile<unknown>(STORAGE_CONFIG_FILE)
  const settings = parseStorageSettingsFile(parsed)
  cachedFileSettings = { key: stat.key, settings }
  return settings
}

export function saveStorageSettingsFile(settings: StorageRuntimeSettings): StorageRuntimeSettings {
  const normalized = normalizeStorageRuntimeSettings(settings)
  const file: StorageSettingsFile = {
    version: STORAGE_CONFIG_VERSION,
    endpoint: normalized.endpoint,
    uploadEndpoint: normalized.uploadEndpoint,
    region: normalized.region,
    bucket: normalized.bucket,
    forcePathStyle: normalized.forcePathStyle,
    accessKeyId: normalized.accessKeyId,
    secretAccessKey: encryptApiKey(normalized.secretAccessKey),
    ...(normalized.sessionToken ? { sessionToken: encryptApiKey(normalized.sessionToken) } : {}),
  }
  writeRuntimeConfigFile(STORAGE_CONFIG_FILE, file)
  cachedFileSettings = null
  return normalized
}

function readEnvStorageSettings(): StorageRuntimeSettings | null {
  const endpoint = process.env.S3_ENDPOINT?.trim()
  const bucket = process.env.S3_BUCKET?.trim()
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null
  }

  const uploadEndpoint = process.env.S3_UPLOAD_ENDPOINT?.trim() || endpoint
  const region = process.env.S3_REGION?.trim() || DEFAULT_S3_REGION
  const rawForcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase()
  const forcePathStyle = rawForcePathStyle === 'true'
  if (rawForcePathStyle && rawForcePathStyle !== 'true' && rawForcePathStyle !== 'false') {
    throw new StorageConfigError('S3_FORCE_PATH_STYLE must be "true" or "false"')
  }

  return normalizeStorageRuntimeSettings({
    endpoint,
    uploadEndpoint,
    region,
    bucket,
    forcePathStyle,
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.S3_SESSION_TOKEN?.trim(),
  })
}

export function getStorageSettingsState(): StorageSettingsState {
  const fileSettings = readStorageSettingsFile()
  if (fileSettings) {
    return { source: 'file', configured: true, settings: fileSettings }
  }
  const envSettings = readEnvStorageSettings()
  if (envSettings) {
    return { source: 'env', configured: true, settings: envSettings }
  }
  return { source: 'none', configured: false, settings: null }
}

export function toPublicStorageSettings(settings: StorageRuntimeSettings): StorageSettingsPublic {
  return {
    endpoint: settings.endpoint,
    uploadEndpoint: settings.uploadEndpoint,
    region: settings.region,
    bucket: settings.bucket,
    forcePathStyle: settings.forcePathStyle,
    accessKeyId: settings.accessKeyId,
    hasSecretAccessKey: settings.secretAccessKey.length > 0,
    hasSessionToken: !!settings.sessionToken,
  }
}

export function getPublicStorageSettingsState(): {
  readonly source: StorageSettingsSource
  readonly configured: boolean
  readonly settings: StorageSettingsPublic | null
} {
  const state = getStorageSettingsState()
  return {
    source: state.source,
    configured: state.configured,
    settings: state.settings ? toPublicStorageSettings(state.settings) : null,
  }
}

export const STORAGE_SETTINGS_CONFIG_FILE = STORAGE_CONFIG_FILE
