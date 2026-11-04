import type { NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth, type AuthSession } from '@/lib/api-auth'
import { isAdminUserId, requireAdminUserId } from '@/lib/admin/admin-auth'

export async function requireAdminSession(): Promise<
  { readonly session: AuthSession } | NextResponse
> {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  requireAdminUserId(authResult.session.user.id)
  return authResult
}

export async function readAdminSession(): Promise<AuthSession | null> {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return null
  if (!isAdminUserId(authResult.session.user.id)) return null
  return authResult.session
}
