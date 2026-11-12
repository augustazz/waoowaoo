import { describe, expect, it } from 'vitest'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import {
  defaultProductionFolderPathForSchemaId,
  PRODUCTION_STAGE_DEFINITIONS,
  PRODUCTION_STAGE_KEYS,
  PRODUCTION_STAGE_FOLDER_PATHS,
  PRODUCTION_EPISODE_FOLDER_PATHS,
  productionStageDefinition,
  productionStageFolderPaths,
  productionStageForFolderPath,
  productionStageForResource,
  productionStageForWorkspacePath,
  resolveProductionFolderPath,
  summarizeProductionStages,
  type ProductionStageResourceRow,
} from '@/lib/workspace-resource/production-stages'

function row(
  id: string,
  schemaId: string,
  status: ProductionStageResourceRow['status'],
  workspacePath = `${id}.json`,
): ProductionStageResourceRow {
  return {
    id,
    name: id,
    workspacePath,
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

describe('production step registry', () => {
  it('keeps the canonical keys in order and groups them by phase', () => {
    expect(PRODUCTION_STAGE_DEFINITIONS.map((definition) => definition.key))
      .toEqual([...PRODUCTION_STAGE_KEYS])
    expect(PRODUCTION_STAGE_DEFINITIONS.map((definition) => definition.order))
      .toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(PRODUCTION_STAGE_DEFINITIONS
      .filter((definition) => definition.phase === 'pre')
      .map((definition) => definition.key)).toEqual(['script', 'direction'])
    expect(PRODUCTION_STAGE_DEFINITIONS
      .filter((definition) => definition.phase === 'production')
      .map((definition) => definition.key)).toEqual(['assets', 'storyboard', 'video'])
    expect(PRODUCTION_STAGE_DEFINITIONS
      .filter((definition) => definition.phase === 'post')
      .map((definition) => definition.key)).toEqual(['audio', 'final'])
  })

  it('marks only the agreed steps as optional', () => {
    const optional = PRODUCTION_STAGE_DEFINITIONS
      .filter((definition) => !definition.required)
      .map((definition) => definition.key)
    expect(optional).toEqual(['direction', 'storyboard', 'audio'])
  })

  it('never lets optional steps become hard prerequisites', () => {
    const dependsOn = new Map(
      PRODUCTION_STAGE_DEFINITIONS.map((definition) => [definition.key, definition.dependsOn]),
    )
    expect(dependsOn.get('video')).toEqual(['script', 'assets'])
    expect(dependsOn.get('final')).toEqual(['video'])
    expect(productionStageDefinition('video').recommendedDependsOn).toEqual(['storyboard'])
    expect(productionStageDefinition('assets').recommendedDependsOn).toEqual(['direction'])
  })

  it('exposes primary artifacts and assistant prompt keys per step', () => {
    const assets = productionStageDefinition('assets')
    expect(assets.primarySchemaIds).toEqual([WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH])
    expect(assets.optionalSchemaIds).toEqual([
      WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
      WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
      WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
    ])
    expect(assets.assistant.startPromptKey)
      .toBe('projectWorkflow.canvas.workspace.stages.prompts.assets')
    expect(assets.assistant.reviewPromptKey)
      .toBe('projectWorkflow.canvas.workspace.stages.reviewPrompts.assets')
  })

  it('owns one canonical folder and grouping policy per step', () => {
    const folders = PRODUCTION_STAGE_DEFINITIONS.map((definition) => [
      definition.key,
      definition.defaultFolderPath,
      definition.contentGrouping,
    ])
    expect(folders).toEqual([
      ['script', '剧本', 'episode'],
      ['direction', '方向', 'episode'],
      ['assets', '资产', 'asset_type'],
      ['storyboard', '分镜', 'episode'],
      ['video', '视频', 'episode'],
      ['audio', '音频', 'episode'],
      ['final', '成片', 'episode'],
    ])
  })

  it('resolves placement folders, including asset type subfolders', () => {
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY))
      .toBe('剧本')
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION))
      .toBe('方向')
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE))
      .toBe('资产/角色')
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE))
      .toBe('资产/场景')
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE))
      .toBe('资产/道具')
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE))
      .toBeNull()
  })

  it('treats an omitted folder as the step default but preserves null as the root', () => {
    expect(resolveProductionFolderPath(undefined, WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY))
      .toBe('剧本')
    expect(resolveProductionFolderPath(null, WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY))
      .toBeNull()
    expect(resolveProductionFolderPath('自定义目录', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY))
      .toBe('自定义目录')
    expect(resolveProductionFolderPath(undefined, WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE))
      .toBeNull()
  })
})

describe('productionStepForResource ownership', () => {
  it('combines direction folders while keeping the original name for new content', () => {
    expect(productionStageFolderPaths('direction')).toEqual(['方向', '创作方向'])
    for (const path of ['方向', '创作方向']) {
      expect(PRODUCTION_STAGE_FOLDER_PATHS).toContain(path)
      expect(PRODUCTION_EPISODE_FOLDER_PATHS).toContain(path)
      expect(productionStageForFolderPath(path)).toBe('direction')
      expect(productionStageForResource({
        workspacePath: `${path}/参考/风格.png`,
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      })).toBe('direction')
    }
    expect(productionStageForWorkspacePath('方向参考/风格.png')).toBeNull()
    const direction = summarizeProductionStages([
      row('original', WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT, 'ready', '方向/总纲.txt'),
      row('alias', WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT, 'ready', '创作方向/风格.txt'),
    ]).filter((stage) => stage.key === 'direction')
    expect(direction).toHaveLength(1)
    expect(direction[0]).toMatchObject({ defaultFolderPath: '方向', counts: { total: 2 } })
  })

  it('prefers the step folder over a conflicting schema', () => {
    expect(productionStageForResource({
      workspacePath: '剧本/第01集.json',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    })).toBe('script')
    expect(productionStageForResource({
      workspacePath: '成片/正片.mp4',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
    })).toBe('final')
  })

  it('falls back to the schema for legacy files outside the convention folders', () => {
    expect(productionStageForResource({
      workspacePath: 'legacy/screenplay.json',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
    })).toBe('script')
    expect(productionStageForResource({
      workspacePath: '随机/文件.txt',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT,
    })).toBeNull()
  })

  it('does not treat a bare step folder name as ownership', () => {
    expect(productionStageForWorkspacePath('剧本')).toBeNull()
    expect(productionStageForWorkspacePath('剧本/第01集.json')).toBe('script')
    expect(productionStageForWorkspacePath('资产/角色/主角.png')).toBe('assets')
  })

  it('resolves the step for the step folder itself and its descendants', () => {
    expect(productionStageForFolderPath('剧本')).toBe('script')
    expect(productionStageForFolderPath('剧本/')).toBe('script')
    expect(productionStageForFolderPath('剧本/第01集')).toBe('script')
    expect(productionStageForFolderPath('资产/角色')).toBe('assets')
    expect(productionStageForFolderPath('画面素材')).toBeNull()
    expect(productionStageForFolderPath('')).toBeNull()
  })
})

describe('summarizeProductionStages step status', () => {
  it('derives readiness from Resources instead of step order', () => {
    const stages = summarizeProductionStages([
      row('screenplay', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'ready'),
    ])
    const script = stages.find((stage) => stage.key === 'script')
    const direction = stages.find((stage) => stage.key === 'direction')
    const assets = stages.find((stage) => stage.key === 'assets')
    const storyboard = stages.find((stage) => stage.key === 'storyboard')

    expect(script?.stepStatus).toBe('ready')
    expect(script?.requiredArtifactsReady).toBe(true)
    expect(direction?.stepStatus).toBe('empty')
    expect(assets?.stepStatus).toBe('empty')
    expect(assets?.blockers).toEqual([])
    expect(assets?.recommendedMissingStepKeys).toEqual(['direction'])
    // assets is required and still missing, so storyboard cannot start yet.
    expect(storyboard?.stepStatus).toBe('blocked')
    expect(storyboard?.blockers).toEqual(['assets'])
  })

  it('keeps optional storyboard from blocking video', () => {
    const stages = summarizeProductionStages([
      row('screenplay', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'ready'),
      row('manifest', WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH, 'ready'),
    ])
    const storyboard = stages.find((stage) => stage.key === 'storyboard')
    const video = stages.find((stage) => stage.key === 'video')
    const final = stages.find((stage) => stage.key === 'final')

    expect(storyboard?.stepStatus).toBe('empty')
    expect(storyboard?.blockers).toEqual([])
    expect(video?.stepStatus).toBe('empty')
    expect(video?.blockers).toEqual([])
    expect(video?.recommendedMissingStepKeys).toEqual(['storyboard'])
    expect(final?.stepStatus).toBe('blocked')
    expect(final?.blockers).toEqual(['video'])
  })

  it('reports optional assets as in progress without satisfying the step', () => {
    const stages = summarizeProductionStages([
      row('screenplay', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'ready'),
      row('character', WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE, 'ready'),
    ])
    const assets = stages.find((stage) => stage.key === 'assets')
    expect(assets).toMatchObject({
      stepStatus: 'in_progress',
      requiredArtifactsReady: false,
      counts: { total: 1, ready: 1, pending: 0, failed: 0, canceled: 0 },
    })
    expect(assets?.missingRequiredSchemaIds).toEqual([
      WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH,
    ])
  })

  it('surfaces partial failures as needs-review without hiding usable output', () => {
    const stages = summarizeProductionStages([
      row('segment-ready', WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT, 'ready'),
      row('segment-failed', WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT, 'failed'),
    ])
    const video = stages.find((stage) => stage.key === 'video')
    expect(video).toMatchObject({
      status: 'failed',
      stepStatus: 'needs_review',
      requiredArtifactsReady: true,
      counts: { total: 2, ready: 1, pending: 0, failed: 1, canceled: 0 },
    })
  })

  it('accepts either composite or rendered output as the final artifact', () => {
    const stages = summarizeProductionStages([
      row('segment', WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT, 'ready'),
      row('render', WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO, 'ready'),
    ])
    const final = stages.find((stage) => stage.key === 'final')
    expect(final).toMatchObject({
      stepStatus: 'ready',
      requiredArtifactsReady: true,
      missingRequiredSchemaIds: [],
    })
  })

  it('treats a ready file in the step folder as the step artifact', () => {
    const stages = summarizeProductionStages([
      row(
        'plain-script',
        WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT,
        'ready',
        '剧本/第01集.txt',
      ),
      row('upload', WORKSPACE_RESOURCE_SCHEMA.UPLOAD_VIDEO, 'ready', '成片/正片.mp4'),
    ])
    const script = stages.find((stage) => stage.key === 'script')
    const final = stages.find((stage) => stage.key === 'final')
    expect(script).toMatchObject({
      stepStatus: 'ready',
      requiredArtifactsReady: true,
      missingRequiredSchemaIds: [],
      counts: { total: 1, ready: 1, pending: 0, failed: 0, canceled: 0 },
    })
    expect(final).toMatchObject({
      stepStatus: 'ready',
      requiredArtifactsReady: true,
    })
  })

  it('does not report a canceled-only step as in progress', () => {
    const stages = summarizeProductionStages([
      row('canceled', WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY, 'canceled'),
    ])
    const script = stages.find((stage) => stage.key === 'script')
    expect(script).toMatchObject({
      stepStatus: 'empty',
      requiredArtifactsReady: false,
      counts: { total: 1, ready: 0, pending: 0, failed: 0, canceled: 1 },
    })
  })
})
