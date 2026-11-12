import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { extractVideoPosterFrame } from '@/lib/video-compose/video-merge-ffmpeg'
import { runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'

describe('rendered video poster extraction', () => {
  it('extracts the exact selected frame at a clip boundary and a later moment', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wao-poster-test-'))
    try {
      const sourcePath = path.join(directory, 'rendered.mp4')
      // A single blue frame between red and green catches off-by-one seeks.
      await runFfmpegCommand('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=red:s=64x96:r=30:d=1',
        '-f', 'lavfi', '-i', 'color=blue:s=64x96:r=30:d=0.033333333',
        '-f', 'lavfi', '-i', 'color=green:s=64x96:r=30:d=1',
        '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
        '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
      ], { stage: 'poster_fixture', expectedDurationSeconds: 3 })
      for (const [frame, channel] of [[0, 0], [30, 2], [31, 1]] as const) {
        const outputPath = path.join(directory, `poster-${frame}.jpg`)
        await extractVideoPosterFrame({ sourcePath, outputPath, timestampSeconds: frame / 30, durationSeconds: 61 / 30 })
        const poster = sharp(outputPath)
        expect(await poster.metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 96 })
        const pixel = await poster.resize(1, 1).removeAlpha().raw().toBuffer()
        expect(pixel[channel]).toBeGreaterThan(channel === 1 ? 100 : 200)
        expect(pixel[channel]).toBeGreaterThan(pixel[(channel + 1) % 3] + 80)
        expect(pixel[channel]).toBeGreaterThan(pixel[(channel + 2) % 3] + 80)
      }
      await expect(extractVideoPosterFrame({ sourcePath, outputPath: path.join(directory, 'invalid.jpg'),
        timestampSeconds: 61 / 30, durationSeconds: 61 / 30,
      })).rejects.toThrow('WORKSPACE_RESOURCE_VIDEO_MERGE_POSTER_FRAME_INVALID')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
