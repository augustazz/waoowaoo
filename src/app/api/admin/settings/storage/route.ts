import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse } from '@/lib/api-auth'
import { requireAdminSession } from '@/lib/admin/require-admin'
import {
  getPublicStorageSettingsState,
  STORAGE_SETTINGS_CONFIG_FILE,
} from '@/lib/runtime-config/storage-settings'
import { deleteRuntimeConfigFile } from '@/lib/runtime-config/files'
import { saveAndVerifyStorageSettings } from '@/lib/storage/settings-service'

export const dynamic = 'force-dynamic'

function toApiError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'STORAGE_SETTINGS_UNKNOWN_ERROR'
  throw new ApiError('INVALID_PARAMS', {
    code: 'STORAGE_SETTINGS_INVALID',
    message,
  })
}

export const GET = apiHandler(async () => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json({
    success: true,
    ...getPublicStorageSettingsState(),
  })
})

export const PUT = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'STORAGE_SETTINGS_BODY_INVALID' })
  }

  try {
    await saveAndVerifyStorageSettings(body)
  } catch (error) {
    toApiError(error)
  }

  return NextResponse.json({
    success: true,
    ...getPublicStorageSettingsState(),
  })
})

export const DELETE = apiHandler(async () => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  deleteRuntimeConfigFile(STORAGE_SETTINGS_CONFIG_FILE)
  return NextResponse.json({
    success: true,
    ...getPublicStorageSettingsState(),
  })
})
