import { access, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskExecutionContext } from '@/lib/task/execution/context'

const mocks = vi.hoisted(() => ({ media: vi.fn(), upload: vi.fn(), register: vi.fn(), extract: vi.fn(), active: vi.fn() }))
vi.mock('@/lib/workspace-resource/input-media', () => ({ resolveWorkspaceResourceInputMedia: mocks.media }))
vi.mock('@/lib/storage', () => ({ getObjectBuffer: async () => Buffer.from('source'), uploadObject: mocks.upload }))
vi.mock('@/lib/media/service', () => ({ ensureMediaObjectFromStorageKey: mocks.register }))
vi.mock('@/lib/task/execution/progress', () => ({ reportTaskProgress: vi.fn() }))
vi.mock('@/lib/task/execution/provider-media', () => ({ assertTaskActive: mocks.active }))
vi.mock('@/lib/video-compose/ffmpeg-command', () => ({
  probeMediaDurationSeconds: async () => 2, createFfmpegCommandRunner: vi.fn(),
}))
vi.mock('@/lib/video-compose/video-merge-ffmpeg', () => ({
  normalizeVideoClip: vi.fn(),
  probeVideoDimensions: async () => ({ width: 64, height: 96 }),
  concatVideoClips: async ({ outputPath }: { outputPath: string }) => { await writeFile(outputPath, 'rendered-video') },
  extractVideoPosterFrame: mocks.extract,
}))
import { handleWorkspaceResourceVideoMergeTask } from '@/lib/task/execution/handlers/workspace-resource-video-merge'

const references = [0, 1].map((position) => ({ resourceId: `clip-${position}`, contentVersion: 1,
  workspacePath: `视频/${position}`, role: 'source_video', position }))
const context = () => ({ data: {
  taskId: 'poster-task', userId: 'owner', projectId: 'project', targetType: 'WorkspaceResource', targetId: 'merged',
  payload: {
    lifecycleProjection: { resources: [{ resourceId: 'merged', mediaType: 'video', schemaId: 'project.composite_video', name: '成片' }] },
    resource: { resourceId: 'merged', mediaType: 'video', schemaId: 'project.composite_video',
      prompt: null, modelKey: null, inputHash: 'a'.repeat(64), generationOptions: {}, toolCallId: null,
      inputs: references, musicCues: [], edit: { clips: references.map((input) => ({ inputPosition: input.position, startFrame: 0, frameCount: 30 })),
        width: 64, height: 96, aspectRatio: '2:3', audioMode: 'mute',
        cover: { videoIndex: 1, frame: 0, timestampFrame: 30 },
      },
    },
  },
} } as unknown as TaskExecutionContext)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.media.mockResolvedValue(references.map((reference) => ({ reference, storageKey: reference.resourceId })))
  mocks.extract.mockImplementation(async ({ outputPath }) => { await writeFile(outputPath, 'poster-image') })
  mocks.upload.mockImplementation(async (_body, key) => key)
  mocks.register.mockImplementation(async (storageKey, metadata) => ({
    id: metadata.mimeType === 'image/jpeg' ? 'poster-media' : 'video-media', storageKey, url: '/m/registered',
  }))
})

describe('merge task poster artifacts', () => {
  it('uploads a separate JPEG and returns its media identity with the video, then removes scratch files', async () => {
    const result = await handleWorkspaceResourceVideoMergeTask(context())
    expect(result).toMatchObject({ mediaId: 'video-media', posterMediaId: 'poster-media', durationMs: 2000, clipCount: 2 })
    expect(mocks.extract).toHaveBeenCalledWith(expect.objectContaining({ timestampSeconds: 1, durationSeconds: 2 }))
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.upload.mock.calls.map(([body]) => body.toString())).toEqual(['rendered-video', 'poster-image'])
    expect(mocks.upload.mock.calls.map((call) => call[2])).toEqual(['video/mp4', 'image/jpeg'])
    expect(mocks.register).toHaveBeenCalledWith(expect.stringMatching(/\.jpg$/), expect.objectContaining({ mimeType: 'image/jpeg', width: 64, height: 96 }))
    await expect(access(mocks.extract.mock.calls[0][0].outputPath)).rejects.toThrow()
  })

  it('does not publish a successful output when poster extraction fails', async () => {
    mocks.extract.mockRejectedValue(new Error('POSTER_EXTRACTION_FAILED'))
    await expect(handleWorkspaceResourceVideoMergeTask(context())).rejects.toThrow('POSTER_EXTRACTION_FAILED')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
