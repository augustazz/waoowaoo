import { decodeBase64WithLimit, MAX_AUDIO_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { fetchSafeOutboundMediaWithProxyFallback } from '@/lib/media/outbound-fetch'
import { withRetry } from '@/lib/retry'
import { toFetchableUrl } from '@/lib/storage'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function extensionFromAudioMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  return 'mp3'
}

function decodeAudioDataUrl(
  dataUrl: string,
  label: string,
): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:(audio\/[^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  return {
    mimeType: match[1],
    buffer: decodeBase64WithLimit(match[2], MAX_AUDIO_BYTES, label),
  }
}

export async function loadGeneratedAudio(input: {
  audioBase64?: string
  audioUrl?: string
  mimeType?: string
  label: string
  errorPrefix: string
  proxyUrl?: string | null
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const explicitMimeType = readString(input.mimeType) || 'audio/mpeg'
  if (input.audioBase64) {
    return {
      buffer: decodeBase64WithLimit(input.audioBase64, MAX_AUDIO_BYTES, input.label),
      mimeType: explicitMimeType,
    }
  }

  const dataUrl = readString(input.audioUrl)
  if (!dataUrl) throw new Error(`${input.errorPrefix}_EMPTY_AUDIO_RESULT`)
  const decoded = decodeAudioDataUrl(dataUrl, input.label)
  if (decoded) return decoded

  return await withRetry({
    operation: EXTERNAL_OPERATION.MEDIA_DOWNLOAD,
    scope: 'media:generated-audio-download',
    run: async () => {
      const response = await fetchSafeOutboundMediaWithProxyFallback(toFetchableUrl(dataUrl), {
        proxyUrl: input.proxyUrl,
      })
      if (!response.ok) {
        throw new Error(`${input.errorPrefix}_AUDIO_DOWNLOAD_FAILED:${response.status}`)
      }
      return {
        buffer: await readResponseBufferWithLimit(response, MAX_AUDIO_BYTES, input.label),
        mimeType: response.headers.get('content-type') || explicitMimeType,
      }
    },
  })
}
