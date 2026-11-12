import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { buildS3StorageConfigFromInput, toS3StorageConfig } from '@/lib/storage/s3-config'
import { S3StorageProvider } from '@/lib/storage/providers/s3'
import { resolveEffectiveCapabilitiesByModelKey } from '@/lib/ai-exec/media-input-transport'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeStorageRuntimeSettings } from '@/lib/runtime-config/storage-settings'

describe('external S3 media delivery', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('keeps private proxy and inline transport as the self-hosted default', () => {
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', '')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', '')
    expect(getDeploymentConfig()).toMatchObject({ mediaObjectDelivery: 'authenticated-proxy', providerMediaInputTransport: 'inline-data-url' })
  })

  it('enables signed HTTPS and model references for an explicitly configured external store', () => {
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', 'signed-https')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', '')
    expect(getDeploymentConfig()).toMatchObject({ mediaObjectDelivery: 'signed-https', providerMediaInputTransport: 'public-https' })
    ensureAiCatalogsRegistered()
    expect(resolveEffectiveCapabilitiesByModelKey('video', 'openai-compatible:instance::wan3.0-video-480p')?.video).toMatchObject({ maxReferenceImages: 10, supportedInputModes: ['text_to_video', 'first_frame', 'first_last_frame', 'reference'] })
  })

  it('keeps browser media behind authentication while signing private R2 objects for providers', async () => {
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', 'authenticated-proxy')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'public-https')
    expect(getDeploymentConfig()).toMatchObject({ mediaObjectDelivery: 'authenticated-proxy', providerMediaInputTransport: 'public-https' })
    const settings = normalizeStorageRuntimeSettings({ endpoint: 'https://example.r2.cloudflarestorage.com', region: 'auto', bucket: 'private-test', accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true })
    const provider = new S3StorageProvider(toS3StorageConfig(settings, 'authenticated-proxy', 'public-https'))
    const url = new URL(await provider.getSignedObjectUrl({ key: 'images/character.png', expiresInSeconds: 60 }))
    expect(provider.mediaObjectDelivery).toBe('authenticated-proxy')
    expect(url.protocol).toBe('https:')
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true)
    const local = new S3StorageProvider(toS3StorageConfig(settings, 'authenticated-proxy', 'inline-data-url'))
    await expect(local.getSignedObjectUrl({ key: 'images/character.png', expiresInSeconds: 60 })).rejects.toThrow('S3_SIGNED_URL_DELIVERY_UNAVAILABLE')
    expect(() => toS3StorageConfig({ ...settings, endpoint: 'http://minio:9000' }, 'authenticated-proxy', 'public-https')).toThrow('must use HTTPS')
  })

  it('rejects invalid delivery modes and HTTP storage endpoints in signed delivery mode', () => {
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', 'public')
    expect(() => getDeploymentConfig()).toThrow('MEDIA_OBJECT_DELIVERY_INVALID')
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', '')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'public')
    expect(() => getDeploymentConfig()).toThrow('PROVIDER_MEDIA_INPUT_TRANSPORT_INVALID')
    expect(() => buildS3StorageConfigFromInput({ endpoint: 'http://minio:9000', bucket: 'test', accessKeyId: 'test', secretAccessKey: 'test' }, 'signed-https')).toThrow('must use HTTPS')
  })
})
vi.mock('../../../config/video-model-contracts.json', async () => ({ default: (await import('../../fixtures/video-contract-catalog.json')).default }))
