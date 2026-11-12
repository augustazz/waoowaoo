import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findAssets: vi.fn(), modelKey: 'google::gemini-3-pro-image-preview' }))
vi.mock('@/lib/prisma', () => ({ prisma: { workspaceResource: { findMany: mocks.findAssets } } }))
vi.mock('@/lib/project-production-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/project-production-context')>(),
  readProductionPlanningContext: vi.fn(async () => ({ version: 'configuration-v1' })),
}))
vi.mock('@/lib/model-access/production-model', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/model-access/production-model')>(),
  requireProductionModel: vi.fn(() => mocks.modelKey),
}))

import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { createWorkspaceResourceGenerationOperations } from '@/lib/operations/domains/workspace-resource/generation-ops'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { imageGenerationItemSchema } from '@/lib/workspace-resource/generation-request'
import { imageProvenance } from '@/lib/workspace-resource/image-provenance'

const context = { userId: 'user', projectId: 'project', context: {} } as ProjectAgentOperationContext
const asset = (id: string, kind: 'character' | 'location' | 'prop', shotId: string) => ({
  id, currentVersion: 2,
  generationOptions: { imageProvenance: imageProvenance(imageGenerationItemSchema.parse({
    itemId: id, name: id, mediaType: 'image', schemaId: `project.${kind}_image`, assetKind: kind,
    prompt: 'visible design', stableDescription: `${id} stable appearance`, consumedByShots: [shotId],
  }), []) },
})

describe('shot image reference planning', () => {
  beforeEach(() => {
    ensureAiCatalogsRegistered()
    mocks.findAssets.mockReset()
    mocks.modelKey = 'google::gemini-3-pro-image-preview'
  })

  const query = async (shotId: string) => {
    const operation = createWorkspaceResourceGenerationOperations().get_image_reference_plan
    const value = operation.inputSchema.safeParse({ shotId })
    if (!value.success) throw new Error('invalid query input')
    if (!operation.execute) throw new Error('query missing')
    const result = operation.outputSchema.safeParse(await operation.execute(context, value.data))
    if (!result.success) throw new Error('invalid query output')
    return result.data as {
      issue: string | null; recipe: { shotId: string; references: Array<{ resourceId: string; purpose: string; contentVersion: number }> } | null
    }
  }

  it('returns an executable pinned recipe in identity/scene/prop order and filters unusable resources at the query boundary', async () => {
    mocks.findAssets.mockResolvedValue([asset('prop', 'prop', 'K02'), asset('person', 'character', 'K02'), asset('scene', 'location', 'K02'), asset('unrelated', 'character', 'K03')])
    const result = await query('K02')
    expect(result.issue).toBeNull()
    expect(result.recipe?.references.map((reference) => [reference.resourceId, reference.contentVersion, reference.purpose])).toEqual([
      ['person', 2, 'identity'], ['scene', 2, 'scene'], ['prop', 2, 'prop'],
    ])
    expect(mocks.findAssets.mock.calls[0][0].where).toMatchObject({
      userId: 'user', projectId: 'project', status: 'ready', workflowEnabled: true, deletedAt: null,
      alternativeGroupExecutionId: null,
    })
  })

  it('does not return a truncated recipe when characters exceed the model budget', async () => {
    mocks.modelKey = 'google::gemini-2.5-flash-image'
    mocks.findAssets.mockResolvedValue(Array.from({ length: 4 }, (_, index) => asset(`person-${index}`, 'character', 'K02')))
    const result = await query('K02')
    expect(result.issue).toBe('IMAGE_MODEL_REFERENCE_LIMIT_EXCEEDED')
    expect(result.recipe).toBeNull()
  })

  it.each([
    ['google::imagen-4.0-generate-001', 'IMAGE_MODEL_REFERENCE_UNSUPPORTED'],
    ['google::unknown', 'IMAGE_MODEL_REFERENCE_CAPABILITY_UNKNOWN'],
  ])('explains why %s cannot consume the assets', async (modelKey, issue) => {
    mocks.modelKey = modelKey
    mocks.findAssets.mockResolvedValue([asset('person', 'character', 'K02')])
    const result = await query('K02')
    expect(result.issue).toBe(issue)
    expect(result.recipe).toBeNull()
  })

  it('does not infer a reference when no exact shot binding exists', async () => {
    mocks.findAssets.mockResolvedValue([asset('K02-like-name', 'character', 'K03')])
    const result = await query('K02')
    expect(result.issue).toBe('IMAGE_REFERENCE_ASSETS_MISSING')
    expect(result.recipe).toBeNull()
  })
})
