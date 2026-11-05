import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { generateUniqueKey, toFetchableUrl, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { decodeBase64WithLimit, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { fetchSafeOutboundMediaWithProxyFallback } from '@/lib/media/outbound-fetch'
import { detectMimeFromBuffer } from '@/lib/media/media-mime'
import { probeVideoBufferFacts } from '@/lib/media/probe-video'
import { probeMediaBufferDurationMs } from '@/lib/media/probe-duration'
import { resolveUserUploadAcceptedMedia } from '@/lib/workspace-resource/upload-contract'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withRetry } from '@/lib/retry'

export interface ProcessMediaOptions {
  source: string | Buffer
  type: 'image' | 'video' | 'audio'
  keyPrefix: string
  targetId: string
  downloadHeaders?: Record<string, string>
  proxyUrl?: string | null
  taskArtifact?: { taskId: string; artifact: string }
}

/** Facts describe the bytes actually stored, including inline provider results. */
export async function prepareGeneratedMedia(buffer: Buffer, type: ProcessMediaOptions['type']) {
  const maxBytes = type === 'image' ? MAX_IMAGE_BYTES : type === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error('MEDIA_RESULT_SIZE_INVALID')
  // Every transport enters the same encoder before MIME, extension and hash
  // are assigned. Inline PNG/WebP results cannot be mislabeled as JPEG.
  const stored = type === 'image'
    ? await sharp(buffer).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer()
    : buffer
  return { stored, ...await inspectStoredMedia(stored, type) }
}

/** Inspect persisted bytes without re-encoding them or changing their identity. */
export async function inspectStoredMedia(stored: Buffer, type: ProcessMediaOptions['type']) {
  const maxBytes = type === 'image' ? MAX_IMAGE_BYTES : type === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES
  if (stored.length === 0) throw new Error('MEDIA_RESULT_SIZE_INVALID')
  if (stored.length > maxBytes) throw new Error('MEDIA_RESULT_SIZE_INVALID')
  const accepted = resolveUserUploadAcceptedMedia(detectMimeFromBuffer(stored))
  if (!accepted || accepted.mediaType !== type) throw new Error('MEDIA_RESULT_FORMAT_INVALID')
  const dimensions = type === 'image' ? await sharp(stored).metadata() : null
  const facts = type === 'video'
    ? await probeVideoBufferFacts({ buffer: stored, extension: accepted.extension, stage: 'generated_video_probe' })
    : {
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        durationMs: type === 'audio'
          ? await probeMediaBufferDurationMs({ buffer: stored, extension: accepted.extension, stage: 'generated_audio_probe' })
          : null,
      }
  return {
    extension: accepted.extension,
    metadata: {
      ...facts,
      mimeType: accepted.mimeType,
      sha256: createHash('sha256').update(stored).digest('hex'),
      sizeBytes: stored.length,
    },
  }
}

export async function processMediaResult(options: ProcessMediaOptions) {
  const { source, type, keyPrefix, targetId, downloadHeaders, proxyUrl } = options
  const maxBytes = type === 'image' ? MAX_IMAGE_BYTES : type === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES
  let buffer: Buffer
  if (Buffer.isBuffer(source)) buffer = source
  else if (source.startsWith('data:')) {
    const base64Start = source.indexOf(';base64,')
    if (base64Start === -1) throw new Error('MEDIA_RESULT_DATA_URL_INVALID')
    buffer = decodeBase64WithLimit(source.substring(base64Start + 8), maxBytes, `${type} result`)
  } else {
    buffer = await withRetry({
      operation: EXTERNAL_OPERATION.MEDIA_DOWNLOAD,
      scope: `media:${type}-result-download`,
      run: async () => {
        const response = await fetchSafeOutboundMediaWithProxyFallback(toFetchableUrl(source), {
          headers: downloadHeaders,
          proxyUrl,
        })
        if (!response.ok) throw new Error(`Failed to download ${type}: ${response.status} ${response.statusText}`)
        return await readResponseBufferWithLimit(response, maxBytes, `${type} result`)
      },
    })
  }
  const prepared = await prepareGeneratedMedia(buffer, type)
  const key = options.taskArtifact
    ? buildTaskArtifactStorageKey({ ...options.taskArtifact, extension: prepared.extension })
    : generateUniqueKey(`${keyPrefix}-${targetId}`, prepared.extension)
  const storageKey = await uploadObject(prepared.stored, key, prepared.metadata.mimeType)
  return { storageKey, metadata: prepared.metadata }
}
