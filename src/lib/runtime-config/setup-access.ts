import type { NextRequest } from 'next/server'
import { getDatabaseSettingsState } from '@/lib/runtime-config/database-settings'

function readSetupToken(): string {
  return process.env.WAO_SETUP_TOKEN?.trim() ?? ''
}

function readRequestSetupToken(request: NextRequest): string {
  return request.headers.get('x-setup-token')?.trim() ?? ''
}

export function isSetupRequired(): boolean {
  try {
    return !getDatabaseSettingsState().configured
  } catch {
    return true
  }
}

export function isSetupWriteAllowed(request: NextRequest): boolean {
  const setupToken = readSetupToken()
  if (setupToken) {
    return readRequestSetupToken(request) === setupToken
  }
  try {
    return !getDatabaseSettingsState().configured
  } catch {
    return false
  }
}

export function isSetupTokenConfigured(): boolean {
  return readSetupToken().length > 0
}
