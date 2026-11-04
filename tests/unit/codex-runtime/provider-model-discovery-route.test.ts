import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: mocks.auth,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => ({ executeProjectAgentOperationFromApi: mocks.execute }))

import { POST } from '@/app/api/user/api-config/provider-models/route'

function request(body: string) {
  return new NextRequest('http://localhost/api/user/api-config/provider-models', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
}
const context = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ session: { user: { id: 'session-user' } } })
})

describe('provider model discovery route', () => {
  it('requires a signed-in user before any upstream request', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await POST(request('{}'), context)).status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('uses the authenticated user and returns only the discovery result', async () => {
    mocks.execute.mockResolvedValue({ models: [{ id: 'local-image', types: ['image'] }] })
    const response = await POST(request(JSON.stringify({ providerId: 'openai-compatible:local' })), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ models: [{ id: 'local-image', types: ['image'] }] })
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'api_user_api_config_list_provider_models', userId: 'session-user',
      input: { providerId: 'openai-compatible:local' },
    }))
  })

  it('rejects malformed JSON without executing discovery', async () => {
    expect((await POST(request('{'), context)).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
