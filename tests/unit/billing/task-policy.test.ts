import type { Prisma } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import { calcImage } from '@/lib/billing/cost'
import { getBillingMode, getBillingModeSync } from '@/lib/billing/mode'
import { prepareTaskBillingInTransaction, settleTaskBillingInTransaction } from '@/lib/billing/service'
import { requirePlannedTaskBillingInfo } from '@/lib/operations/planning'
import { requiresBillableMediaApproval } from '@/lib/billing/media-approval-policy'
import { parseTaskBillingInfo } from '@/lib/task/billing-info'
import { TASK_TYPE } from '@/lib/task/types'

const model = 'openai-compatible::grok-imagine-image'
const payload = {
  protocol: 'workspace_resource_generation_v2',
  imageModel: model,
  count: 1,
  generationOptions: { aspectRatio: '9:16' },
  lifecycleProjection: { resources: [{ resourceId: 'image-1', mediaType: 'image', schemaId: 'image', name: 'First frame' }] },
  resource: {
    resourceId: 'image-1', workspacePath: 'First frame', mediaType: 'image', schemaId: 'image',
    inputHash: 'a'.repeat(64), prompt: 'Test only', modelKey: model,
    inputs: [], imageInputPositions: [], audioInputPositions: [], videoInputPositions: [],
    toolCallId: null, sourceTurnId: null,
  },
}

beforeEach(() => {
  vi.stubEnv('DEPLOYMENT_EDITION', 'self-hosted')
  vi.stubEnv('BILLING_MODE', 'OFF')
})
afterEach(() => vi.unstubAllEnvs())

describe('task pricing with billing disabled', () => {
  it('plans an unpriced custom image while retaining its model, frame, quantity and approval requirement', () => {
    const billingInfo = requirePlannedTaskBillingInfo({
      taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, payload, allowedApiTypes: ['image'],
    })
    expect(billingInfo).toMatchObject({
      billable: true, apiType: 'image', model, quantity: 1, unit: 'image',
      maxFrozenCost: 0, status: 'skipped', metadata: { aspectRatio: '9:16', referenceImageCount: 0 },
    })
    expect(billingInfo.billable && billingInfo.pricingVersion).toBeUndefined()
    expect(parseTaskBillingInfo(billingInfo, TASK_TYPE.WORKSPACE_RESOURCE_IMAGE)).toEqual(billingInfo)
    expect(requiresBillableMediaApproval(billingInfo)).toBe(true)
  })

  it('prepares and settles an unpriced task without accessing the ledger', async () => {
    const tx = new Proxy({}, { get() { throw new Error('Unexpected ledger access') } }) as Prisma.TransactionClient
    const billingInfo = requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, payload })
    const task = { id: 'task-1', userId: 'test-user', projectId: 'test-project', billingInfo }
    const prepared = await prepareTaskBillingInTransaction(tx, task, 'OFF')
    expect(prepared).toMatchObject({ status: 'skipped', modeSnapshot: 'OFF', maxFrozenCost: 0 })
    const settled = await settleTaskBillingInTransaction(tx, { ...task, billingInfo: prepared })
    expect(settled).toMatchObject({ status: 'skipped', chargedCost: 0, model })
  })

  it.each(['SHADOW', 'ENFORCE'])('still rejects unpriced models in %s mode', mode => {
    vi.stubEnv('BILLING_MODE', mode)
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, payload))
      .toThrow('BILLING_UNKNOWN_MODEL')
  })

  it('refuses a zero-cost OFF snapshot if enforcement is subsequently enabled', async () => {
    const tx = {} as Prisma.TransactionClient
    const billingInfo = requirePlannedTaskBillingInfo({ taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, payload })
    await expect(prepareTaskBillingInTransaction(tx, {
      id: 'task-1', userId: 'test-user', projectId: 'test-project', billingInfo,
    }, 'ENFORCE')).rejects.toThrow('ENFORCE billing requires a positive charge')
  })

  it('still resolves real prices for known models when billing is enabled', () => {
    vi.stubEnv('BILLING_MODE', 'ENFORCE')
    const model = 'openrouter::openai/gpt-image-2'
    const generationOptions = { resolution: '1K', aspectRatio: '16:9', quality: 'medium' }
    const info = buildDefaultTaskBillingInfo(TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, { imageModel: model, generationOptions })
    expect(info).toMatchObject({ status: 'quoted', maxFrozenCost: Math.ceil(calcImage(model, 1, generationOptions)) })
    expect(info?.billable && info.maxFrozenCost).toBeGreaterThan(0)
  })

  it.each([
    { type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO, payload: { videoModel: 'custom::video', durationSeconds: 5 }, apiType: 'video', quantity: 1 },
    { type: TASK_TYPE.WORKSPACE_RESOURCE_VOICE, payload: { voiceModel: 'custom::voice', previewText: 'hello' }, apiType: 'voice', quantity: 5 },
    { type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO, payload: {
      musicModel: 'custom::music', generationOptions: {
        kind: 'music_score_v1', outputFormat: 'mp3', timelineInputPosition: 0,
        startMs: 0, fadeInMs: 0, fadeOutMs: 0, gainDb: 0,
        compositionPlan: { chunks: [{ text: 'Test only', durationMs: 5000, positiveStyles: [], negativeStyles: [], contextAdherence: 'medium' }] },
      },
    }, apiType: 'music', quantity: 1 },
  ])('keeps $apiType task facts without requiring platform pricing', ({ type, payload, apiType, quantity }) => {
    expect(buildDefaultTaskBillingInfo(type, payload)).toMatchObject({ billable: true, apiType, quantity, maxFrozenCost: 0, status: 'skipped' })
  })

  it('still validates task payloads and billing configuration', async () => {
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, { protocol: payload.protocol, imageModel: model }))
      .toThrow()
    vi.stubEnv('BILLING_MODE', 'invalid')
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.WORKSPACE_RESOURCE_IMAGE, payload)).toThrow('BILLING_MODE_INVALID')
    vi.stubEnv('BILLING_MODE', '')
    expect(getBillingModeSync()).toBe('OFF')
    expect(await getBillingMode()).toBe('OFF')
  })
})
