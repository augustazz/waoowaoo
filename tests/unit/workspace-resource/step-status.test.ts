import { describe, expect, it } from 'vitest'
import {
  productionStageDefinition,
  type ProductionStageCounts,
  type ProductionStageKey,
} from '@/lib/workspace-resource/production-stages'
import {
  resolveProductionStepStatus,
  type ProductionStepDependencyReadiness,
} from '@/lib/workspace-resource/step-status'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'

function counts(overrides: Partial<ProductionStageCounts> = {}): ProductionStageCounts {
  return {
    total: 0,
    ready: 0,
    pending: 0,
    failed: 0,
    canceled: 0,
    ...overrides,
  }
}

function readiness(
  entries: readonly (readonly [ProductionStageKey, boolean])[],
): ProductionStepDependencyReadiness {
  return new Map(entries)
}

describe('resolveProductionStepStatus', () => {
  it('reports an empty step when prerequisites are satisfied', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('assets'),
      counts: counts(),
      readySchemaIds: new Set(),
      dependencyReadiness: readiness([['script', true]]),
    })
    expect(result).toMatchObject({
      status: 'empty',
      requiredArtifactsReady: false,
      blockers: [],
      missingRequiredSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH],
    })
  })

  it('reports blocked when a hard prerequisite has no usable artifact', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('assets'),
      counts: counts(),
      readySchemaIds: new Set(),
      dependencyReadiness: readiness([['script', false]]),
    })
    expect(result.status).toBe('blocked')
    expect(result.blockers).toEqual(['script'])
  })

  it('does not treat recommended prerequisites as blockers', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('assets'),
      counts: counts(),
      readySchemaIds: new Set(),
      dependencyReadiness: readiness([
        ['script', true],
        ['direction', false],
      ]),
    })
    expect(result.status).toBe('empty')
    expect(result.blockers).toEqual([])
    expect(result.recommendedMissingStepKeys).toEqual(['direction'])
  })

  it('reports in-progress whenever work is pending', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('script'),
      counts: counts({ total: 1, pending: 1 }),
      readySchemaIds: new Set(),
      dependencyReadiness: readiness([]),
    })
    expect(result.status).toBe('in_progress')
  })

  it('reports ready once the required artifact exists', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('script'),
      counts: counts({ total: 1, ready: 1 }),
      readySchemaIds: new Set([WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY]),
      dependencyReadiness: readiness([]),
    })
    expect(result).toMatchObject({
      status: 'ready',
      requiredArtifactsReady: true,
      missingRequiredSchemaIds: [],
    })
  })

  it('reports needs-review when a usable artifact exists but other artifacts failed', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('assets'),
      counts: counts({ total: 2, ready: 1, failed: 1 }),
      readySchemaIds: new Set([WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH]),
      dependencyReadiness: readiness([['script', true]]),
    })
    expect(result.status).toBe('needs_review')
    expect(result.requiredArtifactsReady).toBe(true)
  })

  it('reports failed when required artifacts are missing and attempts failed', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('script'),
      counts: counts({ total: 1, failed: 1 }),
      readySchemaIds: new Set(),
      dependencyReadiness: readiness([]),
    })
    expect(result.status).toBe('failed')
    expect(result.requiredArtifactsReady).toBe(false)
  })

  it('reports in-progress when only optional artifacts exist', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('assets'),
      counts: counts({ total: 1, ready: 1 }),
      readySchemaIds: new Set([WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE]),
      dependencyReadiness: readiness([['script', true]]),
    })
    expect(result.status).toBe('in_progress')
    expect(result.requiredArtifactsReady).toBe(false)
    expect(result.missingRequiredSchemaIds).toEqual([
      WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH,
    ])
  })

  it('accepts a ready folder-owned artifact even when its schema is not required', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('script'),
      counts: counts({ total: 1, ready: 1 }),
      readySchemaIds: new Set([WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT]),
      hasReadyFolderArtifact: true,
      dependencyReadiness: readiness([]),
    })
    expect(result).toMatchObject({
      status: 'ready',
      requiredArtifactsReady: true,
      missingRequiredSchemaIds: [],
    })
  })

  it('does not report a canceled-only step as in progress', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('script'),
      counts: counts({ total: 1, canceled: 1 }),
      readySchemaIds: new Set(),
      dependencyReadiness: readiness([]),
    })
    expect(result).toMatchObject({
      status: 'empty',
      requiredArtifactsReady: false,
    })
  })

  it('treats final-cut alternatives as one required group', () => {
    const result = resolveProductionStepStatus({
      definition: productionStageDefinition('final'),
      counts: counts({ total: 1, ready: 1 }),
      readySchemaIds: new Set([WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO]),
      dependencyReadiness: readiness([['video', true]]),
    })
    expect(result).toMatchObject({
      status: 'ready',
      requiredArtifactsReady: true,
      missingRequiredSchemaIds: [],
    })
  })
})
