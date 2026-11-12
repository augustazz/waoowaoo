import { AppError } from '@/lib/errors/app-error'
import { imageReferenceCountIssue } from '@/lib/ai-registry/generation-reference-policy'

/** Defense at the final adapter boundary for frozen Tasks and direct callers. */
export function assertImageReferenceCount(provider: string, references: readonly string[], maximum: number | undefined): void {
  const issue = imageReferenceCountIssue(maximum, references.length)
  if (issue) throw new AppError('INVALID_PARAMS', issue.code, { provider, details: { ...issue } })
}
