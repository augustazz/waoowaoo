import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { loadS3StorageConfig, toS3ClientConfig, type S3StorageConfig } from '@/lib/storage/s3-config'
import type {
  DeleteObjectsResult,
  ObjectMetadata,
  ObjectByteRange,
  ObjectStreamResult,
  SignedUrlParams,
  StorageProvider,
  UploadObjectParams,
  UploadObjectResult,
} from '@/lib/storage/types'
import {
  normalizeKey,
  streamToBuffer,
  streamToWebStream,
  toFetchableUrl,
} from '@/lib/storage/utils'

const MAX_DELETE_OBJECTS_PER_REQUEST = 1_000
const MAX_SIGNED_URL_EXPIRES_SECONDS = 7 * 24 * 60 * 60

function normalizeSignedUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('S3_SIGNED_URL_INVALID')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('S3_SIGNED_URL_HTTPS_REQUIRED')
  }
  return parsed.toString()
}

function normalizeSignedUrlExpiry(rawExpiry: number): number {
  if (!Number.isInteger(rawExpiry) || rawExpiry <= 0 || rawExpiry > MAX_SIGNED_URL_EXPIRES_SECONDS) {
    throw new Error(`S3_SIGNED_URL_EXPIRY_INVALID:${String(rawExpiry)}`)
  }
  return rawExpiry
}

export class S3StorageProvider implements StorageProvider {
  readonly kind = 's3' as const
  readonly mediaObjectDelivery

  private readonly config: S3StorageConfig
  private readonly client: S3Client
  private readonly uploadClient: S3Client

  constructor(config: S3StorageConfig = loadS3StorageConfig()) {
    this.config = config
    this.mediaObjectDelivery = config.mediaObjectDelivery
    this.client = new S3Client(toS3ClientConfig(config, config.endpoint))
    this.uploadClient = config.uploadEndpoint === config.endpoint
      ? this.client
      : new S3Client(toS3ClientConfig(config, config.uploadEndpoint))
  }

  async verifyReady(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }))
  }

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    const key = normalizeKey(params.key)
    await this.uploadClient.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: params.body,
      ...(params.contentType ? { ContentType: params.contentType } : {}),
    }))
    return { key }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: normalizeKey(key),
    }))
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    const validKeys = keys
      .filter((key) => typeof key === 'string' && key.trim().length > 0)
      .map(normalizeKey)
    let success = 0
    let failed = 0

    for (let index = 0; index < validKeys.length; index += MAX_DELETE_OBJECTS_PER_REQUEST) {
      const batch = validKeys.slice(index, index + MAX_DELETE_OBJECTS_PER_REQUEST)
      const result = await this.client.send(new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: false,
        },
      }))
      const failedInBatch = result.Errors?.length ?? 0
      failed += failedInBatch
      success += batch.length - failedInBatch
    }

    return { success, failed }
  }

  async getSignedObjectUrl(params: SignedUrlParams): Promise<string> {
    if (this.mediaObjectDelivery !== 'signed-https' && this.config.providerMediaInputTransport !== 'public-https') {
      throw new Error('S3_SIGNED_URL_DELIVERY_UNAVAILABLE')
    }
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: normalizeKey(params.key),
        ...(params.responseCacheControl ? { ResponseCacheControl: params.responseCacheControl } : {}),
      }),
      { expiresIn: normalizeSignedUrlExpiry(params.expiresInSeconds) },
    )
    return normalizeSignedUrl(url)
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: normalizeKey(key),
    }))
    return await streamToBuffer(result.Body)
  }

  async getObjectStream(key: string, range?: ObjectByteRange): Promise<ObjectStreamResult> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: normalizeKey(key),
      ...(range ? { Range: `bytes=${String(range.start)}-${String(range.end)}` } : {}),
    }))
    return {
      body: streamToWebStream(result.Body),
      contentType: result.ContentType ?? null,
      contentLength: result.ContentLength ?? null,
      etag: result.ETag ?? null,
      contentRange: result.ContentRange ?? null,
    }
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata> {
    const result = await this.client.send(new HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: normalizeKey(key),
    }))
    return {
      contentType: result.ContentType ?? null,
      contentLength: result.ContentLength ?? null,
    }
  }

  extractStorageKey(input: string | null | undefined): string | null {
    const value = input?.trim()
    if (!value) return null
    if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('/')) {
      if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null
      return normalizeKey(value)
    }

    let parsed: URL
    try {
      parsed = new URL(value, this.config.endpoint)
    } catch {
      return null
    }

    if (parsed.pathname === '/api/storage/sign') {
      const key = parsed.searchParams.get('key')
      return key ? normalizeKey(key) : null
    }

    const endpoint = new URL(this.config.endpoint)
    const path = parsed.pathname.replace(/^\/+/, '')
    const pathStylePrefix = `${this.config.bucket}/`
    if (parsed.origin === endpoint.origin && path.startsWith(pathStylePrefix)) {
      return normalizeKey(path.slice(pathStylePrefix.length))
    }
    if (parsed.protocol === 'https:' && parsed.host === `${this.config.bucket}.${endpoint.host}`) {
      return path ? normalizeKey(path) : null
    }
    return null
  }

  toFetchableUrl(inputUrl: string): string {
    return toFetchableUrl(inputUrl)
  }

  generateUniqueKey(params: { prefix: string; ext: string }): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `images/${params.prefix}-${timestamp}-${random}.${params.ext}`
  }
}
