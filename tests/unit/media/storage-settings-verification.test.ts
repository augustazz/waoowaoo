import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyStorageSettings } from '@/lib/storage/settings-service'
import { normalizeStorageRuntimeSettings } from '@/lib/runtime-config/storage-settings'
import { S3StorageProvider } from '@/lib/storage/providers/s3'

const settings = normalizeStorageRuntimeSettings({
  endpoint: 'https://storage.test', bucket: 'test', accessKeyId: 'test', secretAccessKey: 'test',
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('admin storage verification transport policy', () => {
  it.each(['endpoint', 'uploadEndpoint'] as const)('rejects HTTP %s before checking connectivity when providers require public HTTPS', async (field) => {
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', 'authenticated-proxy')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'public-https')
    const verify = vi.spyOn(S3StorageProvider.prototype, 'verifyReady').mockResolvedValue()
    await expect(verifyStorageSettings({ ...settings, [field]: 'http://minio:9000' })).rejects.toThrow('must use HTTPS')
    expect(verify).not.toHaveBeenCalled()
    await expect(verifyStorageSettings(settings)).resolves.toBeUndefined()
    expect(verify).toHaveBeenCalledOnce()
  })

  it('still accepts local HTTP storage for authenticated proxy with inline provider inputs', async () => {
    vi.stubEnv('MEDIA_OBJECT_DELIVERY', 'authenticated-proxy')
    vi.stubEnv('PROVIDER_MEDIA_INPUT_TRANSPORT', 'inline-data-url')
    const verify = vi.spyOn(S3StorageProvider.prototype, 'verifyReady').mockResolvedValue()
    await expect(verifyStorageSettings({ ...settings, endpoint: 'http://minio:9000', uploadEndpoint: 'http://minio:9000' })).resolves.toBeUndefined()
    expect(verify).toHaveBeenCalledOnce()
  })
})
