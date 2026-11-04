import { ensureStorageReady } from '@/lib/storage/bootstrap'
import { getStorageSettingsState } from '@/lib/runtime-config/storage-settings'
import { loadS3StorageConfig } from '@/lib/storage/s3-config'

async function main() {
  const state = getStorageSettingsState()
  if (!state.configured) {
    console.warn(
      '[storage:init] S3 storage is not configured yet. Set it in the admin settings page or provide S3_* environment variables.',
    )
    return
  }

  const config = loadS3StorageConfig()
  await ensureStorageReady()
  console.log(`[storage:init] verified S3-compatible bucket "${config.bucket}" at ${config.endpoint}`)
}

void main().catch((error: unknown) => {
  const config = (() => {
    try {
      return loadS3StorageConfig()
    } catch {
      return null
    }
  })()
  console.error('[storage:init] failed to verify required S3-compatible storage', {
    operation: 'HeadBucket',
    endpoint: config?.endpoint ?? '<invalid>',
    bucket: config?.bucket ?? '<invalid>',
    region: config?.region ?? '<invalid>',
    forcePathStyle: config?.forcePathStyle ?? '<invalid>',
  })
  console.error(error)
  process.exit(1)
})
