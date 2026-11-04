import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse } from '@/lib/api-auth'
import { requireAdminSession } from '@/lib/admin/require-admin'
import {
  normalizeDatabaseUrl,
  testDatabaseConnection,
} from '@/lib/runtime-config/database-settings'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'DATABASE_SETTINGS_BODY_INVALID' })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('INVALID_PARAMS', { code: 'DATABASE_SETTINGS_BODY_INVALID' })
  }

  let url: string
  try {
    url = normalizeDatabaseUrl((body as Record<string, unknown>).url)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DATABASE_SETTINGS_URL_INVALID',
      message: error instanceof Error ? error.message : 'DATABASE_SETTINGS_URL_INVALID',
    })
  }

  try {
    await testDatabaseConnection(url)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'DATABASE_SETTINGS_CONNECTION_FAILED',
      message: error instanceof Error ? error.message : 'DATABASE_SETTINGS_CONNECTION_FAILED',
    })
  }

  return NextResponse.json({ success: true })
})
