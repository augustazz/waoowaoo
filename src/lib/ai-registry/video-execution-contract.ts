import { createHash } from 'node:crypto'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { resolveVideoModelAvailability } from './video-availability'
import { canonicalVideoContract } from './video-contracts'
import type { VideoExecutionContract } from './video-execution-contract-schema'
import { ApiError } from '@/lib/api-errors'

export async function captureVideoExecutionContract(userId: string, modelKey: string): Promise<VideoExecutionContract> {
  const provider = modelKey.slice(0, modelKey.indexOf('::'))
  const config = await getProviderConfig(userId, provider)
  const resolved = resolveVideoModelAvailability(modelKey, config)
  if (resolved.reason) throw new ApiError('INVALID_PARAMS', {
    code: 'PRODUCTION_MODEL_CONFIGURATION_UNAVAILABLE', field: 'configuration', reason: resolved.reason,
  })
  return {
    schemaVersion: 1, modelKey,
    protocol: resolved.declaration?.protocol ?? `${provider.split(':')[0]}-video`,
    revision: resolved.declaration?.revision ?? 'native-adapter@1',
    fingerprint: createHash('sha256').update(canonicalVideoContract({
      declaration: resolved.declaration?.fingerprint ?? null,
      video: resolved.video, aspectRatios: resolved.aspectRatios, adapterRevision: 1,
    })).digest('hex'),
    // Deliberately exclude credentials, signed URLs and proxy connection secrets.
    channelFingerprint: createHash('sha256').update(canonicalVideoContract({
      provider, baseUrl: config.baseUrl?.replace(/\/+$/, '') ?? null,
    })).digest('hex'),
  }
}

export async function assertVideoExecutionContract(userId: string, modelKey: string, expected?: VideoExecutionContract): Promise<void> {
  if (!expected) return // Existing tasks predate contract snapshots.
  const current = await captureVideoExecutionContract(userId, modelKey)
  if (canonicalVideoContract(current) !== canonicalVideoContract(expected)) throw new ApiError('INVALID_PARAMS', {
    code: 'VIDEO_EXECUTION_CONTRACT_CHANGED', field: 'configuration',
    message: 'The video channel or capability contract changed. Review and create a new attempt; do not replay under a different contract.',
    agentRetryableAfterCorrection: false,
  })
}
