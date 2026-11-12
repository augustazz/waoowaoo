import { describe, expect, it } from 'vitest'
import { parseWorkspaceResourceGenerationTaskPayload, parseWorkspaceResourceGenerationRetrySource } from '@/lib/workspace-resource/generation-contract'

const modelKey = 'openai-compatible:channel::alias'
const contract = { schemaVersion: 1, modelKey, protocol: 'json-videos-v1', revision: 'channel@1/family@1', fingerprint: 'b'.repeat(64), channelFingerprint: 'c'.repeat(64) }
const payload = {
  lifecycleProjection: { resources: [{ resourceId: 'video', mediaType: 'video', schemaId: 'generic.video', name: 'S01' }] },
  protocol: 'workspace_resource_generation_v2', count: 1, videoModel: modelKey,
  generationOptions: { resolution: '720p', aspectRatio: '9:16' }, durationSeconds: 5,
  resource: { resourceId: 'video', workspacePath: '视频/S01', mediaType: 'video', schemaId: 'generic.video', inputHash: 'a'.repeat(64),
    prompt: 'A scene', modelKey, inputs: [], imageInputPositions: [], audioInputPositions: [], videoInputPositions: [], toolCallId: null, sourceTurnId: null },
}

describe('durable video contract snapshots', () => {
  it('preserves the snapshot through worker parsing and retry parsing', () => {
    expect(parseWorkspaceResourceGenerationTaskPayload({ ...payload, videoExecutionContract: contract }).videoExecutionContract).toEqual(contract)
    expect(parseWorkspaceResourceGenerationRetrySource({ ...payload, videoExecutionContract: contract }).videoExecutionContract).toEqual(contract)
  })
  it('keeps older tasks valid and refuses a snapshot for another model or secret fields', () => {
    expect(parseWorkspaceResourceGenerationTaskPayload(payload).videoExecutionContract).toBeUndefined()
    expect(() => parseWorkspaceResourceGenerationTaskPayload({ ...payload, videoExecutionContract: { ...contract, modelKey: 'another::model' } })).toThrow()
    expect(() => parseWorkspaceResourceGenerationTaskPayload({ ...payload, videoExecutionContract: { ...contract, apiKey: 'not-allowed' } })).toThrow()
  })
})
