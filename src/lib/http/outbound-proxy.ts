import { AsyncLocalStorage } from 'node:async_hooks'
import type { Dispatcher } from 'undici'

// Node's built-in fetch accepts an undici dispatcher via this extra init
// field; the DOM-typed RequestInit just doesn't declare it.
type RequestInitWithDispatcher = RequestInit & {
  dispatcher: Dispatcher
}

// Provider invocations can run concurrently, so a per-provider proxy override
// must be scoped to the current async call chain rather than stored globally.
const providerProxyScope = new AsyncLocalStorage<string>()
const proxyDispatcherCache = new Map<string, Dispatcher>()

function readTrimmedEnv(name: string): string | null {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNoProxyEntries(): string[] {
  const raw = readTrimmedEnv('NO_PROXY') ?? readTrimmedEnv('no_proxy')
  return raw
    ? raw.split(',').map((entry) => entry.trim()).filter(Boolean)
    : []
}

export function resolveOutboundProxyUrl(): string | null {
  const scoped = providerProxyScope.getStore()
  if (scoped) return scoped

  return readTrimmedEnv('PROXY_URL')
    ?? readTrimmedEnv('HTTPS_PROXY')
    ?? readTrimmedEnv('https_proxy')
    ?? readTrimmedEnv('HTTP_PROXY')
    ?? readTrimmedEnv('http_proxy')
    ?? readTrimmedEnv('ALL_PROXY')
    ?? readTrimmedEnv('all_proxy')
}

/**
 * Run a provider invocation with an optional per-provider proxy override.
 * When the override is absent or empty the global proxy env fallback is used.
 */
export async function withProviderProxyScope<T>(
  proxyUrl: string | null | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const trimmed = typeof proxyUrl === 'string' ? proxyUrl.trim() : ''
  if (!trimmed) return await operation()
  return await providerProxyScope.run(trimmed, operation)
}

function readFetchInputUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return null
}

function defaultPort(protocol: string): string {
  if (protocol === 'https:') return '443'
  if (protocol === 'http:') return '80'
  return ''
}

function parseNoProxyEntry(entry: string): { host: string; port?: string } | null {
  const trimmed = entry.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed === '*') return { host: '*' }

  let value = trimmed
  if (value.includes('://')) {
    try {
      value = new URL(value).host.toLowerCase()
    } catch {
      return null
    }
  }
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']')
    if (closingBracket === -1) return null
    const host = value.slice(1, closingBracket)
    const portText = value.slice(closingBracket + 1)
    const port = portText.startsWith(':') ? portText.slice(1) : ''
    return port ? { host, port } : { host }
  }

  const colonCount = value.split(':').length - 1
  if (colonCount === 1) {
    const [host, port] = value.split(':') as [string, string]
    return port ? { host, port } : { host }
  }
  return { host: value }
}

function matchesNoProxy(hostname: string, port: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return readNoProxyEntries().some((entry) => {
    const parsed = parseNoProxyEntry(entry)
    if (!parsed) return false
    if (parsed.host === '*') return true
    if (parsed.port && parsed.port !== port) return false
    if (parsed.host.startsWith('.')) return normalizedHost.endsWith(parsed.host)
    return normalizedHost === parsed.host || normalizedHost.endsWith(`.${parsed.host}`)
  })
}

export function shouldProxyProviderUrl(input: RequestInfo | URL): boolean {
  const rawUrl = readFetchInputUrl(input)
  if (!rawUrl) return false
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    if (matchesNoProxy(parsed.hostname, parsed.port || defaultPort(parsed.protocol))) return false
    return true
  } catch {
    return false
  }
}

async function resolveProxyDispatcher(): Promise<Dispatcher | null> {
  const proxyUrl = resolveOutboundProxyUrl()
  if (!proxyUrl) return null
  const cached = proxyDispatcherCache.get(proxyUrl)
  if (cached) return cached

  const { ProxyAgent } = await import('undici')
  const dispatcher = new ProxyAgent(proxyUrl)
  proxyDispatcherCache.set(proxyUrl, dispatcher)
  return dispatcher
}

export async function fetchWithProviderProxy(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const proxy = shouldProxyProviderUrl(input) ? await resolveProxyDispatcher() : null
  if (!proxy) return await fetch(input, init)

  // Proxied and direct requests must share Node's built-in fetch: the npm
  // undici copy rejects globals like FormData from Node's bundled undici by
  // identity, silently serialising multipart bodies to nothing on the wire.
  const requestInit: RequestInitWithDispatcher = {
    ...(init ?? {}),
    dispatcher: proxy,
  }
  return await fetch(input, requestInit)
}

export async function withProviderProxyDispatcher<T>(
  targetUrl: RequestInfo | URL,
  operation: () => Promise<T>,
): Promise<T> {
  if (!shouldProxyProviderUrl(targetUrl)) return await operation()
  const proxy = await resolveProxyDispatcher()
  if (!proxy) return await operation()

  const { getGlobalDispatcher, setGlobalDispatcher } = await import('undici')
  const previousDispatcher = getGlobalDispatcher()
  setGlobalDispatcher(proxy)
  try {
    return await operation()
  } finally {
    setGlobalDispatcher(previousDispatcher)
  }
}
