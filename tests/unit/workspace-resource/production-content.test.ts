import { describe, expect, it } from 'vitest'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import {
  productionAssetTypeForRow,
  productionContentGroupStatus,
  productionEpisodeNumberFromPath,
  summarizeProductionStepContent,
  type ProductionContentResourceRow,
} from '@/lib/workspace-resource/production-content'

function row(input: {
  readonly id: string
  readonly workspacePath: string
  readonly schemaId?: string
  readonly status?: ProductionContentResourceRow['status']
  readonly mediaType?: ProductionContentResourceRow['mediaType']
}): ProductionContentResourceRow {
  return {
    id: input.id,
    name: input.id,
    workspacePath: input.workspacePath,
    status: input.status ?? 'ready',
    schemaId: input.schemaId ?? WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
    mediaType: input.mediaType ?? 'text',
    currentVersion: 1,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    previewUrl: null,
  }
}

describe('productionEpisodeNumberFromPath', () => {
  it('reads Chinese and English episode labels from any path segment', () => {
    expect(productionEpisodeNumberFromPath('剧本/第01集.json')).toBe(1)
    expect(productionEpisodeNumberFromPath('视频/第 2 集/片段.mp4')).toBe(2)
    expect(productionEpisodeNumberFromPath('剧本/第3集-开场.json')).toBe(3)
    expect(productionEpisodeNumberFromPath('成片/EP04.mp4')).toBe(4)
    expect(productionEpisodeNumberFromPath('成片/episode-5.mp4')).toBe(5)
    expect(productionEpisodeNumberFromPath('剧本/十二集.json')).toBe(12)
  })

  it('accepts bare episode names but ignores year-like numbers', () => {
    expect(productionEpisodeNumberFromPath('剧本/01.json')).toBe(1)
    expect(productionEpisodeNumberFromPath('剧本/01-开场.json')).toBe(1)
    expect(productionEpisodeNumberFromPath('档案/2024总结.json')).toBeNull()
    expect(productionEpisodeNumberFromPath('剧本/序章.json')).toBeNull()
  })
})

describe('summarizeProductionStepContent episodes', () => {
  it('groups by episode, keeps known empty episodes, and orders numerically', () => {
    const groups = summarizeProductionStepContent({
      grouping: 'episode',
      knownEpisodeNumbers: [2, 3],
      rows: [
        row({ id: 'ep1', workspacePath: '剧本/第01集.json' }),
        row({ id: 'ep2', workspacePath: '剧本/第02集.json', status: 'pending' }),
      ],
    })
    expect(groups.map((group) => group.episodeNumber)).toEqual([1, 2, 3])
    expect(groups[0]?.counts).toEqual({ total: 1, ready: 1, pending: 0, failed: 0, canceled: 0 })
    expect(groups[0]?.primaryResourceId).toBe('ep1')
    expect(groups[1]?.status).toBe('in_progress')
    expect(groups[2]).toMatchObject({ counts: { total: 0 }, status: 'empty' })
  })

  it('puts resources without an episode hint into an unassigned group', () => {
    const groups = summarizeProductionStepContent({
      grouping: 'episode',
      rows: [row({ id: 'loose', workspacePath: '创作方向/总纲.json' })],
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ episodeNumber: null, status: 'ready' })
  })

  it('prefers a ready resource as the group primary', () => {
    const groups = summarizeProductionStepContent({
      grouping: 'episode',
      rows: [
        row({ id: 'failed', workspacePath: '视频/第01集/a.mp4', status: 'failed', mediaType: 'video' }),
        row({ id: 'ready', workspacePath: '视频/第01集/b.mp4', status: 'ready', mediaType: 'video' }),
      ],
    })
    expect(groups[0]?.primaryResourceId).toBe('ready')
    expect(groups[0]?.status).toBe('needs_review')
  })
})

describe('summarizeProductionStepContent asset types', () => {
  it('always shows character, location and prop groups', () => {
    const groups = summarizeProductionStepContent({
      grouping: 'asset_type',
      rows: [row({
        id: 'hero',
        workspacePath: '资产/角色/主角.png',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
        mediaType: 'image',
      })],
    })
    expect(groups.map((group) => group.assetTypeKey))
      .toEqual(['character', 'location', 'prop'])
    expect(groups[0]?.counts.total).toBe(1)
    expect(groups[1]?.status).toBe('empty')
  })

  it('falls back to schema and folds unknown assets into other', () => {
    expect(productionAssetTypeForRow({
      workspacePath: '资产/xxx.png',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    })).toBe('location')
    expect(productionAssetTypeForRow({
      workspacePath: '资产/道具/剑.png',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
    })).toBe('prop')
    expect(productionAssetTypeForRow({
      workspacePath: '资产/misc.png',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
    })).toBe('other')
  })
})

describe('productionContentGroupStatus', () => {
  const counts = (input: Partial<{
    total: number
    ready: number
    pending: number
    failed: number
    canceled: number
  }>) => ({
    total: input.total ?? 0,
    ready: input.ready ?? 0,
    pending: input.pending ?? 0,
    failed: input.failed ?? 0,
    canceled: input.canceled ?? 0,
  })

  it('derives group status without implying approval', () => {
    expect(productionContentGroupStatus(counts({}))).toBe('empty')
    expect(productionContentGroupStatus(counts({ total: 1, pending: 1 }))).toBe('in_progress')
    expect(productionContentGroupStatus(counts({ total: 1, ready: 1 }))).toBe('ready')
    expect(productionContentGroupStatus(counts({ total: 1, failed: 1 }))).toBe('failed')
    expect(productionContentGroupStatus(counts({ total: 2, ready: 1, failed: 1 }))).toBe('needs_review')
  })

  it('does not report a canceled-only group as in progress', () => {
    expect(productionContentGroupStatus(counts({ total: 1, canceled: 1 }))).toBe('empty')
    expect(productionContentGroupStatus(counts({ total: 2, ready: 1, canceled: 1 }))).toBe('ready')
  })
})
