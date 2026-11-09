import type {
  ProductionStageCounts,
  ProductionStageDefinition,
  ProductionStageKey,
  ProductionStepStatus,
} from './production-stages'

/**
 * Step status is a pure projection over Resources. It is never persisted and
 * never advances a workflow: a step can be revisited, skipped, or run out of
 * order, and the status simply describes what the project currently contains.
 */
export type ProductionStepDependencyReadiness = ReadonlyMap<ProductionStageKey, boolean>

export interface ResolveProductionStepStatusInput {
  readonly definition: ProductionStageDefinition
  readonly counts: ProductionStageCounts
  readonly readySchemaIds: ReadonlySet<string>
  /**
   * True when a ready Resource physically lives in the step's canonical folder.
   * Folder is the primary ownership signal, so such an artifact satisfies the
   * step even when its schema predates the step vocabulary (user uploads,
   * generic media, a plain-text script saved to `剧本/`).
   */
  readonly hasReadyFolderArtifact?: boolean
  /**
   * Whether each prerequisite step currently has a usable artifact. Downstream
   * steps care about usable artifacts, not about optional work still running.
   */
  readonly dependencyReadiness: ProductionStepDependencyReadiness
}

export interface ProductionStepStatusResult {
  readonly status: ProductionStepStatus
  /** True when every required artifact group has at least one ready Resource. */
  readonly requiredArtifactsReady: boolean
  /** Required prerequisites without a usable artifact. Soft gate only. */
  readonly blockers: readonly ProductionStageKey[]
  /** Recommended-but-optional prerequisites that are not ready yet. */
  readonly recommendedMissingStepKeys: readonly ProductionStageKey[]
  /** Required schemas without a ready Resource; empty once the step is satisfied. */
  readonly missingRequiredSchemaIds: readonly string[]
}

/**
 * Resolves one step. Rules, in order:
 *
 * 1. pending work always means "in progress", even if prerequisites are missing
 * 2. a step with no output is "blocked" when prerequisites are missing
 * 3. once required artifacts exist the step is usable; extra failures only make
 *    it "needs review" instead of hiding a usable artifact
 * 4. missing prerequisites with partial output are still reported as blockers
 *
 * `needs_review` is intentionally not an approval state: approvals require a
 * durable user decision, which this projection cannot invent. It only means
 * "the step is usable, but some artifacts failed and deserve a look".
 */
export function resolveProductionStepStatus(
  input: ResolveProductionStepStatusInput,
): ProductionStepStatusResult {
  const { definition, counts, readySchemaIds, dependencyReadiness } = input

  const blockers = definition.dependsOn.filter(
    (stepKey) => dependencyReadiness.get(stepKey) !== true,
  )
  const recommendedMissingStepKeys = definition.recommendedDependsOn.filter(
    (stepKey) => dependencyReadiness.get(stepKey) !== true,
  )

  const requiredArtifactsReady = definition.requiredSchemaIds.length === 0
    || input.hasReadyFolderArtifact === true
    || definition.requiredSchemaIds.some((schemaId) => readySchemaIds.has(schemaId))
  const missingRequiredSchemaIds = requiredArtifactsReady
    ? []
    : definition.requiredSchemaIds.filter((schemaId) => !readySchemaIds.has(schemaId))

  let status: ProductionStepStatus
  if (counts.pending > 0) {
    status = 'in_progress'
  } else if (counts.total === 0) {
    status = blockers.length > 0 ? 'blocked' : 'empty'
  } else if (requiredArtifactsReady) {
    status = counts.failed > 0 ? 'needs_review' : 'ready'
  } else if (blockers.length > 0) {
    status = 'blocked'
  } else if (counts.failed > 0) {
    status = 'failed'
  } else if (counts.ready === 0 && counts.pending === 0 && counts.failed === 0) {
    // Only canceled artifacts remain: nothing is running or usable, so the step
    // is effectively untouched rather than "in progress".
    status = 'empty'
  } else {
    status = 'in_progress'
  }

  return {
    status,
    requiredArtifactsReady,
    blockers,
    recommendedMissingStepKeys,
    missingRequiredSchemaIds,
  }
}
