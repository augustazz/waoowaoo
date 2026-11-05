import { generateVoice } from '@/lib/ai-exec/engine'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { probeMediaBufferDurationMs } from '@/lib/media/probe-duration'
import { uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import { extensionFromAudioMimeType, loadGeneratedAudio } from '../artifacts/audio'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import {
  assertTaskActive,
  requireTaskProviderRouteSelection,
  resolveTaskProviderProxyUrl,
} from '../provider-media'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`VOICE_GENERATE_${field.toUpperCase()}_REQUIRED`)
  }
  return value.trim()
}

export async function handleWorkspaceResourceVoiceTask(context: TaskExecutionContext) {
  const { data } = context
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload)
  if (
    data.targetType !== 'WorkspaceResource'
    || payload.resource.resourceId !== data.targetId
    || payload.resource.mediaType !== 'audio'
  ) {
    throw new Error(`WORKSPACE_RESOURCE_VOICE_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const voiceModel = readRequiredString(payload.voiceModel, 'voiceModel')
  const description = readRequiredString(payload.resource.prompt, 'description')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const language = readRequiredString(payload.language, 'language')

  await reportTaskProgress(context, 20, { stage: 'generate_voice_submit' })
  const invocationKey = 'media:voice:primary'
  const generated = await generateVoice(
    data.userId,
    voiceModel,
    description,
    previewText,
    { language },
    { key: invocationKey },
    {
      beforePoll: async () => await assertTaskActive(context, 'polling_external'),
      onPending: async ({ elapsedRatio, phase }) => {
        const progress = 30 + Math.floor((80 - 30) * elapsedRatio)
        await reportTaskProgress(context, progress, {
          stage: 'polling_external',
          externalPhase: phase,
        })
        await assertTaskActive(context, 'polling_external_wait')
      },
    },
  )
  const providerRoute = await requireTaskProviderRouteSelection(context, invocationKey)

  await reportTaskProgress(context, 85, { stage: 'persist_voice' })
  const providerProxyUrl = await resolveTaskProviderProxyUrl(data.userId, providerRoute.provider)
  const audio = await loadGeneratedAudio({
    audioBase64: generated.audioBase64,
    audioUrl: generated.audioUrl,
    mimeType: generated.audioMimeType,
    label: 'generated voice',
    errorPrefix: 'VOICE_GENERATE',
    proxyUrl: providerProxyUrl,
  })
  const extension = extensionFromAudioMimeType(audio.mimeType)
  const durationMs = await probeMediaBufferDurationMs({
    buffer: audio.buffer,
    extension,
    stage: 'workspace_resource_voice_probe_duration',
  })
  const storageKey = await uploadObject(
    audio.buffer,
    buildTaskArtifactStorageKey({
      taskId: data.taskId,
      artifact: 'voice:primary',
      extension,
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
    voiceModel: providerRoute.modelKey,
    provider: providerRoute.provider,
    actualCharacters: Array.from(previewText).length,
    durationMs,
    metadata: generated.metadata || {},
  }
}
