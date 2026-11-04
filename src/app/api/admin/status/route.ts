import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse } from '@/lib/api-auth'
import { requireAdminSession } from '@/lib/admin/require-admin'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async () => {
  const authResult = await requireAdminSession()
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json({ success: true, isAdmin: true })
})
