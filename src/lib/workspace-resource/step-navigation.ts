import {
  isProductionStageKey,
  PRODUCTION_STAGE_DEFINITIONS,
  PRODUCTION_STAGE_KEYS,
  type ProductionStageKey,
  type ProductionStageView,
} from './production-stages'

/** URL query parameter that keeps the step visible across refreshes and links. */
export const PRODUCTION_STEP_QUERY_PARAM = 'step'

const PRODUCTION_STEP_STORAGE_PREFIX = 'waoowaoo:workspace:last-step'

export function productionStepStorageKey(projectId: string): string {
  return `${PRODUCTION_STEP_STORAGE_PREFIX}:${projectId}`
}

/**
 * Picks the step a returning user should land on. Preference order:
 *
 * 1. an explicit `?step=` (validated)
 * 2. the last step the user opened in this browser
 * 3. the first step with running/failed work
 * 4. the first required step that is not ready
 * 5. the final step (everything required is done)
 *
 * This is a navigation preference, not workflow state: nothing here is
 * persisted to the project or used to gate operations.
 */
export function resolveActiveProductionStep(input: {
  readonly stages: readonly ProductionStageView[]
  readonly requestedStep?: string | null
  readonly preferredStep?: string | null
}): ProductionStageKey {
  if (isProductionStageKey(input.requestedStep)) return input.requestedStep
  if (isProductionStageKey(input.preferredStep)) return input.preferredStep
  return deriveActiveProductionStep(input.stages)
}

export function deriveActiveProductionStep(
  stages: readonly ProductionStageView[],
): ProductionStageKey {
  if (stages.length === 0) return PRODUCTION_STAGE_KEYS[0]

  const byKey = new Map(stages.map((stage) => [stage.key, stage]))
  const ordered = PRODUCTION_STAGE_DEFINITIONS
    .map((definition) => byKey.get(definition.key))
    .filter((stage): stage is ProductionStageView => stage !== undefined)

  const active = ordered.find(
    (stage) => stage.stepStatus === 'in_progress' || stage.stepStatus === 'failed',
  )
  if (active) return active.key

  const nextRequired = ordered.find(
    (stage) => stage.stepRequired && stage.stepStatus !== 'ready',
  )
  if (nextRequired) return nextRequired.key

  return PRODUCTION_STAGE_KEYS[PRODUCTION_STAGE_KEYS.length - 1]
}

export function readLastProductionStep(projectId: string): ProductionStageKey | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(productionStepStorageKey(projectId))
    return isProductionStageKey(value) ? value : null
  } catch {
    // Storage can be unavailable in private modes; navigation must still work.
    return null
  }
}

export function writeLastProductionStep(
  projectId: string,
  stepKey: ProductionStageKey,
): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(productionStepStorageKey(projectId), stepKey)
  } catch {
    // Best-effort only: the URL still carries the active step.
  }
}
