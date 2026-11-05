import { generateMusic } from '@/lib/ai-exec/engine'
import {
  parseWorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { musicCompositionPlanDurationMs } from '@/lib/music/composition-plan'
import { musicScoreGenerationOptionsSchema } from '@/lib/music/score-specification'
import { extensionFromAudioMimeType, loadGeneratedAudio } from '../artifacts/audio'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { requireTaskProviderRouteSelection, resolveTaskProviderProxyUrl } from '../provider-media'

export async function handleWorkspaceResourceAudioTask(context: TaskExecutionContext) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  if (
    payload.resource.resourceId !== data.targetId ||
    payload.resource.mediaType !== 'audio' ||
    payload.musicModel !== payload.resource.modelKey
  ) {
    throw new Error(`WORKSPACE_RESOURCE_MUSIC_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const musicModel = payload.resource.modelKey
  const specification = musicScoreGenerationOptionsSchema.parse(payload.generationOptions)
  const durationMs = musicCompositionPlanDurationMs(specification.compositionPlan)
  await reportTaskProgress(context, 20, { stage: 'generate_music_submit' })

  const invocationKey = 'media:music:primary'
  const generated = await generateMusic(
    data.userId,
    musicModel,
    { kind: 'composition_plan', compositionPlan: specification.compositionPlan },
    { outputFormat: specification.outputFormat },
    { key: invocationKey },
  )
  const providerRoute = await requireTaskProviderRouteSelection(context, invocationKey)

  await reportTaskProgress(context, 85, { stage: 'persist_music' })
  const providerProxyUrl = await resolveTaskProviderProxyUrl(data.userId, providerRoute.provider)
  const audio = await loadGeneratedAudio({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
    label: 'generated music',
    errorPrefix: 'MUSIC_GENERATE',
    proxyUrl: providerProxyUrl,
  })
  const storageKey = await uploadObject(
    audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: data.taskId,
      artifact: 'music:primary',
      extension: extensionFromAudioMimeType(audio.mimeType),
    }),
    audio.mimeType,
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: audio.mimeType,
    sizeBytes: audio.buffer.byteLength,
    durationMs,
  })

  return {
    mediaId: media.id,
    audioUrl: media.url,
    storageKey,
    modelKey: providerRoute.modelKey,
    musicModel: providerRoute.modelKey,
    provider: providerRoute.provider,
    metadata: generated.metadata || {},
  }
}
