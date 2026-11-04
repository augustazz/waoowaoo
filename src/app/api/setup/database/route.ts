import { NextRequest, NextResponse } from 'next/server'
import {
  getPublicDatabaseSettingsState,
  normalizeDatabaseUrl,
  saveDatabaseSettingsFile,
  testDatabaseConnection,
} from '@/lib/runtime-config/database-settings'
import { isSetupWriteAllowed } from '@/lib/runtime-config/setup-access'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isSetupWriteAllowed(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'SETUP_FORBIDDEN', message: 'Setup is already completed.' } },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'DATABASE_SETTINGS_BODY_INVALID', message: 'Invalid request body.' } },
      { status: 400 },
    )
  }

  const rawUrl = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).url
    : null
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return NextResponse.json(
      { success: false, error: { code: 'DATABASE_SETTINGS_URL_REQUIRED', message: 'Database URL is required.' } },
      { status: 400 },
    )
  }

  let url: string
  try {
    url = normalizeDatabaseUrl(rawUrl)
    await testDatabaseConnection(url)
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_SETTINGS_CONNECTION_FAILED',
          message: error instanceof Error ? error.message : 'Database connection failed.',
        },
      },
      { status: 400 },
    )
  }

  saveDatabaseSettingsFile(url)
  return NextResponse.json({
    success: true,
    restartRequired: true,
    database: getPublicDatabaseSettingsState(),
  })
}
