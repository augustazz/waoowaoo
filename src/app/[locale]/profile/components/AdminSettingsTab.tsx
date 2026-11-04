'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useToast } from '@/contexts/ToastContext'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'

type SettingsSource = 'file' | 'env' | 'none'

interface StorageSettingsPublic {
  endpoint: string
  uploadEndpoint: string
  region: string
  bucket: string
  forcePathStyle: boolean
  accessKeyId: string
  hasSecretAccessKey: boolean
  hasSessionToken: boolean
}

interface StoragePayload {
  success: boolean
  source: SettingsSource
  configured: boolean
  settings: StorageSettingsPublic | null
}

interface DatabasePayload {
  success: boolean
  source: SettingsSource
  configured: boolean
  urlMasked: string | null
  host: string | null
  port: number | null
  database: string | null
  user: string | null
  restartRequired?: boolean
}

interface StorageForm {
  endpoint: string
  uploadEndpoint: string
  region: string
  bucket: string
  forcePathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  clearSessionToken: boolean
}

const EMPTY_STORAGE_FORM: StorageForm = {
  endpoint: '',
  uploadEndpoint: '',
  region: 'us-east-1',
  bucket: '',
  forcePathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  clearSessionToken: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readSource(value: unknown): SettingsSource {
  return value === 'file' || value === 'env' ? value : 'none'
}

function readStoragePayload(value: unknown): StoragePayload | null {
  if (!isRecord(value) || value.success !== true) return null
  const settings = isRecord(value.settings)
    ? {
        endpoint: typeof value.settings.endpoint === 'string' ? value.settings.endpoint : '',
        uploadEndpoint: typeof value.settings.uploadEndpoint === 'string' ? value.settings.uploadEndpoint : '',
        region: typeof value.settings.region === 'string' ? value.settings.region : 'us-east-1',
        bucket: typeof value.settings.bucket === 'string' ? value.settings.bucket : '',
        forcePathStyle: value.settings.forcePathStyle === true,
        accessKeyId: typeof value.settings.accessKeyId === 'string' ? value.settings.accessKeyId : '',
        hasSecretAccessKey: value.settings.hasSecretAccessKey === true,
        hasSessionToken: value.settings.hasSessionToken === true,
      }
    : null
  return {
    success: true,
    source: readSource(value.source),
    configured: value.configured === true,
    settings,
  }
}

function readDatabasePayload(value: unknown): DatabasePayload | null {
  if (!isRecord(value) || value.success !== true) return null
  return {
    success: true,
    source: readSource(value.source),
    configured: value.configured === true,
    urlMasked: typeof value.urlMasked === 'string' ? value.urlMasked : null,
    host: typeof value.host === 'string' ? value.host : null,
    port: typeof value.port === 'number' ? value.port : null,
    database: typeof value.database === 'string' ? value.database : null,
    user: typeof value.user === 'string' ? value.user : null,
    restartRequired: value.restartRequired === true,
  }
}

export default function AdminSettingsTab() {
  const t = useTranslations('profile.adminSettings')
  const { showToast, showError } = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [storage, setStorage] = useState<StoragePayload | null>(null)
  const [database, setDatabase] = useState<DatabasePayload | null>(null)
  const [storageForm, setStorageForm] = useState<StorageForm>(EMPTY_STORAGE_FORM)
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)

  const applyStoragePayload = useCallback((payload: StoragePayload) => {
    setStorage(payload)
    setStorageForm(() => {
      if (!payload.settings) {
        return { ...EMPTY_STORAGE_FORM, secretAccessKey: '', sessionToken: '' }
      }
      return {
        endpoint: payload.settings.endpoint,
        uploadEndpoint: payload.settings.uploadEndpoint,
        region: payload.settings.region,
        bucket: payload.settings.bucket,
        forcePathStyle: payload.settings.forcePathStyle,
        accessKeyId: payload.settings.accessKeyId,
        secretAccessKey: '',
        sessionToken: '',
        clearSessionToken: false,
      }
    })
  }, [])

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const [storageResponse, databaseResponse] = await Promise.all([
        apiFetch('/api/admin/settings/storage'),
        apiFetch('/api/admin/settings/database'),
      ])
      if (!storageResponse.ok) throw await readClientApiError(storageResponse)
      if (!databaseResponse.ok) throw await readClientApiError(databaseResponse)

      const storagePayload = readStoragePayload(await storageResponse.json())
      const databasePayload = readDatabasePayload(await databaseResponse.json())
      if (!storagePayload || !databasePayload) throw new Error('ADMIN_SETTINGS_RESPONSE_INVALID')

      applyStoragePayload(storagePayload)
      setDatabase(databasePayload)
      setDatabaseUrl('')
      setRestartRequired(false)
    } catch (error) {
      showError(error, t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [applyStoragePayload, showError, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Load the admin settings snapshot once on mount.
    void loadSettings()
  }, [loadSettings])

  const updateStorageForm = <Key extends keyof StorageForm>(key: Key, value: StorageForm[Key]) => {
    setStorageForm((previous) => ({ ...previous, [key]: value }))
  }

  const storageRequestBody = () => ({
    endpoint: storageForm.endpoint,
    uploadEndpoint: storageForm.uploadEndpoint,
    region: storageForm.region,
    bucket: storageForm.bucket,
    forcePathStyle: storageForm.forcePathStyle,
    accessKeyId: storageForm.accessKeyId,
    ...(storageForm.secretAccessKey.trim() ? { secretAccessKey: storageForm.secretAccessKey } : {}),
    ...(storageForm.sessionToken.trim() ? { sessionToken: storageForm.sessionToken } : {}),
    clearSessionToken: storageForm.clearSessionToken,
  })

  const testStorage = async () => {
    setBusy('storage-test')
    try {
      const response = await apiFetch('/api/admin/settings/storage/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storageRequestBody()),
      })
      if (!response.ok) throw await readClientApiError(response)
      showToast(t('storage.testSuccess'), 'success')
    } catch (error) {
      showError(error, t('storage.testFailed'))
    } finally {
      setBusy(null)
    }
  }

  const saveStorage = async () => {
    setBusy('storage-save')
    try {
      const response = await apiFetch('/api/admin/settings/storage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storageRequestBody()),
      })
      if (!response.ok) throw await readClientApiError(response)
      const payload = readStoragePayload(await response.json())
      if (!payload) throw new Error('ADMIN_SETTINGS_RESPONSE_INVALID')
      applyStoragePayload(payload)
      showToast(t('storage.saveSuccess'), 'success')
    } catch (error) {
      showError(error, t('storage.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const revertStorage = async () => {
    if (!window.confirm(t('storage.revertConfirm'))) return
    setBusy('storage-revert')
    try {
      const response = await apiFetch('/api/admin/settings/storage', { method: 'DELETE' })
      if (!response.ok) throw await readClientApiError(response)
      const payload = readStoragePayload(await response.json())
      if (!payload) throw new Error('ADMIN_SETTINGS_RESPONSE_INVALID')
      applyStoragePayload(payload)
      showToast(t('storage.revertSuccess'), 'success')
    } catch (error) {
      showError(error, t('storage.revertFailed'))
    } finally {
      setBusy(null)
    }
  }

  const testDatabase = async () => {
    setBusy('database-test')
    try {
      const response = await apiFetch('/api/admin/settings/database/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: databaseUrl }),
      })
      if (!response.ok) throw await readClientApiError(response)
      showToast(t('database.testSuccess'), 'success')
    } catch (error) {
      showError(error, t('database.testFailed'))
    } finally {
      setBusy(null)
    }
  }

  const saveDatabase = async () => {
    setBusy('database-save')
    try {
      const response = await apiFetch('/api/admin/settings/database', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: databaseUrl }),
      })
      if (!response.ok) throw await readClientApiError(response)
      const payload = readDatabasePayload(await response.json())
      if (!payload) throw new Error('ADMIN_SETTINGS_RESPONSE_INVALID')
      setDatabase(payload)
      setDatabaseUrl('')
      setRestartRequired(payload.restartRequired === true)
      showToast(t('database.saveSuccess'), 'success')
    } catch (error) {
      showError(error, t('database.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const revertDatabase = async () => {
    if (!window.confirm(t('database.revertConfirm'))) return
    setBusy('database-revert')
    try {
      const response = await apiFetch('/api/admin/settings/database', { method: 'DELETE' })
      if (!response.ok) throw await readClientApiError(response)
      const payload = readDatabasePayload(await response.json())
      if (!payload) throw new Error('ADMIN_SETTINGS_RESPONSE_INVALID')
      setDatabase(payload)
      setRestartRequired(true)
      showToast(t('database.revertSuccess'), 'success')
    } catch (error) {
      showError(error, t('database.revertFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center px-6 py-16 text-sm text-[var(--glass-text-secondary)]">
        {t('loading')}
      </div>
    )
  }

  const effectiveSource = storage?.source ?? 'none'

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
        <p className="text-sm text-[var(--glass-text-secondary)]">{t('description')}</p>
      </header>

      <section className="glass-surface-soft space-y-4 rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('storage.title')}</h3>
            <p className="mt-1 text-xs text-[var(--glass-text-secondary)]">{t('storage.description')}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--glass-stroke-base)] px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]">
            {t(`source.${effectiveSource}`)}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
            <span>{t('storage.endpoint')}</span>
            <input
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.endpoint}
              onChange={(event) => updateStorageForm('endpoint', event.target.value)}
              placeholder="https://s3.example.com"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
            <span>{t('storage.uploadEndpoint')}</span>
            <input
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.uploadEndpoint}
              onChange={(event) => updateStorageForm('uploadEndpoint', event.target.value)}
              placeholder={t('storage.uploadEndpointPlaceholder')}
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
            <span>{t('storage.bucket')}</span>
            <input
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.bucket}
              onChange={(event) => updateStorageForm('bucket', event.target.value)}
              placeholder="waoowaoo"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
            <span>{t('storage.region')}</span>
            <input
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.region}
              onChange={(event) => updateStorageForm('region', event.target.value)}
              placeholder="us-east-1"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
            <span>{t('storage.accessKeyId')}</span>
            <input
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.accessKeyId}
              onChange={(event) => updateStorageForm('accessKeyId', event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
            <span>{t('storage.secretAccessKey')}</span>
            <input
              type="password"
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.secretAccessKey}
              onChange={(event) => updateStorageForm('secretAccessKey', event.target.value)}
              placeholder={storage?.settings?.hasSecretAccessKey ? t('storage.secretConfigured') : ''}
              autoComplete="new-password"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)] md:col-span-2">
            <span>{t('storage.sessionToken')}</span>
            <input
              type="password"
              className="glass-input-base w-full px-3 py-2 text-sm"
              value={storageForm.sessionToken}
              onChange={(event) => updateStorageForm('sessionToken', event.target.value)}
              placeholder={storage?.settings?.hasSessionToken ? t('storage.sessionTokenConfigured') : ''}
              autoComplete="new-password"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--glass-text-secondary)]">
              <input
                type="checkbox"
                checked={storageForm.forcePathStyle}
                onChange={(event) => updateStorageForm('forcePathStyle', event.target.checked)}
              />
              {t('storage.forcePathStyle')}
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--glass-text-secondary)]">
              <input
                type="checkbox"
                checked={storageForm.clearSessionToken}
                onChange={(event) => updateStorageForm('clearSessionToken', event.target.checked)}
              />
              {t('storage.clearSessionToken')}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="glass-btn-base glass-btn-soft px-3 py-2 text-xs"
              onClick={() => { void testStorage() }}
              disabled={busy !== null}
            >
              <AppIcon name="check" className="h-3.5 w-3.5" />
              {busy === 'storage-test' ? t('testing') : t('storage.test')}
            </button>
            <button
              type="button"
              className="glass-btn-base glass-btn-primary px-3 py-2 text-xs"
              onClick={() => { void saveStorage() }}
              disabled={busy !== null}
            >
              <AppIcon name="check" className="h-3.5 w-3.5" />
              {busy === 'storage-save' ? t('saving') : t('save')}
            </button>
            {storage?.source === 'file' ? (
              <button
                type="button"
                className="glass-btn-base glass-btn-soft px-3 py-2 text-xs"
                onClick={() => { void revertStorage() }}
                disabled={busy !== null}
              >
                {t('storage.revert')}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="glass-surface-soft space-y-4 rounded-2xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('database.title')}</h3>
            <p className="mt-1 text-xs text-[var(--glass-text-secondary)]">{t('database.description')}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--glass-stroke-base)] px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]">
            {t(`source.${database?.source ?? 'none'}`)}
          </span>
        </div>

        {database?.configured ? (
          <p className="rounded-xl bg-[var(--glass-surface-raised)] px-3 py-2 font-mono text-xs text-[var(--glass-text-secondary)]">
            {database.urlMasked}
          </p>
        ) : null}

        <label className="block space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
          <span>{t('database.url')}</span>
          <input
            type="password"
            className="glass-input-base w-full px-3 py-2 text-sm"
            value={databaseUrl}
            onChange={(event) => setDatabaseUrl(event.target.value)}
            placeholder="mysql://user:password@db.example.com:3306/waoowaoo"
            autoComplete="new-password"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--glass-text-tertiary)]">{t('database.restartHint')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="glass-btn-base glass-btn-soft px-3 py-2 text-xs"
              onClick={() => { void testDatabase() }}
              disabled={busy !== null || !databaseUrl.trim()}
            >
              <AppIcon name="check" className="h-3.5 w-3.5" />
              {busy === 'database-test' ? t('testing') : t('database.test')}
            </button>
            <button
              type="button"
              className="glass-btn-base glass-btn-primary px-3 py-2 text-xs"
              onClick={() => { void saveDatabase() }}
              disabled={busy !== null || !databaseUrl.trim()}
            >
              <AppIcon name="check" className="h-3.5 w-3.5" />
              {busy === 'database-save' ? t('saving') : t('save')}
            </button>
            {database?.source === 'file' ? (
              <button
                type="button"
                className="glass-btn-base glass-btn-soft px-3 py-2 text-xs"
                onClick={() => { void revertDatabase() }}
                disabled={busy !== null}
              >
                {t('database.revert')}
              </button>
            ) : null}
          </div>
        </div>

        {restartRequired ? (
          <p className="rounded-xl border border-[var(--glass-stroke-strong)] px-3 py-2 text-xs font-medium text-[var(--glass-text-primary)]">
            {t('database.restartRequired')}
          </p>
        ) : null}
      </section>
    </div>
  )
}
