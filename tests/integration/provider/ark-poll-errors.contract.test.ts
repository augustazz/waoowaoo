import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('@/lib/http/outbound-proxy', () => ({
  fetchWithProviderProxy: fetchMock,
  withProviderProxyScope: async (_proxyUrl: string | undefined, operation: () => Promise<unknown>) => await operation(),
}))

const { querySeedanceVideoStatus } = await import('@/lib/ai-providers/ark/poll')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('provider contract - Ark async failure classification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps provider billing distinct from platform balance on a failed job', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'failed',
      error: {
        code: 'AccountOverdueError',
        message: 'AccountOverdueError: provider account requires payment',
      },
    }))

    await expect(querySeedanceVideoStatus('job-1', {
      apiKey: 'ark-key',
      baseUrl: 'https://ark.example/api/v3',
    })).resolves.toMatchObject({
      status: 'failed',
      failure: {
        native: {
          code: 'AccountOverdueError',
          message: 'AccountOverdueError: provider account requires payment',
        },
        interpretation: { code: 'PROVIDER_BILLING_REQUIRED' },
        recovery: { taskReplay: 'forbidden' },
      },
    })
  })

  it('uses the structured provider identity before the HTTP authorization fallback', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: 'AccountOverdueError',
        message: 'provider account requires payment',
      },
    }, 403))

    await expect(querySeedanceVideoStatus('job-2', {
      apiKey: 'ark-key',
      baseUrl: 'https://ark.example/api/v3',
    })).rejects.toMatchObject({
      code: 'PROVIDER_BILLING_REQUIRED',
      provider: 'ark',
      failure: {
        native: { statusCode: 403 },
      },
    })
  })
})
