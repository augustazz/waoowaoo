'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { Link } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'

type SettingsSource = 'file' | 'env' | 'none'

interface SetupStatus {
  success: boolean
  required: boolean
  writeAllowed: boolean
  tokenRequired: boolean
  database: {
    source: SettingsSource
    configured: boolean
    urlMasked: string | null
  }
  storage: {
    source: SettingsSource
    configured: boolean
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readSource(value: unknown): SettingsSource {
  return value === 'file' || value === 'env' ? value : 'none'
}

function readSetupStatus(value: unknown): SetupStatus | null {
  if (!isRecord(value) || value.success !== true) return null
  const database = isRecord(value.database)
    ? {
        source: readSource(value.database.source),
        configured: value.database.configured === true,
        urlMasked: typeof value.database.urlMasked === 'string' ? value.database.urlMasked : null,
      }
    : { source: 'none' as const, configured: false, urlMasked: null }
  const storage = isRecord(value.storage)
    ? {
        source: readSource(value.storage.source),
        configured: value.storage.configured === true,
      }
    : { source: 'none' as const, configured: false }
  return {
    success: true,
    required: value.required === true,
    writeAllowed: value.writeAllowed === true,
    tokenRequired: value.tokenRequired === true,
    database,
    storage,
  }
}

function readErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback
  const error = isRecord(value.error) ? value.error : null
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  return message || fallback
}

export default function SetupClient() {
  const t = useTranslations('profile.setup')
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [restartRequired, setRestartRequired] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch('/api/setup/status', {
        headers: setupToken.trim() ? { 'x-setup-token': setupToken.trim() } : undefined,
      })
      const payload: unknown = await response.json().catch(() => null)
      const parsed = readSetupStatus(payload)
      if (!response.ok || !parsed) throw new Error(readErrorMessage(payload, t('loadFailed')))
      setStatus(parsed)
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('loadFailed'),
      })
    } finally {
      setLoading(false)
    }
  }, [setupToken, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Load the setup snapshot once on mount.
    void loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setupToken is submitted explicitly by the user.
  }, [])

  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(setupToken.trim() ? { 'x-setup-token': setupToken.trim() } : {}),
  })

  const testDatabase = async () => {
    setBusy('test')
    setMessage(null)
    try {
      const response = await apiFetch('/api/setup/database/test', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ url: databaseUrl }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readErrorMessage(payload, t('testFailed')))
      setMessage({ type: 'success', text: t('testSuccess') })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : t('testFailed') })
    } finally {
      setBusy(null)
    }
  }

  const saveDatabase = async () => {
    setBusy('save')
    setMessage(null)
    try {
      const response = await apiFetch('/api/setup/database', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ url: databaseUrl }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readErrorMessage(payload, t('saveFailed')))
      setRestartRequired(true)
      setMessage({ type: 'success', text: t('saveSuccess') })
      await loadStatus()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : t('saveFailed') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-start justify-center px-6 py-16">
      <div className="glass-surface-elevated w-full overflow-hidden">
        <div className="border-b border-[var(--glass-stroke-base)] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[image:var(--glass-cta-gradient)] text-white">
              <AppIcon name="settingsHexAlt" className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-[var(--glass-text-primary)]">{t('title')}</h1>
              <p className="mt-1 text-sm text-[var(--glass-text-secondary)]">{t('description')}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          {loading ? (
            <p className="text-sm text-[var(--glass-text-secondary)]">{t('loading')}</p>
          ) : status ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="glass-surface-soft rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('databaseLabel')}</p>
                  <p className="mt-1 truncate font-mono text-xs text-[var(--glass-text-primary)]">
                    {status.database.urlMasked ?? t(`source.${status.database.source}`)}
                  </p>
                </div>
                <div className="glass-surface-soft rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('storageLabel')}</p>
                  <p className="mt-1 text-xs text-[var(--glass-text-primary)]">
                    {status.storage.configured ? t('configured') : t('notConfigured')}
                  </p>
                </div>
              </div>

              {status.tokenRequired ? (
                <div className="flex items-end gap-2">
                  <label className="block min-w-0 flex-1 space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
                    <span>{t('setupToken')}</span>
                    <input
                      type="password"
                      className="glass-input-base w-full px-3 py-2 text-sm"
                      value={setupToken}
                      onChange={(event) => setSetupToken(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="glass-btn-base glass-btn-soft px-3 py-2 text-xs"
                    onClick={() => { void loadStatus() }}
                    disabled={loading}
                  >
                    {t('verifyToken')}
                  </button>
                </div>
              ) : null}

              {status.writeAllowed ? (
                <>
                  <label className="block space-y-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
                    <span>{t('databaseUrl')}</span>
                    <input
                      type="password"
                      className="glass-input-base w-full px-3 py-2 text-sm"
                      value={databaseUrl}
                      onChange={(event) => setDatabaseUrl(event.target.value)}
                      placeholder="mysql://user:password@db.example.com:3306/waoowaoo"
                      autoComplete="new-password"
                    />
                  </label>
                  <p className="text-xs text-[var(--glass-text-tertiary)]">{t('databaseUrlHint')}</p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="glass-btn-base glass-btn-soft px-3 py-2 text-xs"
                      onClick={() => { void testDatabase() }}
                      disabled={busy !== null || !databaseUrl.trim()}
                    >
                      <AppIcon name="check" className="h-3.5 w-3.5" />
                      {busy === 'test' ? t('testing') : t('test')}
                    </button>
                    <button
                      type="button"
                      className="glass-btn-base glass-btn-primary px-3 py-2 text-xs"
                      onClick={() => { void saveDatabase() }}
                      disabled={busy !== null || !databaseUrl.trim()}
                    >
                      <AppIcon name="check" className="h-3.5 w-3.5" />
                      {busy === 'save' ? t('saving') : t('save')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="rounded-xl bg-[var(--glass-surface-raised)] px-4 py-3 text-sm text-[var(--glass-text-secondary)]">
                    {t('alreadyConfigured')}
                  </p>
                  <Link
                    href="/auth/signin"
                    className="glass-btn-base glass-btn-primary inline-flex px-4 py-2 text-sm"
                  >
                    {t('goToSignIn')}
                  </Link>
                </div>
              )}

              {restartRequired ? (
                <div className="rounded-xl border border-[var(--glass-stroke-strong)] px-4 py-3 text-sm text-[var(--glass-text-primary)]">
                  <p className="font-medium">{t('restartTitle')}</p>
                  <p className="mt-1 text-[var(--glass-text-secondary)]">{t('restartDescription')}</p>
                </div>
              ) : null}

              {message ? (
                <p
                  className={`rounded-xl px-4 py-3 text-sm ${
                    message.type === 'success'
                      ? 'text-[var(--glass-text-primary)]'
                      : 'text-[var(--glass-tone-danger-fg)]'
                  }`}
                >
                  {message.text}
                </p>
              ) : null}

              <p className="text-xs text-[var(--glass-text-tertiary)]">{t('storageHint')}</p>
            </>
          ) : (
            <p className="text-sm text-[var(--glass-tone-danger-fg)]">{message?.text ?? t('loadFailed')}</p>
          )}
        </div>
      </div>
    </main>
  )
}
