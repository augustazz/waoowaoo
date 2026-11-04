import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse } from '@/lib/api-auth'
import { requireAdminSession } from '@/lib/admin/require-admin'
import { getStorageSettingsState } from '@/lib/runtime-config/storage-settings'
import {
  resolveStorageSettingsInput,
  verifyStorageSettings,
} from '@/lib/storage/settings-service'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'STORAGE_SETTINGS_BODY_INVALID' })
  }

  try {
    const settings = resolveStorageSettingsInput(body, getStorageSettingsState().settings)
    await verifyStorageSettings(settings)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STORAGE_SETTINGS_UNKNOWN_ERROR'
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORAGE_SETTINGS_TEST_FAILED',
      message,
    })
  }

  return NextResponse.json({ success: true })
})
