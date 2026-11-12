import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { AppError } from '@/lib/errors/app-error'
import { imageReferenceCountIssue } from '@/lib/ai-registry/generation-reference-policy'

export type GoogleContentPart =
  | { inlineData: { mimeType: string; data: string } }
  | { text: string }

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const marker = ';base64,'
  const markerIndex = value.indexOf(marker)
  if (!value.startsWith('data:') || markerIndex === -1) return null
  const mimeType = value.slice(5, markerIndex)
  const base64 = value.slice(markerIndex + marker.length)
  if (!/^image\/[\w.+-]+$/u.test(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64) || Buffer.from(base64, 'base64').length === 0) return null
  return { mimeType, base64 }
}

export function normalizeGeminiImageSize(value: string | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return undefined
  if (normalized === '0.5K') return '512'
  return normalized
}

export function assertAllowedGoogleImageOptions(options: unknown) {
  if (!isPlainObject(options)) {
    throw new Error('GOOGLE_IMAGE_OPTIONS_INVALID: options must be object')
  }

  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'aspectRatio',
    'resolution',
    'referenceImages',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`GOOGLE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

export async function toGoogleInlineData(
  imageSource: string,
): Promise<{ mimeType: string; data: string } | null> {
  const parsedDataUrl = parseDataUrl(imageSource)
  if (parsedDataUrl) {
    return { mimeType: parsedDataUrl.mimeType, data: parsedDataUrl.base64 }
  }

  const base64DataUrl = imageSource.startsWith('data:') ? imageSource : await normalizeToBase64ForGeneration(imageSource)
  const parsedNormalized = parseDataUrl(base64DataUrl)
  if (!parsedNormalized) return null
  return { mimeType: parsedNormalized.mimeType, data: parsedNormalized.base64 }
}

/** Resolve every ordered reference before submission; never shift Prompt image numbers. */
export async function loadGoogleImageReferences(
  references: readonly string[],
  maxImages: number | undefined,
): Promise<GoogleContentPart[]> {
  const issue = imageReferenceCountIssue(maxImages, references.length)
  if (issue) throw new AppError('INVALID_PARAMS', issue.code, { provider: 'google', details: { ...issue } })
  return await Promise.all(references.map(async (source, index): Promise<GoogleContentPart> => {
    try {
      const inlineData = await toGoogleInlineData(source)
      if (!inlineData) throw new Error('IMAGE_REFERENCE_DATA_INVALID')
      return { inlineData }
    } catch (cause) {
      throw new AppError('INVALID_PARAMS', `IMAGE_REFERENCE_READ_FAILED:${String(index + 1)}`, {
        provider: 'google', cause, details: { reasonCode: 'IMAGE_REFERENCE_READ_FAILED', referenceIndex: index + 1 },
      })
    }
  }))
}
