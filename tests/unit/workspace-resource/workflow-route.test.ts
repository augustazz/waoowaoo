import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ requireProjectAuthLight: mocks.auth, isErrorResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => ({ executeProjectAgentOperationFromApi: mocks.execute }))
vi.mock('@/lib/workspace-resource/view-service', () => ({ readWorkspaceResource: vi.fn() }))
import { PATCH } from '@/app/api/projects/[projectId]/resources/[resourceId]/route'

const context = { params: Promise.resolve({ projectId: 'project', resourceId: 'image' }) }
const request = (body: string) => new NextRequest('http://localhost/api/projects/project/resources/image', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'workflow-test' }, body,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ session: { user: { id: 'owner' } } })
})
describe('resource workflow participation route', () => {
  it('requires project authorization', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await PATCH(request('{"workflowEnabled":false}'), context)).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each([false, true])('passes workflowEnabled=%s through the canonical operation and returns its receipt', async (workflowEnabled) => {
    const result = { data: { workflowEnabled }, mutationReceipt: { operationId: 'set_resource_workflow' } }
    mocks.execute.mockResolvedValue(result)
    const response = await PATCH(request(JSON.stringify({ workflowEnabled })), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      operationId: 'set_resource_workflow', projectId: 'project', userId: 'owner',
      input: { resourceId: 'image', workflowEnabled }, requireIdempotencyKey: true,
      responseContract: 'operation_mutation_response_v1',
    }))
  })
  it.each(['{', '{}', '{"workflowEnabled":"false"}', '{"workflowEnabled":false,"status":"ready"}'])('rejects invalid input %s', async body => {
    expect((await PATCH(request(body), context)).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
