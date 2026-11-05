import { describe, expect, it } from 'vitest'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import {
  PRODUCTION_STAGE_KEYS,
  summarizeProductionStages,
  type ProductionStageResourceRow,
} from '@/lib/workspace-resource/production-stages'

function row(
  id: string,
  schemaId: string,
  status: ProductionStageResourceRow['status'],
): ProductionStageResourceRow {
  return {
    id,
    name: id,
    workspacePath: `${id}.json`,
    status,
    schemaId,
    mediaType: 'text',
    currentVersion: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('summarizeProductionStages', () => {
  it('always returns every stage in production order', () => {
    const stages = summarizeProductionStages([])
    expect(stages.map((stage) => stage.key)).toEqual([...PRODUCTION_STAGE_KEYS])
    expect(stages.every((stage) => stage.status === 'empty')).toBe(true)
  })

  it('counts statuses and prefers the newest ready resource as primary', () => {
    const stages = summarizeProductionStages([
      row('failed-newest', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'failed'),
      row('pending', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'pending'),
      row('ready-newest', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'ready'),
      row('ready-older', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'ready'),
    ])
    const script = stages.find((stage) => stage.key === 'script')
    expect(script).toMatchObject({
      status: 'pending',
      counts: { total: 4, ready: 2, pending: 1, failed: 1, canceled: 0 },
      primaryResourceId: 'ready-newest',
      primaryWorkspacePath: 'ready-newest.json',
    })
    expect(script?.items.map((item) => item.resourceId)).toEqual([
      'failed-newest',
      'pending',
      'ready-newest',
      'ready-older',
    ])
  })

  it('falls back to the newest row when nothing is ready and caps the item list', () => {
    const stages = summarizeProductionStages([
      row('failed-new', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'failed'),
      row('failed-old', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'failed'),
      row('unknown', WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT, 'ready'),
    ], { itemLimit: 1 })
    const script = stages.find((stage) => stage.key === 'script')
    expect(script).toMatchObject({
      status: 'failed',
      counts: { total: 2, ready: 0, pending: 0, failed: 2, canceled: 0 },
      primaryResourceId: 'failed-new',
    })
    expect(script?.items).toHaveLength(1)
  })

  it('groups image assets and final cuts into their stages', () => {
    const stages = summarizeProductionStages([
      row('character', WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE, 'ready'),
      row('render', WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO, 'ready'),
    ])
    expect(stages.find((stage) => stage.key === 'assets')?.counts.total).toBe(1)
    expect(stages.find((stage) => stage.key === 'final')?.status).toBe('ready')
  })
})
