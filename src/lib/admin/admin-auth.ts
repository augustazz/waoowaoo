import { ApiError } from '@/lib/api-errors'

function splitEnvList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function isAdminUserId(userId: string): boolean {
  return splitEnvList(process.env.ADMIN_USER_IDS).includes(userId)
}

export function requireAdminUserId(userId: string): void {
  const adminUserIds = splitEnvList(process.env.ADMIN_USER_IDS)
  if (adminUserIds.length === 0) {
    throw new ApiError('INTERNAL_ERROR', {
      code: 'ADMIN_USER_IDS_MISSING',
    })
  }

  if (!adminUserIds.includes(userId)) {
    throw new ApiError('FORBIDDEN', {
      code: 'ADMIN_USER_REQUIRED',
    })
  }
}
