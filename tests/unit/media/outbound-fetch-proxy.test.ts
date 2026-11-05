import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookup } from 'node:dns/promises'
import {
  fetchSafeOutboundMediaWithProxyFallback,
  resetMediaDownloadReachabilityCacheForTest,
} from '@/lib/media/outbound-fetch'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

const fetchMock = vi.fn<typeof fetch>()
const dnsLookupMock = vi.mocked(lookup)

function dispatcherName(init?: RequestInit): string | undefined {
  return (init as {
    dispatcher?: { constructor?: { name?: string } }
  } | undefined)?.dispatcher?.constructor?.name
}

describe('media download Provider proxy fallback', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    dnsLookupMock.mockReset()
    dnsLookupMock.mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as never,
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('NO_PROXY', '')
    vi.stubEnv('no_proxy', '')
    resetMediaDownloadReachabilityCacheForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uses the Provider proxy when direct origin reachability times out', async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'HEAD') throw new TypeError('fetch failed')
      return new Response('image', { status: 200 })
    })

    const response = await fetchSafeOutboundMediaWithProxyFallback(
      'https://imgen.x.ai/result.png',
      {
        proxyUrl: 'http://host.docker.internal:7890',
        probeTimeoutMs: 1_000,
      },
    )

    expect(response.status).toBe(200)
    const getCall = fetchMock.mock.calls.find(([, init]) => init?.method !== 'HEAD')
    expect(dispatcherName(getCall?.[1])).toBe('ProxyAgent')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1)
  })

  it('keeps the direct path when the origin responds', async () => {
    fetchMock.mockImplementation(async (_input, init) => (
      init?.method === 'HEAD'
        ? new Response(null, { status: 405 })
        : new Response('image', { status: 200 })
    ))

    const response = await fetchSafeOutboundMediaWithProxyFallback(
      'https://imgen.x.ai/result.png',
      {
        proxyUrl: 'http://host.docker.internal:7890',
        probeTimeoutMs: 1_000,
      },
    )

    expect(response.status).toBe(200)
    const getCall = fetchMock.mock.calls.find(([, init]) => init?.method !== 'HEAD')
    expect(dispatcherName(getCall?.[1])).toBe('Agent')
  })

  it('falls back to the Provider proxy when the direct GET fails after a successful probe', async () => {
    let getCalls = 0
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200 })
      getCalls += 1
      if (getCalls === 1) throw new TypeError('fetch failed')
      return new Response('image', { status: 200 })
    })

    const response = await fetchSafeOutboundMediaWithProxyFallback(
      'https://imgen.x.ai/result.png',
      {
        proxyUrl: 'http://host.docker.internal:7890',
        probeTimeoutMs: 1_000,
      },
    )

    expect(response.status).toBe(200)
    const getCallsList = fetchMock.mock.calls.filter(([, init]) => init?.method !== 'HEAD')
    expect(getCallsList).toHaveLength(2)
    expect(dispatcherName(getCallsList[0]?.[1])).toBe('Agent')
    expect(dispatcherName(getCallsList[1]?.[1])).toBe('ProxyAgent')
  })

  it('does not probe when no Provider proxy is configured', async () => {
    fetchMock.mockResolvedValue(new Response('image', { status: 200 }))

    const response = await fetchSafeOutboundMediaWithProxyFallback(
      'https://imgen.x.ai/result.png',
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(dispatcherName(fetchMock.mock.calls[0]?.[1])).toBe('Agent')
  })

  it('reuses the direct reachability result for the same origin', async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'HEAD') throw new TypeError('fetch failed')
      return new Response('image', { status: 200 })
    })

    await fetchSafeOutboundMediaWithProxyFallback('https://imgen.x.ai/first.png', {
      proxyUrl: 'http://host.docker.internal:7890',
      probeTimeoutMs: 1_000,
    })
    await fetchSafeOutboundMediaWithProxyFallback('https://imgen.x.ai/second.png', {
      proxyUrl: 'http://host.docker.internal:7890',
      probeTimeoutMs: 1_000,
    })

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1)
  })

  it('honors NO_PROXY for media downloads', async () => {
    vi.stubEnv('NO_PROXY', 'imgen.x.ai')
    vi.stubEnv('no_proxy', 'imgen.x.ai')
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(fetchSafeOutboundMediaWithProxyFallback(
      'https://imgen.x.ai/result.png',
      { proxyUrl: 'http://host.docker.internal:7890' },
    )).rejects.toThrow('fetch failed')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET')
    expect(dispatcherName(fetchMock.mock.calls[0]?.[1])).toBe('Agent')
  })

  it('does not let a Provider proxy bypass SSRF rejection', async () => {
    await expect(fetchSafeOutboundMediaWithProxyFallback(
      'http://127.0.0.1/result.png',
      { proxyUrl: 'http://host.docker.internal:7890' },
    )).rejects.toMatchObject({ code: 'OUTBOUND_MEDIA_URL_UNSAFE' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
