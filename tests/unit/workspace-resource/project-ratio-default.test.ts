import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

const mocks = vi.hoisted(() => ({ project: vi.fn(), snapshot: vi.fn(), preference: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  project: { findUnique: mocks.project, findFirst: mocks.snapshot },
  userPreference: { findUnique: mocks.preference },
} }))

import { getProjectModelConfig } from '@/lib/config-service'
import { readProjectVideoRatioSnapshot, requireProjectVideoRatio } from '@/lib/operations/project-video-ratio-policy'
import { resolveGenerationAspectRatio } from '@/lib/workspace-resource/generation-aspect-ratio'
import { createSystemProjectOperations } from '@/lib/operations/domains/project/system-project-ops'
import * as deployment from '@/lib/deployment/config'
import { editionAi } from '@/lib/edition/current/ai'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  mocks.project.mockResolvedValue({ videoRatio: null })
  mocks.snapshot.mockResolvedValue({ videoRatio: null })
  mocks.preference.mockResolvedValue({ capabilityDefaults: null })
})

describe('project frame defaults across creation and planning', () => {
  it.each([false, true])('uses the same legacy default in config and frozen snapshots (platform=%s)', async (platform) => {
    vi.spyOn(deployment, 'isPlatformProviderCredentialMode').mockReturnValue(platform)
    vi.spyOn(editionAi, 'readFixedParameters').mockReturnValue({})
    const config = await getProjectModelConfig('project', 'owner')
    const snapshot = await readProjectVideoRatioSnapshot({ projectId: 'project', userId: 'owner' })
    expect(config.videoRatio).toBe('16:9')
    expect(snapshot).toEqual(requireProjectVideoRatio('16:9'))
    for (const mediaType of ['image', 'video'] as const) {
      expect(resolveGenerationAspectRatio({ mediaType, options: { aspectRatio: '1:1' } }, snapshot.value)).toBe('16:9')
    }
    expect(resolveGenerationAspectRatio({ mediaType: 'audio' }, snapshot.value)).toBeNull()
  })

  it('keeps explicit ratios and fingerprints, rejecting invalid stored values', async () => {
    mocks.project.mockResolvedValue({ videoRatio: '9:16' })
    mocks.snapshot.mockResolvedValue({ videoRatio: '9:16' })
    expect((await getProjectModelConfig('project', 'owner')).videoRatio).toBe('9:16')
    expect(await readProjectVideoRatioSnapshot({ projectId: 'project', userId: 'owner' })).toEqual(requireProjectVideoRatio('9:16'))
    expect(requireProjectVideoRatio(null)).not.toEqual(requireProjectVideoRatio('9:16'))
    expect(() => requireProjectVideoRatio('broken')).toThrow()
    expect(() => requireProjectVideoRatio('')).toThrow()
  })

  it.each([undefined, '9:16'])('persists a usable frame at the canonical project creation boundary (%s)', async (videoRatio) => {
    vi.spyOn(deployment, 'isPlatformProviderCredentialMode').mockReturnValue(false)
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-project', ...data }))
    const transaction = {
      project: { create },
      userPreference: { findUnique: vi.fn(async () => ({ videoResolution: '720p', imageResolution: '2K' })) },
    } as unknown as Prisma.TransactionClient
    const operation = createSystemProjectOperations().create_project
    const input = operation.inputSchema.safeParse({ name: 'New project', ...(videoRatio ? { videoRatio } : {}) })
    if (!input.success) throw new Error('Invalid project input')
    await operation.executeInTransaction!({ userId: 'owner' } as ProjectAgentOperationContext, input.data, transaction, undefined)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      videoRatio: videoRatio ?? '16:9',
    }) }))
  })
})
