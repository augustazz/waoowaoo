import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ project: vi.fn(), models: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { project: { findFirst: mocks.project } } }))
vi.mock('@/lib/config-service', () => ({ getProjectModelConfig: vi.fn(async () => ({ videoRatio: '16:9', capabilityDefaults: {} })) }))
vi.mock('@/lib/user-api/runtime-config', async (original) => ({
  ...await original<object>(), getUserModels: mocks.models, getProviderConfig: mocks.config,
}))
vi.mock('../../../config/video-model-contracts.json', async () => ({ default: (await import('../../fixtures/video-contract-catalog.json')).default }))

import { readProjectProductionContext } from '@/lib/project-production-context'
import { createWaoMcpToolRegistry } from '@/lib/wao-mcp/tool-registry'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'

const image = { type: 'image', provider: 'openrouter', modelId: 'openai/gpt-image-2', modelKey: 'openrouter::openai/gpt-image-2', name: 'Image', price: 0 }
const native = { type: 'video', provider: 'fal', modelId: 'bytedance/seedance-2.0', modelKey: 'fal::bytedance/seedance-2.0', name: 'Native video', price: 0 }
const compatible = { type: 'video', provider: 'openai-compatible:example', modelId: 'seedance-example-720p', modelKey: 'openai-compatible:example::seedance-example-720p', name: 'Compatible video', price: 0 }
const scope = { projectId: 'project', userId: 'owner' }

beforeEach(() => {
  ensureAiCatalogsRegistered()
  vi.clearAllMocks()
  mocks.project.mockResolvedValue({ id: scope.projectId, name: 'Project', description: null, videoResolution: '720p', imageResolution: '2K' })
})

describe('production context provider isolation', () => {
  it.each([native, compatible])('keeps image tools and project facts when $name credentials cannot be loaded', async (video) => {
    mocks.models.mockResolvedValue([image, video])
    mocks.config.mockRejectedValue(new Error('decrypt failed: sensitive-marker'))
    const context = await readProjectProductionContext(scope)
    expect(context.project.projectId).toBe(scope.projectId)
    expect(context.productionCapabilities.image).toHaveLength(1)
    expect(context.productionCapabilities.video.models).toEqual([])
    expect(context.productionCapabilities.video.unavailableModels).toEqual([
      expect.objectContaining({ model: video.modelKey, reason: 'provider_configuration_invalid' }),
    ])
    const tools = createWaoMcpToolRegistry(context).map((tool) => tool.name)
    expect(tools).toContain('create_image')
    expect(tools).not.toContain('create_video')
    expect(JSON.stringify(context)).not.toContain('sensitive-marker')

    mocks.config.mockResolvedValue({ baseUrl: 'https://video.example.test/v1', apiKey: 'sensitive-marker' })
    const restored = await readProjectProductionContext(scope)
    expect(restored.productionCapabilities.video.models).toHaveLength(1)
    expect(restored.productionCapabilities.video.unavailableModels).toBeUndefined()
    expect(restored.version).not.toBe(context.version)
    expect(JSON.stringify(restored)).not.toContain('sensitive-marker')
  })

  it('does not read video credentials for an image-only configuration', async () => {
    mocks.models.mockResolvedValue([image])
    mocks.config.mockRejectedValue(new Error('must not be read'))
    expect((await readProjectProductionContext(scope)).productionCapabilities.image).toHaveLength(1)
    expect(mocks.config).not.toHaveBeenCalled()
  })
})
