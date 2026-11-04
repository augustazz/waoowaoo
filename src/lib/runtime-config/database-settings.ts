import { decryptApiKey, encryptApiKey } from '@/lib/crypto-utils'
import {
  getRuntimeConfigFileStat,
  readRuntimeConfigFile,
  writeRuntimeConfigFile,
} from '@/lib/runtime-config/files'

const DATABASE_CONFIG_FILE = 'database.json'
const DATABASE_CONFIG_VERSION = 1

export type DatabaseSettingsSource = 'file' | 'env' | 'none'

export interface DatabaseRuntimeSettings {
  readonly url: string
}

export interface DatabaseSettingsState {
  readonly source: DatabaseSettingsSource
  readonly configured: boolean
  readonly url: string | null
}

export interface DatabaseSettingsPublic {
  readonly source: DatabaseSettingsSource
  readonly configured: boolean
  readonly urlMasked: string | null
  readonly host: string | null
  readonly port: number | null
  readonly database: string | null
  readonly user: string | null
}

interface DatabaseSettingsFile {
  readonly version: number
  readonly url: string
}

let cachedFileSettings: { readonly key: string; readonly settings: DatabaseRuntimeSettings } | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeDatabaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('DATABASE_SETTINGS_URL_INVALID')
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('DATABASE_SETTINGS_URL_REQUIRED')
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error('DATABASE_SETTINGS_URL_INVALID')
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('DATABASE_SETTINGS_URL_INVALID')
  }
  if (parsed.protocol !== 'mysql:') {
    throw new Error('DATABASE_SETTINGS_URL_PROTOCOL_INVALID')
  }
  if (!parsed.hostname) {
    throw new Error('DATABASE_SETTINGS_URL_HOST_REQUIRED')
  }
  const database = parsed.pathname.replace(/^\/+/, '')
  if (!database) {
    throw new Error('DATABASE_SETTINGS_URL_DATABASE_REQUIRED')
  }
  return normalized
}

function parseDatabaseSettingsFile(value: unknown): DatabaseRuntimeSettings {
  if (!isRecord(value)) {
    throw new Error('DATABASE_SETTINGS_FILE_INVALID')
  }
  if (value.version !== DATABASE_CONFIG_VERSION) {
    throw new Error(`DATABASE_SETTINGS_VERSION_UNSUPPORTED:${String(value.version)}`)
  }
  if (typeof value.url !== 'string' || !value.url.trim()) {
    throw new Error('DATABASE_SETTINGS_URL_REQUIRED')
  }

  let url: string
  try {
    url = decryptApiKey(value.url.trim())
  } catch (error) {
    throw new Error(
      `DATABASE_SETTINGS_SECRET_DECRYPT_FAILED:${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
  return { url: normalizeDatabaseUrl(url) }
}

export function readDatabaseSettingsFile(): DatabaseRuntimeSettings | null {
  const stat = getRuntimeConfigFileStat(DATABASE_CONFIG_FILE)
  if (!stat) {
    cachedFileSettings = null
    return null
  }
  if (cachedFileSettings?.key === stat.key) {
    return cachedFileSettings.settings
  }

  const parsed = readRuntimeConfigFile<unknown>(DATABASE_CONFIG_FILE)
  const settings = parseDatabaseSettingsFile(parsed)
  cachedFileSettings = { key: stat.key, settings }
  return settings
}

export function saveDatabaseSettingsFile(url: string): DatabaseRuntimeSettings {
  const normalizedUrl = normalizeDatabaseUrl(url)
  const file: DatabaseSettingsFile = {
    version: DATABASE_CONFIG_VERSION,
    url: encryptApiKey(normalizedUrl),
  }
  writeRuntimeConfigFile(DATABASE_CONFIG_FILE, file)
  cachedFileSettings = null
  return { url: normalizedUrl }
}

export function getDatabaseSettingsState(): DatabaseSettingsState {
  const fileSettings = readDatabaseSettingsFile()
  if (fileSettings) {
    return { source: 'file', configured: true, url: fileSettings.url }
  }
  const envUrl = process.env.DATABASE_URL?.trim()
  if (envUrl) {
    return { source: 'env', configured: true, url: normalizeDatabaseUrl(envUrl) }
  }
  return { source: 'none', configured: false, url: null }
}

export function resolveDatabaseUrl(): { readonly url: string; readonly source: DatabaseSettingsSource } | null {
  const state = getDatabaseSettingsState()
  if (!state.configured || !state.url) return null
  return { url: state.url, source: state.source }
}

export function applyDatabaseUrlToProcessEnv(): DatabaseRuntimeSettings | null {
  const fileSettings = readDatabaseSettingsFile()
  if (!fileSettings) return null
  process.env.DATABASE_URL = fileSettings.url
  return fileSettings
}

export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const user = parsed.username ? `${decodeURIComponent(parsed.username)}:` : ''
    const port = parsed.port ? `:${parsed.port}` : ''
    const database = parsed.pathname.replace(/^\/+/, '')
    return `${parsed.protocol}//${user}***@${parsed.hostname}${port}/${database}`
  } catch {
    return '***'
  }
}

export function describeDatabaseUrl(url: string): {
  readonly host: string | null
  readonly port: number | null
  readonly database: string | null
  readonly user: string | null
} {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || null,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
      database: parsed.pathname.replace(/^\/+/, '') || null,
      user: parsed.username ? decodeURIComponent(parsed.username) : null,
    }
  } catch {
    return { host: null, port: null, database: null, user: null }
  }
}

export function getPublicDatabaseSettingsState(): DatabaseSettingsPublic {
  const state = getDatabaseSettingsState()
  if (!state.configured || !state.url) {
    return {
      source: state.source,
      configured: false,
      urlMasked: null,
      host: null,
      port: null,
      database: null,
      user: null,
    }
  }
  return {
    source: state.source,
    configured: true,
    urlMasked: maskDatabaseUrl(state.url),
    ...describeDatabaseUrl(state.url),
  }
}

export async function testDatabaseConnection(url: string): Promise<void> {
  const normalizedUrl = normalizeDatabaseUrl(url)
  const mysql = await import('mysql2/promise')
  const parsed = new URL(normalizedUrl)
  const sslEnabled = isTruthy(parsed.searchParams.get('ssl'))
    || (parsed.searchParams.get('sslaccept') ?? '').toLowerCase() === 'strict'
  const connection = await mysql.createConnection({
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
    user: decoded(parsed.username),
    password: decoded(parsed.password),
    database: parsed.pathname.replace(/^\/+/, ''),
    ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
    connectTimeout: 8000,
  })
  try {
    await connection.query('SELECT 1')
  } finally {
    await connection.end()
  }
}

function decoded(value: string): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isTruthy(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'required'
}

export const DATABASE_SETTINGS_CONFIG_FILE = DATABASE_CONFIG_FILE
