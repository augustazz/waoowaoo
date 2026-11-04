import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse } from '@/lib/api-auth'
import { requireAdminSession } from '@/lib/admin/require-admin'
import {
  DATABASE_SETTINGS_CONFIG_FILE,
  getPublicDatabaseSettingsState,
  normalizeDatabaseUrl,
  saveDatabaseSettingsFile,
  testDatabaseConnection,
} from '@/lib/runtime-config/database-settings'
import { deleteRuntimeConfigFile } from '@/lib/runtime-config/files'

export const dynamic = 'force-dynamic'

function readDatabaseUrlFromBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', { code: 'DATABASE_SETTINGS_BODY_INVALID' })
  }
  const record = body as Record<string, unknown>
  try {
    return normalizeDatabaseUrl(record.url)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DATABASE_SETTINGS_URL_INVALID',
      message: error instanceof Error ? error.message : 'DATABASE_SETTINGS_URL_INVALID',
    })
  }
}

export const GET = apiHandler(async () => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json({
    success: true,
    ...getPublicDatabaseSettingsState(),
  })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'DATABASE_SETTINGS_BODY_INVALID' })
  }

  const url = readDatabaseUrlFromBody(body)
  try {
    await testDatabaseConnection(url)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DATABASE_SETTINGS_CONNECTION_FAILED',
      message: error instanceof Error ? error.message : 'DATABASE_SETTINGS_CONNECTION_FAILED',
    })
  }

  saveDatabaseSettingsFile(url)
  return NextResponse.json({
    success: true,
    restartRequired: true,
    ...getPublicDatabaseSettingsState(),
  })
})

export const DELETE = apiHandler(async () => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  deleteRuntimeConfigFile(DATABASE_SETTINGS_CONFIG_FILE)
  return NextResponse.json({
    success: true,
    restartRequired: true,
    ...getPublicDatabaseSettingsState(),
  })
})
