import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: mocks.auth,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => ({ executeProjectAgentOperationFromApi: mocks.execute }))

import { PATCH } from '@/app/api/projects/[projectId]/config/route'

const context = { params: Promise.resolve({ projectId: 'owned-project' }) }
const request = (body: string) => new NextRequest('http://localhost/api/projects/owned-project/config', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ session: { user: { id: 'owner' } } })
})

describe('project frame settings route', () => {
  it('checks project ownership before allowing a frame update', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await PATCH(request('{"videoRatio":"9:16"}'), context)).status).toBe(403)
    expect(mocks.auth).toHaveBeenCalledWith('owned-project')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('uses the same canonical configuration operation as the assistant and preserves the cache invalidation receipt', async () => {
    const result = {
      protocol: 'operation_mutation_response_v1', data: { project: { videoRatio: '9:16' } },
      mutationReceipt: { protocol: 'operation_mutation_receipt_v1', operationId: 'update_project_config', changedRefs: [{ kind: 'projectData', projectId: 'owned-project' }] },
    }
    mocks.execute.mockResolvedValue(result)
    const response = await PATCH(request('{"videoRatio":"9:16"}'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      operationId: 'update_project_config', projectId: 'owned-project', userId: 'owner',
      input: { videoRatio: '9:16' }, responseContract: 'operation_mutation_response_v1',
    }))
  })

  it('rejects malformed JSON before writing project settings', async () => {
    expect((await PATCH(request('{'), context)).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
