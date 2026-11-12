import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveProjectVideoRatio } from '@/lib/projects/video-ratio'
import { logProjectAction } from '@/lib/logging/semantic'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  isProjectVideoRatio,
  PROJECT_VIDEO_RATIO_VALUES,
  writeProjectVideoRatioInTransaction,
} from '@/lib/projects/video-ratio-write'

const projectVideoRatioSchema = z.string().trim().min(1).refine(
  isProjectVideoRatio,
  { message: 'Unsupported project video ratio.' },
)

export function createConfigOperations(): ProjectAgentOperationRegistryDraft {
  return {
    get_project_config: defineOperation({
      id: 'get_project_config',
      summary: 'Read the project output aspect ratio.',
      intent: 'query',
      channels: { tool: false, api: true },
      effects: {
        writes: false, billable: false, destructive: false, overwrite: false,
        bulk: false, externalSideEffects: false, longRunning: false,
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ videoRatio: z.string().nullable() }).strict(),
      execute: async (ctx) => {
        const project = await prisma.project.findUniqueOrThrow({
          where: { id: ctx.projectId }, select: { videoRatio: true },
        })
        return { videoRatio: resolveProjectVideoRatio(project.videoRatio) }
      },
    }),
    update_project_config: defineOperation({
      id: 'update_project_config',
      summary: 'Persist the explicit project output aspect ratio.',
      intent: 'act',
      toolContractRevision: 'update_project_config/v2',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true, workspaceResourceImpact: 'project_data', billable: false,
        destructive: false, overwrite: true, bulk: false,
        externalSideEffects: false, longRunning: false,
      },
      confirmation: { kind: 'none', required: false },
      toolInputSchema: {
        type: 'object',
        properties: {
          videoRatio: {
            type: 'string', enum: [...PROJECT_VIDEO_RATIO_VALUES], minLength: 1,
            description: 'Exact project output aspect ratio decided by the user, such as 16:9 or 9:16.',
          },
        },
        required: ['videoRatio'],
        additionalProperties: false,
      },
      inputSchema: z.object({ videoRatio: projectVideoRatioSchema }).strict(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const project = await transaction.project.findUniqueOrThrow({
          where: { id: ctx.projectId },
          select: { name: true },
        })
        await writeProjectVideoRatioInTransaction({
          transaction, projectId: ctx.projectId, videoRatio: input.videoRatio,
        })
        logProjectAction('UPDATE_NOVEL_PROMOTION', ctx.userId, null, ctx.projectId, project.name, { changes: input })
        return { project: await transaction.project.findUniqueOrThrow({ where: { id: ctx.projectId } }) }
      },
    }),
  }
}
