import { describe, expect, it } from 'vitest'
import {
  emptyProductionStageView,
  type ProductionStageKey,
  type ProductionStageView,
  type ProductionStepStatus,
} from '@/lib/workspace-resource/production-stages'
import {
  deriveActiveProductionStep,
  productionStepStorageKey,
  resolveActiveProductionStep,
} from '@/lib/workspace-resource/step-navigation'

function stage(
  key: ProductionStageKey,
  stepStatus: ProductionStepStatus,
  options?: { readonly requiredArtifactsReady?: boolean },
): ProductionStageView {
  return {
    ...emptyProductionStageView(key),
    stepStatus,
    requiredArtifactsReady: options?.requiredArtifactsReady ?? stepStatus === 'ready',
  }
}

describe('deriveActiveProductionStep', () => {
  it('starts a new project at the script step', () => {
    const stages = [
      stage('script', 'empty', { requiredArtifactsReady: false }),
      stage('direction', 'empty', { requiredArtifactsReady: false }),
      stage('assets', 'blocked', { requiredArtifactsReady: false }),
    ]
    expect(deriveActiveProductionStep(stages)).toBe('script')
  })

  it('skips optional empty steps and moves to the next required step', () => {
    const stages = [
      stage('script', 'ready'),
      stage('direction', 'empty', { requiredArtifactsReady: false }),
      stage('assets', 'empty', { requiredArtifactsReady: false }),
      stage('storyboard', 'empty', { requiredArtifactsReady: false }),
      stage('video', 'blocked', { requiredArtifactsReady: false }),
    ]
    expect(deriveActiveProductionStep(stages)).toBe('assets')
  })

  it('prefers a step with running work even when it is optional', () => {
    const stages = [
      stage('script', 'ready'),
      stage('direction', 'in_progress', { requiredArtifactsReady: false }),
      stage('assets', 'empty', { requiredArtifactsReady: false }),
    ]
    expect(deriveActiveProductionStep(stages)).toBe('direction')
  })

  it('prefers a failed step with unfinished work', () => {
    const stages = [
      stage('script', 'ready'),
      stage('direction', 'ready'),
      stage('assets', 'ready'),
      stage('storyboard', 'ready'),
      stage('video', 'failed', { requiredArtifactsReady: false }),
      stage('audio', 'empty', { requiredArtifactsReady: false }),
      stage('final', 'blocked', { requiredArtifactsReady: false }),
    ]
    expect(deriveActiveProductionStep(stages)).toBe('video')
  })

  it('lands on the final step once every required step is ready', () => {
    const stages = [
      stage('script', 'ready'),
      stage('direction', 'empty', { requiredArtifactsReady: false }),
      stage('assets', 'ready'),
      stage('storyboard', 'empty', { requiredArtifactsReady: false }),
      stage('video', 'ready'),
      stage('audio', 'empty', { requiredArtifactsReady: false }),
      stage('final', 'ready'),
    ]
    expect(deriveActiveProductionStep(stages)).toBe('final')
  })

  it('falls back to script when no overview data is available', () => {
    expect(deriveActiveProductionStep([])).toBe('script')
  })
})

describe('resolveActiveProductionStep', () => {
  const stages = [
    stage('script', 'ready'),
    stage('assets', 'in_progress', { requiredArtifactsReady: false }),
  ]

  it('honours a valid requested step above everything else', () => {
    expect(resolveActiveProductionStep({
      stages,
      requestedStep: 'video',
      preferredStep: 'assets',
    })).toBe('video')
  })

  it('falls back to the stored preference when the URL has no valid step', () => {
    expect(resolveActiveProductionStep({
      stages,
      requestedStep: 'not-a-step',
      preferredStep: 'audio',
    })).toBe('audio')
  })

  it('derives the step when neither URL nor preference is valid', () => {
    expect(resolveActiveProductionStep({
      stages,
      requestedStep: null,
      preferredStep: null,
    })).toBe('assets')
  })
})

describe('productionStepStorageKey', () => {
  it('scopes the stored step to the project', () => {
    expect(productionStepStorageKey('project-1'))
      .toBe('waoowaoo:workspace:last-step:project-1')
  })
})
