import { createHash } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'
import { resolveProjectVideoRatio } from '@/lib/projects/video-ratio'
import { prisma } from '@/lib/prisma'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import type { OperationPlan } from './plan-contract'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import { TASK_TYPE } from '@/lib/task/types'

export const PROJECT_VIDEO_RATIO_METADATA_KEY = 'projectVideoRatio'
export const PROJECT_VIDEO_RATIO_REQUIRED_METADATA_KEY = 'projectVideoRatioRequired'

export const projectVideoRatioSnapshotSchema = z.object({
  value: z.string().trim().min(1),
  fingerprint: z.string().length(64),
}).strict()

export type ProjectVideoRatioSnapshot = z.infer<typeof projectVideoRatioSnapshotSchema>

export function requireProjectVideoRatio(value: string | null | undefined): ProjectVideoRatioSnapshot {
  const videoRatio = resolveProjectVideoRatio(value).trim()
  if (!Object.prototype.hasOwnProperty.call(ASPECT_RATIO_CONFIGS, videoRatio)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_VIDEO_RATIO_INVALID',
      field: 'videoRatio',
      value: videoRatio,
      allowedValues: Object.keys(ASPECT_RATIO_CONFIGS),
      agentRetryableAfterCorrection: true,
    })
  }
  return {
    value: videoRatio,
    fingerprint: createHash('sha256').update(videoRatio).digest('hex'),
  }
}

export async function readProjectVideoRatioSnapshot(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<ProjectVideoRatioSnapshot> {
  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      userId: input.userId,
    },
    select: {
      videoRatio: true,
    },
  })
  if (!project) throw new ApiError('NOT_FOUND')
  return requireProjectVideoRatio(project.videoRatio)
}

function containsProjectImageOrVideoTask(plan: OperationPlan): boolean {
  if (plan.metadata?.[PROJECT_VIDEO_RATIO_REQUIRED_METADATA_KEY] === false) return false
  return plan.tasks.some((task) => {
    if (!task.billingInfo.billable) return false
    if (task.billingInfo.apiType !== 'image' && task.billingInfo.apiType !== 'video') return false
    if (
      task.taskType !== TASK_TYPE.WORKSPACE_RESOURCE_IMAGE
      && task.taskType !== TASK_TYPE.WORKSPACE_RESOURCE_VIDEO
    ) return true
    parseWorkspaceResourceGenerationTaskPayload(task.payload)
    return true
  })
}

/**
 * Freezes the current project frame fact into every image and video generation plan.
 * This is the single planning boundary shared by Agent and API callers, so no
 * task, approval, retry, or replay can reuse a plan after the fact changes.
 */
export async function freezeProjectVideoRatioIntoPlan(
  plan: OperationPlan,
): Promise<OperationPlan> {
  if (plan.projectId === GLOBAL_ASSET_PROJECT_ID || !containsProjectImageOrVideoTask(plan)) {
    return plan
  }
  const existing = plan.metadata?.[PROJECT_VIDEO_RATIO_METADATA_KEY]
  const snapshot = existing === undefined
    ? await readProjectVideoRatioSnapshot({ projectId: plan.projectId, userId: plan.userId })
    : projectVideoRatioSnapshotSchema.parse(existing)

  return {
    ...plan,
    metadata: {
      ...(plan.metadata ?? {}),
      [PROJECT_VIDEO_RATIO_METADATA_KEY]: snapshot,
    },
  }
}
