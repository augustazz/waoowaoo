import { NextRequest, NextResponse } from 'next/server'
import { normalizeDatabaseUrl, testDatabaseConnection } from '@/lib/runtime-config/database-settings'
import { isSetupWriteAllowed } from '@/lib/runtime-config/setup-access'

export const dynamic = 'force-dynamic'

function readUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = (body as Record<string, unknown>).url
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

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

  const url = readUrl(body)
  try {
    await testDatabaseConnection(normalizeDatabaseUrl(url))
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

  return NextResponse.json({ success: true })
}
