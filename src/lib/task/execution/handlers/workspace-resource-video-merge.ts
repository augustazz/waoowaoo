import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseWorkspaceResourceVideoMergeTaskPayload, VIDEO_MERGE_FPS } from '@/lib/workspace-resource/video-merge-contract'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { getObjectBuffer, uploadObject } from '@/lib/storage'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'
import {
  concatVideoMergeAudioClips,
  muxVideoMergeMusicCues,
  muxVideoMergeSourceAudio,
  renderVideoMergeClipAudio,
} from '@/lib/video-compose/video-merge-audio'
import {
  createFfmpegCommandRunner,
  probeMediaDurationSeconds,
} from '@/lib/video-compose/ffmpeg-command'
import {
  concatVideoClips,
  extractVideoPosterFrame,
  normalizeVideoClip,
  probeVideoDimensions,
} from '@/lib/video-compose/video-merge-ffmpeg'
import { reportTaskProgress } from '../progress'
import type { TaskExecutionContext } from '../context'
import { assertTaskActive } from '../provider-media'

export async function handleWorkspaceResourceVideoMergeTask(
  context: TaskExecutionContext,
) {
  const { data } = context
  if (data.targetType !== 'WorkspaceResource') {
    throw new Error(`WORKSPACE_RESOURCE_TASK_TARGET_INVALID:${data.targetType}`)
  }
  const payload = parseWorkspaceResourceVideoMergeTaskPayload(data.payload ?? {})
  if (payload.resource.resourceId !== data.targetId) {
    throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_TARGET_MISMATCH:${data.taskId}`)
  }
  const videoInputs = payload.resource.inputs.filter((input) => input.role === 'source_video')
  const resolvedVideos = await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: videoInputs,
    expectedMediaType: 'video',
  })
  const ordered = resolvedVideos.map((resource) => ({
    input: resource.reference,
    storageKey: resource.storageKey,
  }))
  const inputByPosition = new Map(payload.resource.inputs.map((input) => [input.position, input]))
  const bgmInputs = payload.resource.musicCues.map((cue) => {
    const reference = inputByPosition.get(cue.inputPosition)
    if (!reference || reference.role !== 'bgm_audio') {
      throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_BGM_POSITION_INVALID:${String(cue.inputPosition)}`)
    }
    return reference
  })
  const resolvedBgm = bgmInputs.length > 0 ? await resolveWorkspaceResourceInputMedia({
    userId: data.userId,
    projectId: data.projectId,
    references: bgmInputs,
    expectedMediaType: 'audio',
  }) : []

  const workspaceDir = await mkdtemp(path.join(tmpdir(), `waoowaoo-resource-merge-${randomUUID()}-`))
  try {
    await reportTaskProgress(context, 10, { stage: 'workspace_resource_video_merge_prepare' })
    const sourcePaths: string[] = []
    for (const [index, item] of ordered.entries()) {
      const sourcePath = path.join(workspaceDir, `source-${String(index)}.mp4`)
      await writeFile(sourcePath, await getObjectBuffer(item.storageKey))
      sourcePaths.push(sourcePath)
    }
    const dimensions = { width: payload.resource.edit.width, height: payload.resource.edit.height }
    const edits = ordered.map((source) => {
      const edit = payload.resource.edit.clips.find((clip) => clip.inputPosition === source.input.position)
      if (!edit) throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_EDIT_MISSING')
      return edit
    })
    const durations = edits.map((edit) => edit.frameCount / VIDEO_MERGE_FPS)
    const totalDurationSeconds = durations.reduce((sum, duration) => sum + duration, 0)
    const normalizedPaths: string[] = []
    const audioPaths: string[] = []
    let hasSourceAudio = false
    for (const [index, sourcePath] of sourcePaths.entries()) {
      const durationSeconds = durations[index]
      if (!durationSeconds) throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_DURATION_MISSING:${String(index)}`)
      const normalizedPath = path.join(workspaceDir, `normalized-${String(index)}.mp4`)
      const audioPath = path.join(workspaceDir, `audio-${String(index)}.wav`)
      await normalizeVideoClip({
        sourcePath,
        outputPath: normalizedPath,
        durationSeconds,
        startFrame: edits[index].startFrame,
        frameCount: edits[index].frameCount,
        aspectRatio: payload.resource.edit.aspectRatio,
        width: dimensions.width,
        height: dimensions.height,
      })
      const clipHasAudio = payload.resource.edit.audioMode === 'preserve' && await renderVideoMergeClipAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'workspace_resource_video_merge_clip_audio',
          expectedDurationSeconds: durationSeconds,
        }),
        sourcePath,
        outputPath: audioPath,
        durationSeconds,
        startSeconds: edits[index].startFrame / VIDEO_MERGE_FPS,
      })
      hasSourceAudio = hasSourceAudio || clipHasAudio
      normalizedPaths.push(normalizedPath)
      audioPaths.push(audioPath)
    }

    await reportTaskProgress(context, 65, { stage: 'workspace_resource_video_merge_compose' })
    const stitchedPath = path.join(workspaceDir, 'stitched.mp4')
    await concatVideoClips({
      clipPaths: normalizedPaths,
      listPath: path.join(workspaceDir, 'concat.txt'),
      outputPath: stitchedPath,
      durationSeconds: totalDurationSeconds,
    })
    const stitchedDurationSeconds = await probeMediaDurationSeconds(
      stitchedPath,
      'workspace_resource_video_merge_probe_duration',
    )
    const actualDimensions = await probeVideoDimensions(stitchedPath)
    if (Math.abs(stitchedDurationSeconds - totalDurationSeconds) > 0.001 || actualDimensions.width !== dimensions.width || actualDimensions.height !== dimensions.height) {
      throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_OUTPUT_SPEC_MISMATCH')
    }
    const posterPath = path.join(workspaceDir, 'poster.jpg')
    await extractVideoPosterFrame({
      sourcePath: stitchedPath,
      outputPath: posterPath,
      timestampSeconds: (payload.resource.edit.cover?.timestampFrame ?? 0) / VIDEO_MERGE_FPS,
      durationSeconds: stitchedDurationSeconds,
    })
    const mainAudioPath = path.join(workspaceDir, 'audio.wav')
    if (payload.resource.edit.audioMode === 'preserve') await concatVideoMergeAudioClips({
      runCommand: createFfmpegCommandRunner({
        stage: 'workspace_resource_video_merge_concat_audio',
        expectedDurationSeconds: stitchedDurationSeconds,
      }),
      clipAudioPaths: audioPaths,
      outputPath: mainAudioPath,
      durationSeconds: stitchedDurationSeconds,
    })
    const outputPath = path.join(workspaceDir, 'merged.mp4')
    if (payload.resource.edit.audioMode === 'mute') {
      await copyFile(stitchedPath, outputPath)
    } else if (resolvedBgm.length > 0) {
      const musicCues = await Promise.all(resolvedBgm.map(async (bgm, index) => {
        const placement = payload.resource.musicCues[index]
        if (!placement) throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_BGM_PLACEMENT_MISSING:${String(index)}`)
        const musicPath = path.join(workspaceDir, `bgm-source-${String(index)}`)
        await writeFile(musicPath, await getObjectBuffer(bgm.storageKey))
        return { ...placement, musicPath }
      }))
      await muxVideoMergeMusicCues({
        runCommand: createFfmpegCommandRunner({
          stage: 'workspace_resource_video_merge_mux',
          expectedDurationSeconds: stitchedDurationSeconds,
        }),
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        musicCues,
        outputPath,
        durationSeconds: stitchedDurationSeconds,
      })
    } else {
      await muxVideoMergeSourceAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'workspace_resource_video_merge_mux',
          expectedDurationSeconds: stitchedDurationSeconds,
        }),
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        outputPath,
        durationSeconds: stitchedDurationSeconds,
      })
    }

    await reportTaskProgress(context, 92, { stage: 'workspace_resource_video_merge_persist' })
    await assertTaskActive(context, 'persist_workspace_resource_video_merge')
    const outputBuffer = await readFile(outputPath)
    const storageKey = await uploadObject(
      outputBuffer,
      buildTaskArtifactStorageKey({
        taskId: data.taskId,
        artifact: `workspace-resource-video-merge:${payload.resource.resourceId}`,
        extension: 'mp4',
      }),
      'video/mp4',
    )
    const media = await ensureMediaObjectFromStorageKey(storageKey, {
      mimeType: 'video/mp4',
      sizeBytes: outputBuffer.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      durationMs: Math.round(stitchedDurationSeconds * 1000),
    })
    const posterBuffer = await readFile(posterPath)
    const posterStorageKey = await uploadObject(
      posterBuffer,
      buildTaskArtifactStorageKey({
        taskId: data.taskId,
        artifact: `workspace-resource-video-merge-poster:${payload.resource.resourceId}`,
        extension: 'jpg',
      }),
      'image/jpeg',
    )
    const poster = await ensureMediaObjectFromStorageKey(posterStorageKey, {
      mimeType: 'image/jpeg',
      sizeBytes: posterBuffer.byteLength,
      width: dimensions.width,
      height: dimensions.height,
    })
    return {
      mediaId: media.id,
      posterMediaId: poster.id,
      videoUrl: media.url,
      storageKey: media.storageKey,
      durationMs: Math.round(stitchedDurationSeconds * 1000),
      width: dimensions.width,
      height: dimensions.height,
      clipCount: ordered.length,
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
