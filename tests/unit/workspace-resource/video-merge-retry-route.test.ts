import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ requireProjectAuthLight: mocks.auth, isErrorResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => ({ executeProjectAgentOperationFromApi: mocks.execute }))
import { POST } from '@/app/api/projects/[projectId]/resources/[resourceId]/retry/route'

const context = { params: Promise.resolve({ projectId: 'project', resourceId: 'merge' }) }
const request = (body: string) => new NextRequest('http://localhost/api/projects/project/resources/merge/retry', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'merge-retry' }, body,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ session: { user: { id: 'owner' } } })
})

describe('canvas merge retry adapter', () => {
  it('requires project authorization before dispatch', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await POST(request('{"expectedTaskId":"failed-task"}'), context)).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('pins the displayed failed attempt and uses durable assembly without a paid generation plan', async () => {
    const result = { success: true, taskId: 'new-task', resourceId: 'merge' }
    mocks.execute.mockResolvedValue(result)
    const response = await POST(request('{"expectedTaskId":"failed-task"}'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      operationId: 'merge_videos', projectId: 'project', userId: 'owner', source: 'project-ui',
      input: { request: { kind: 'retry', resourceId: 'merge', expectedTaskId: 'failed-task' } },
      requireIdempotencyKey: true,
    }))
  })

  it.each(['{', '{}', '{"expectedTaskId":null}', '{"expectedTaskId":""}', '{"expectedTaskId":"old","resourceId":"other"}'])('rejects invalid or expanded inputs %s', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
