import { describeUnknownError } from '@/lib/errors/normalize'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { createScopedLogger } from '@/lib/logging/core'
import { resolveMediaMimeType } from '@/lib/media/media-mime'
import {
  assertSafeOutboundMediaUrl,
  fetchSafeOutboundMedia,
  OutboundMediaSecurityError,
} from '@/lib/media/outbound-fetch'
import {
  OwnedMediaOutboundError,
  resolveOwnedMediaForGeneration,
  projectOwnedMediaForGeneration,
} from '@/lib/media/outbound-owned-media'
import { isOutboundImageStorageKey } from '@/lib/media/storage-key'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { MAX_IMAGE_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { withRetry } from '@/lib/retry'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { DEFAULT_SIGNED_URL_EXPIRES_SECONDS } from '@/lib/storage/utils'

export { detectMimeFromBuffer } from '@/lib/media/media-mime'

type StorageHelpers = Pick<typeof import('@/lib/storage'), 'getSignedObjectUrl' | 'toFetchableUrl' | 'getObjectMetadata' | 'getObjectBuffer'>

type InputIssueReason =
  | 'next_image_unwrapped'
  | 'empty_value_skipped'
  | 'relative_path_rejected'
  | 'non_string_skipped'

export type OutboundImageInputIssue = {
  index: number
  input: unknown
  normalized?: string
  reason: InputIssueReason
}

export type OutboundImageNormalizeStage =
  | 'normalize_original'
  | 'normalize_base64'
  | 'normalize_reference'

export type OutboundImageNormalizeErrorCode =
  | 'OUTBOUND_IMAGE_EMPTY_INPUT'
  | 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT'
  | 'OUTBOUND_IMAGE_UNSAFE_URL'
  | 'OUTBOUND_IMAGE_MEDIA_ROUTE_UNRESOLVED'
  | 'OUTBOUND_IMAGE_FETCH_FAILED'
  | 'OUTBOUND_IMAGE_FETCH_EXCEPTION'
  | 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED'

export class OutboundImageNormalizeError extends Error {
  readonly code: OutboundImageNormalizeErrorCode
  readonly stage: OutboundImageNormalizeStage
  readonly input: string
  override readonly cause?: unknown

  constructor(params: {
    code: OutboundImageNormalizeErrorCode
    stage: OutboundImageNormalizeStage
    input: string
    message: string
    cause?: unknown
  }) {
    super(params.message, { cause: params.cause })
    this.name = 'OutboundImageNormalizeError'
    this.code = params.code
    this.stage = params.stage
    this.input = params.input
    this.cause = params.cause
  }
}

export type OutboundImageNormalizationIssue = {
  index: number
  input: string
  code: OutboundImageNormalizeErrorCode | 'OUTBOUND_IMAGE_UNKNOWN'
  stage: OutboundImageNormalizeStage
  message: string
}

const logger = createScopedLogger({
  module: 'media.outbound-image',
})

const NEXT_IMAGE_PATH = '/_next/image'
const MAX_NEXT_IMAGE_UNWRAP_DEPTH = 6
const SUPPORTED_PROVIDER_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

let storageHelpersPromise: Promise<StorageHelpers> | null = null

async function getStorageHelpers(): Promise<StorageHelpers> {
  if (!storageHelpersPromise) {
    storageHelpersPromise = import('@/lib/storage').then((mod) => ({
      getSignedObjectUrl: mod.getSignedObjectUrl,
      getObjectMetadata: mod.getObjectMetadata,
      getObjectBuffer: mod.getObjectBuffer,
      toFetchableUrl: mod.toFetchableUrl,
    }))
  }
  return await storageHelpersPromise
}

function normalizeInput(input: string): string {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_EMPTY_INPUT',
      stage: 'normalize_original',
      input: String(input ?? ''),
      message: 'outbound image input is empty',
    })
  }
  return value
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

async function assertSafeOutboundHttpUrl(input: string, stage: OutboundImageNormalizeStage): Promise<void> {
  try {
    await assertSafeOutboundMediaUrl(input)
  } catch (error) {
    throw new OutboundImageNormalizeError({
      code: error instanceof OutboundMediaSecurityError
        && error.code === 'OUTBOUND_MEDIA_URL_INVALID'
        ? 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT'
        : 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage,
      input,
      message: error instanceof Error ? error.message : 'outbound image URL validation failed',
      cause: error,
    })
  }
}

function isAbsoluteOrRootPath(value: string): boolean {
  return isHttpUrl(value) || value.startsWith('/')
}

function isStorageKey(value: string): boolean {
  return isOutboundImageStorageKey(value)
}

function isNextImagePath(pathname: string): boolean {
  return pathname === NEXT_IMAGE_PATH || pathname.endsWith(NEXT_IMAGE_PATH)
}

function decodeRepeatedly(raw: string): string {
  let value = raw
  for (let i = 0; i < MAX_NEXT_IMAGE_UNWRAP_DEPTH; i += 1) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) {
        break
      }
      value = decoded
    } catch {
      break
    }
  }
  return value
}

function normalizeUnwrappedTarget(raw: string): string {
  const value = decodeRepeatedly(raw).trim()
  if (!value) return value
  if (isAbsoluteOrRootPath(value) || isDataUrl(value) || isStorageKey(value)) return value
  if (value.startsWith('m/')) return `/${value}`
  if (value.startsWith('api/')) return `/${value}`
  return value
}

function toUrlMaybe(value: string): URL | null {
  try {
    if (isHttpUrl(value)) return new URL(value)
    if (value.startsWith('/')) return new URL(value, 'http://localhost')
  } catch {
    return null
  }
  return null
}

function guessContentType(input: string, contentTypeHeader: string | null, buffer: Uint8Array): string {
  return resolveMediaMimeType(input, contentTypeHeader, buffer)
}

async function signStorageKey(storageKey: string): Promise<string> {
  const { getSignedObjectUrl, toFetchableUrl } = await getStorageHelpers()
  return toFetchableUrl(await getSignedObjectUrl(storageKey, {
    expiresInSeconds: DEFAULT_SIGNED_URL_EXPIRES_SECONDS,
  }))
}

async function toFetchableAbsoluteUrl(value: string): Promise<string> {
  const { toFetchableUrl } = await getStorageHelpers()
  return toFetchableUrl(value)
}

function unwrapNextImageInternal(input: string): string {
  let current = input.trim()
  for (let i = 0; i < MAX_NEXT_IMAGE_UNWRAP_DEPTH; i += 1) {
    const parsed = toUrlMaybe(current)
    if (!parsed || !isNextImagePath(parsed.pathname)) {
      break
    }
    const wrapped = parsed.searchParams.get('url')
    if (!wrapped) {
      break
    }
    const unwrapped = normalizeUnwrappedTarget(wrapped)
    if (!unwrapped || unwrapped === current) {
      break
    }
    current = unwrapped
  }
  return current
}

async function normalizeMediaRouteUrl(input: string): Promise<string | null> {
  const parsed = toUrlMaybe(input)
  if (!parsed || !parsed.pathname.startsWith('/m/')) {
    return null
  }

  const mediaPath = parsed.pathname
  const storageKey = await resolveStorageKeyFromMediaValue(mediaPath)
  if (!storageKey) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_MEDIA_ROUTE_UNRESOLVED',
      stage: 'normalize_original',
      input,
      message: `failed to resolve /m route to storage key: ${mediaPath}`,
    })
  }

  return await signStorageKey(storageKey)
}

async function normalizeStorageSignRouteUrl(input: string): Promise<string | null> {
  const parsed = toUrlMaybe(input)
  if (!parsed || parsed.pathname !== '/api/storage/sign') {
    return null
  }
  const key = parsed.searchParams.get('key')?.trim()
  if (!key || !isStorageKey(key)) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage: 'normalize_original',
      input,
      message: `unsupported storage sign route key: ${key || '<empty>'}`,
    })
  }
  return await signStorageKey(key)
}

export function unwrapNextImageDisplayUrl(input: string): string {
  return unwrapNextImageInternal(input)
}

export async function normalizeToOriginalMediaUrl(input: string): Promise<string> {
  const normalizedInput = normalizeInput(input)
  if (isDataUrl(normalizedInput)) {
    return normalizedInput
  }

  const unwrappedInput = unwrapNextImageInternal(normalizedInput)
  if (unwrappedInput !== normalizedInput) {
    return await normalizeToOriginalMediaUrl(unwrappedInput)
  }

  if (isStorageKey(unwrappedInput)) {
    return await signStorageKey(unwrappedInput)
  }

  const mediaRouteUrl = await normalizeMediaRouteUrl(unwrappedInput)
  if (mediaRouteUrl) {
    return mediaRouteUrl
  }

  const storageSignRouteUrl = await normalizeStorageSignRouteUrl(unwrappedInput)
  if (storageSignRouteUrl) {
    return storageSignRouteUrl
  }

  if (unwrappedInput.startsWith('/')) {
    const rootStorageKey = unwrappedInput.slice(1)
    if (isStorageKey(rootStorageKey)) {
      return await signStorageKey(rootStorageKey)
    }
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage: 'normalize_original',
      input: unwrappedInput,
      message: `unsupported root-relative outbound image input: ${unwrappedInput}`,
    })
  }

  if (isHttpUrl(unwrappedInput)) {
    await assertSafeOutboundHttpUrl(unwrappedInput, 'normalize_original')
    return unwrappedInput
  }

  const storageKey = await resolveStorageKeyFromMediaValue(unwrappedInput)
  if (storageKey) {
    return await signStorageKey(storageKey)
  }

  throw new OutboundImageNormalizeError({
    code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
    stage: 'normalize_original',
    input: unwrappedInput,
    message: `unsupported outbound image input: ${unwrappedInput}`,
  })
}

export async function normalizeToBase64ForGeneration(input: string): Promise<string> {
  const normalizedInput = normalizeInput(input)
  // Trusted callers (including signed chat-attachment admission) already resolve
  // canonical storage identities. Reading bytes must not require publishing the
  // private object as a signed public URL and downloading it back into the server.
  if (isStorageKey(normalizedInput)) {
    const storage = await getStorageHelpers()
    try {
      const metadata = await storage.getObjectMetadata(normalizedInput)
      const sizeBytes = metadata.contentLength
      if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) {
        throw new Error('OUTBOUND_IMAGE_STORAGE_SIZE_INVALID')
      }
      const buffer = await storage.getObjectBuffer(normalizedInput)
      if (buffer.length !== sizeBytes) throw new Error('OUTBOUND_IMAGE_STORAGE_SIZE_CHANGED')
      const mimeType = guessContentType(normalizedInput, metadata.contentType ?? null, buffer)
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch (error) {
      throw new OutboundImageNormalizeError({
        code: 'OUTBOUND_IMAGE_FETCH_EXCEPTION',
        stage: 'normalize_base64',
        input: normalizedInput,
        message: 'Failed to read the canonical outbound image from storage.',
        cause: error,
      })
    }
  }
  const normalizedUrl = await normalizeToOriginalMediaUrl(input)
  if (isDataUrl(normalizedUrl)) {
    return normalizedUrl
  }

  const fetchUrl = await toFetchableAbsoluteUrl(normalizedUrl)

  let downloaded: { buffer: Buffer; contentType: string | null }
  try {
    downloaded = await withRetry({
      operation: EXTERNAL_OPERATION.MEDIA_DOWNLOAD,
      scope: 'media:outbound-image-download',
      run: async () => {
        const response = await fetchSafeOutboundMedia(fetchUrl)
        if (!response.ok) {
          throw new OutboundImageNormalizeError({
            code: 'OUTBOUND_IMAGE_FETCH_FAILED',
            stage: 'normalize_base64',
            input: normalizedUrl,
            message: `normalizeToBase64ForGeneration fetch failed (${response.status}): ${fetchUrl}`,
          })
        }
        return {
          buffer: await readResponseBufferWithLimit(response, MAX_IMAGE_BYTES, 'outbound image'),
          contentType: response.headers.get('content-type'),
        }
      },
    })
  } catch (error) {
    if (error instanceof OutboundImageNormalizeError) {
      throw error
    }
    if (error instanceof OutboundMediaSecurityError) {
      throw new OutboundImageNormalizeError({
        code: 'OUTBOUND_IMAGE_UNSAFE_URL',
        stage: 'normalize_base64',
        input: normalizedUrl,
        message: error.message,
        cause: error,
      })
    }
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_FETCH_EXCEPTION',
      stage: 'normalize_base64',
      input: normalizedUrl,
      message: `normalizeToBase64ForGeneration fetch exception: ${fetchUrl}`,
      cause: error,
    })
  }
  const mimeType = guessContentType(normalizedUrl, downloaded.contentType, downloaded.buffer)
  return `data:${mimeType};base64,${downloaded.buffer.toString('base64')}`
}

/**
 * Worker-owned media is read directly from storage after the same relation-based
 * ownership decision used by the authenticated media routes. This avoids using
 * a browser session or a second internal-auth protocol for background work.
 */
export async function resolveOwnedImageForGeneration(
  input: string,
  userId: string,
  transport: 'inline-data-url' | 'public-https',
): Promise<string> {
  const normalizedInput = normalizeInput(input)
  try {
    const media = await resolveOwnedMediaForGeneration(normalizedInput, userId, {
      maxBytes: MAX_IMAGE_BYTES,
      label: 'owned outbound image',
      supportedMimeTypes: SUPPORTED_PROVIDER_IMAGE_MIME_TYPES,
    })
    return await projectOwnedMediaForGeneration(media, {
      mediaInput: normalizedInput,
      label: 'owned outbound image',
      transport,
    })
  } catch (error) {
    if (error instanceof OwnedMediaOutboundError) {
      throw new OutboundImageNormalizeError({
        code: error.code === 'OWNED_MEDIA_UNSUPPORTED_INPUT'
          ? 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT'
          : 'OUTBOUND_IMAGE_FETCH_FAILED',
        stage: 'normalize_original',
        input: normalizedInput,
        message: error.message,
        cause: error,
      })
    }
    throw error
  }
}

function isOwnedStorageInputCandidate(input: string): boolean {
  const unwrapped = unwrapNextImageInternal(input)
  if (isStorageKey(unwrapped)) return true
  const parsed = toUrlMaybe(unwrapped)
  if (!parsed) return false
  return parsed.pathname.startsWith('/m/')
    || parsed.pathname === '/api/storage/sign'
}

async function normalizeReferenceForGeneration(input: string, ownerUserId?: string): Promise<string> {
  if (ownerUserId && isOwnedStorageInputCandidate(input)) {
    return await resolveOwnedImageForGeneration(
      input,
      ownerUserId,
      getDeploymentConfig().providerMediaInputTransport,
    )
  }
  return await normalizeToBase64ForGeneration(input)
}

function toNormalizationIssue(
  error: unknown,
  input: string,
  index: number,
): OutboundImageNormalizationIssue {
  if (error instanceof OutboundImageNormalizeError) {
    return {
      index,
      input,
      code: error.code,
      stage: error.stage,
      message: error.message,
    }
  }
  return {
    index,
    input,
    code: 'OUTBOUND_IMAGE_UNKNOWN',
    stage: 'normalize_reference',
    message: describeUnknownError(error),
  }
}

export async function normalizeReferenceImagesForGeneration(
  inputs: string[],
  options: {
    onIssue?: (issue: OutboundImageNormalizationIssue) => void
    context?: Record<string, unknown>
    ownerUserId?: string
  } = {},
): Promise<string[]> {
  const seen = new Set<string>()
  const normalized: string[] = []
  let candidateCount = 0
  let firstFailure: unknown

  for (let index = 0; index < inputs.length; index += 1) {
    const item = inputs[index]
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    candidateCount += 1

    try {
      normalized.push(await normalizeReferenceForGeneration(trimmed, options.ownerUserId))
    } catch (error) {
      firstFailure ??= error
      const issue = toNormalizationIssue(error, trimmed, index)
      options.onIssue?.(issue)
      logger.warn({
        message: 'reference image normalize failed',
        details: {
          ...issue,
          context: options.context || null,
        },
      })
    }
  }

  if (candidateCount > 0 && normalized.length === 0) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED',
      stage: 'normalize_reference',
      input: `candidates=${candidateCount}`,
      message: 'all reference images failed to normalize',
      cause: firstFailure,
    })
  }

  return normalized
}

/**
 * 可选参考图归一化（fail-open）：
 * - 仅当“候选非空但全部归一化失败”时（OUTBOUND_IMAGE_REFERENCE_ALL_FAILED）返回 [] 并告警
 * - 其他异常照抛（保持显式失败）
 */
export async function normalizeOptionalReferenceImagesForGeneration(
  inputs: string[],
  options: {
    onIssue?: (issue: OutboundImageNormalizationIssue) => void
    context?: Record<string, unknown>
    ownerUserId?: string
  } = {},
): Promise<string[]> {
  try {
    return await normalizeReferenceImagesForGeneration(inputs, options)
  } catch (error) {
    if (error instanceof OutboundImageNormalizeError && error.code === 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED') {
      logger.warn({
        message: 'optional reference images all failed to normalize (fail-open)',
        details: {
          code: error.code,
          stage: error.stage,
          input: error.input,
          context: options.context || null,
        },
      })
      return []
    }
    throw error
  }
}

export function sanitizeImageInputsForTaskPayload(inputs: unknown[]): {
  normalized: string[]
  issues: OutboundImageInputIssue[]
} {
  const issues: OutboundImageInputIssue[] = []
  const normalized: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < inputs.length; i += 1) {
    const raw = inputs[i]
    if (typeof raw !== 'string') {
      issues.push({ index: i, input: raw, reason: 'non_string_skipped' })
      continue
    }

    const trimmed = raw.trim()
    if (!trimmed) {
      issues.push({ index: i, input: raw, reason: 'empty_value_skipped' })
      continue
    }

    const unwrapped = unwrapNextImageInternal(trimmed)
    if (unwrapped !== trimmed) {
      issues.push({ index: i, input: raw, normalized: unwrapped, reason: 'next_image_unwrapped' })
    }

    if (unwrapped.startsWith('/') && !unwrapped.startsWith('/m/') && !unwrapped.startsWith('/api/')) {
      issues.push({ index: i, input: raw, normalized: unwrapped, reason: 'relative_path_rejected' })
      continue
    }

    if (seen.has(unwrapped)) continue
    seen.add(unwrapped)
    normalized.push(unwrapped)
  }

  return { normalized, issues }
}
