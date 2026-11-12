import {
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import { assertVideoExecutionContract } from '@/lib/ai-registry/video-execution-contract'
import { resolveDeclaredVideoContract } from '@/lib/ai-registry/video-contracts'
import { verifyVideoOutput } from '@/lib/ai-registry/video-output-verification'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import {
  requireTaskProviderRouteSelection,
  resolveTaskProviderProxyUrl,
  resolveVideoSourceFromGeneration,
  uploadVideoSourceToStorage,
} from '../provider-media'

function frozenVideoOptions(
  value: WorkspaceResourceGenerationTaskPayload['generationOptions'],
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] => (
      typeof entry[1] === 'string'
      || typeof entry[1] === 'number'
      || typeof entry[1] === 'boolean'
    )),
  )
}

async function loadVideoImageReferences(
  context: TaskExecutionContext,
  input: WorkspaceResourceGenerationTaskPayload,
) {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const imageInputs = input.resource.imageInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_VIDEO_IMAGE_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (imageInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId: context.data.userId,
    projectId: context.data.projectId,
    references: imageInputs,
    expectedMediaType: 'image',
  })
  return resources.map((resource, index) => {
    const reference = resource.reference
    const role: 'first_frame' | 'last_frame' | 'reference_image' = reference.role === 'first_frame' || reference.role === 'last_frame'
      ? reference.role
      : 'reference_image'
    return {
      url: resource.storageKey,
      role,
      order: index + 1,
      source: 'generated' as const,
    }
  })
}

async function loadVideoReferences(
  context: TaskExecutionContext,
  input: WorkspaceResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const videoInputs = input.resource.videoInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_VIDEO_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (videoInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId: context.data.userId,
    projectId: context.data.projectId,
    references: videoInputs,
    expectedMediaType: 'video',
  })
  return resources.map((resource) => resource.storageKey)
}

export async function loadVideoAudioReferences(
  userId: string,
  projectId: string,
  input: WorkspaceResourceGenerationTaskPayload,
): Promise<string[]> {
  const inputByPosition = new Map(input.resource.inputs.map((reference) => [reference.position, reference]))
  const audioInputs = input.resource.audioInputPositions.map((position) => {
    const reference = inputByPosition.get(position)
    if (!reference) throw new Error(`WORKSPACE_RESOURCE_VIDEO_AUDIO_INPUT_POSITION_INVALID:${String(position)}`)
    return reference
  })
  if (audioInputs.length === 0) return []
  const resources = await resolveWorkspaceResourceInputMedia({
    userId,
    projectId,
    references: audioInputs,
    expectedMediaType: 'audio',
  })
  return resources.map((resource) => resource.storageKey)
}

export async function handleWorkspaceResourceVideoTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceGenerationTaskPayload(data.payload ?? {})
  await assertVideoExecutionContract(data.userId, payload.resource.modelKey, payload.videoExecutionContract)
  if (
    payload.resource.resourceId !== data.targetId
    || payload.resource.mediaType !== 'video'
    || payload.videoModel !== payload.resource.modelKey
  ) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_TASK_CONTRACT_INVALID:${data.taskId}`)
  }
  const prompt = payload.resource.prompt
  if (prompt === null) throw new Error(`WORKSPACE_RESOURCE_VIDEO_PROMPT_REQUIRED:${data.taskId}`)
  await reportTaskProgress(context, 20, { stage: 'workspace_resource_prepare' })
  const referenceImages = await loadVideoImageReferences(context, payload)
  const referenceAudios = await loadVideoAudioReferences(data.userId, data.projectId, payload)
  const referenceVideos = await loadVideoReferences(context, payload)
  const options = payload.generationOptions
  const durationSeconds = payload.durationSeconds
  if (!durationSeconds) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_DURATION_REQUIRED:${data.taskId}`)
  }
  await reportTaskProgress(context, 45, { stage: 'workspace_resource_generate' })
  const generated = await resolveVideoSourceFromGeneration(context, {
    userId: data.userId,
    modelId: payload.resource.modelKey,
    referenceImages,
    referenceAudios,
    referenceVideos,
    options: {
      ...frozenVideoOptions(options),
      prompt,
      duration: durationSeconds,
    },
  })
  const providerRoute = await requireTaskProviderRouteSelection(
    context,
    'media:video:primary',
  )
  await reportTaskProgress(context, 90, { stage: 'workspace_resource_persist' })
  const providerProxyUrl = await resolveTaskProviderProxyUrl(data.userId, providerRoute.provider)
  const stored = await uploadVideoSourceToStorage(
    generated.url,
    'workspace-resource',
    payload.resource.resourceId,
    generated.downloadHeaders,
    { taskId: data.taskId, artifact: `workspace-resource:${payload.resource.resourceId}` },
    providerProxyUrl,
  )
  const media = await ensureMediaObjectFromStorageKey(stored.storageKey, stored.metadata)
  const outputVerification = verifyVideoOutput({
    actual: { durationMs: media.durationMs, width: media.width, height: media.height,
      hasAudio: 'hasAudio' in stored.metadata && typeof stored.metadata.hasAudio === 'boolean' ? stored.metadata.hasAudio : undefined },
    durationSeconds, aspectRatio: options.aspectRatio, generateAudio: options.generateAudio,
    audioDefault: resolveDeclaredVideoContract(payload.resource.modelKey)?.audio.default,
    resolution: options.resolution,
    outputSizes: resolveDeclaredVideoContract(payload.resource.modelKey)?.outputSizes,
  })
  return {
    mediaId: media.id,
    videoUrl: media.url,
    storageKey: media.storageKey,
    modelKey: providerRoute.modelKey,
    provider: providerRoute.provider,
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    outputVerification,
    ...(payload.videoExecutionContract ? { videoExecutionContract: payload.videoExecutionContract } : {}),
    ...(typeof generated.actualVideoTokens === 'number'
      ? { actualVideoTokens: generated.actualVideoTokens }
      : {}),
  }
}
