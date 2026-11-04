import { NextRequest, NextResponse } from 'next/server'
import { getPublicDatabaseSettingsState } from '@/lib/runtime-config/database-settings'
import { getPublicStorageSettingsState } from '@/lib/runtime-config/storage-settings'
import {
  isSetupRequired,
  isSetupTokenConfigured,
  isSetupWriteAllowed,
} from '@/lib/runtime-config/setup-access'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const writeAllowed = isSetupWriteAllowed(request)

  // The setup page is reachable before authentication. Only expose connection
  // details once the caller is allowed to edit them (first run or a valid
  // WAO_SETUP_TOKEN); otherwise return just enough state to render the page.
  let database: ReturnType<typeof getPublicDatabaseSettingsState> | {
    source: 'none'
    configured: boolean
    urlMasked: null
    host: null
    port: null
    database: null
    user: null
  }
  let storage: ReturnType<typeof getPublicStorageSettingsState> | {
    source: 'none'
    configured: boolean
    settings: null
  }

  try {
    const state = getPublicDatabaseSettingsState()
    database = writeAllowed
      ? state
      : { ...state, urlMasked: null, host: null, port: null, database: null, user: null }
  } catch {
    // A corrupt encrypted file must not block the recovery page.
    database = {
      source: 'none',
      configured: true,
      urlMasked: null,
      host: null,
      port: null,
      database: null,
      user: null,
    }
  }

  try {
    const state = getPublicStorageSettingsState()
    storage = writeAllowed
      ? state
      : { source: state.source, configured: state.configured, settings: null }
  } catch {
    storage = { source: 'none', configured: false, settings: null }
  }

  return NextResponse.json({
    success: true,
    required: isSetupRequired(),
    writeAllowed,
    tokenRequired: isSetupTokenConfigured(),
    database,
    storage,
  })
}
