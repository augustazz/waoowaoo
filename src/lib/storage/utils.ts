import { StorageConfigError } from './errors'
import { getInternalBaseUrl } from '@/lib/env'

export const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 2 * 60 * 60

export function resolveBaseUrl(): string {
  return getInternalBaseUrl()
}

export function toFetchableUrl(inputUrl: string): string {
  if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://') || inputUrl.startsWith('data:')) {
    return inputUrl
  }
  if (inputUrl.startsWith('/')) {
    return `${resolveBaseUrl()}${inputUrl}`
  }
  return inputUrl
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new StorageConfigError(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

export function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

export function normalizeKey(raw: string): string {
  return raw.replace(/^\/+/, '')
}

export async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    throw new Error('Empty response body from storage provider')
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }
  if (typeof body === 'string') {
    return Buffer.from(body)
  }

  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<unknown>) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk)
      continue
    }
    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk))
      continue
    }
    chunks.push(Buffer.from(String(chunk)))
  }

  return Buffer.concat(chunks)
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object'
    && value !== null
    && Symbol.asyncIterator in value
    && typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
}

function streamChunkToUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk)
  throw new Error('Unsupported response body chunk from storage provider')
}

export function streamToWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (!body) throw new Error('Empty response body from storage provider')
  if (body instanceof ReadableStream) return body
  if (body instanceof Uint8Array || typeof body === 'string') {
    const chunk = streamChunkToUint8Array(body)
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.close()
      },
    })
  }
  if (!isAsyncIterable(body)) {
    throw new Error('Unsupported response body from storage provider')
  }

  const iterator = body[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(streamChunkToUint8Array(next.value))
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
