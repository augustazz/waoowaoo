import { describe, expect, it, vi } from 'vitest'
import { renderVideoMergeClipAudio } from '@/lib/video-compose/video-merge-audio'

const measured = {
  input_i: '-18.50', input_tp: '-3.20', input_lra: '4.10', input_thresh: '-28.70',
  output_i: '-16.00', output_tp: '-1.50', target_offset: '0.00',
}

async function render(stderr: string) {
  const runCommand = vi.fn().mockImplementation(async (command, args: string[]) => (
    command === 'ffprobe' ? { stdout: '1\n', stderr: '' }
      : args.includes('null') ? { stdout: '', stderr }
        : { stdout: '', stderr: '' }
  ))
  const result = renderVideoMergeClipAudio({
    runCommand, sourcePath: '/tmp/source.mp4', outputPath: '/tmp/audio.wav', startSeconds: 0, durationSeconds: 9,
  })
  return { result, runCommand }
}

describe('FFmpeg loudnorm stderr parsing', () => {
  it('isolates loudnorm JSON from source metadata containing braces, quotes, tabs and newlines', async () => {
    const stderr = 'Input #0:\n  Metadata:\n    description: {"prompt":"a quoted scene\nwith\ttags and {nested} braces"}\n'
      + '[Parsed_loudnorm_2 @ 0x1234]\n' + JSON.stringify(measured, null, '\t')
      + '\nOutput log: {unrelated}\n'
    const { result, runCommand } = await render(stderr)
    await expect(result).resolves.toBe(true)
    const filter = runCommand.mock.calls.at(-1)?.[1].join(' ')
    expect(filter).toContain('measured_I=-18.500')
    expect(filter).toContain('measured_TP=-3.200')
    expect(filter).toContain('atrim=0:9.000')
  })

  it.each(['\n', '\r\n'])('accepts a valid standalone analysis using %j line endings', async (newline) => {
    const { result } = await render(JSON.stringify(measured, null, '  ').replaceAll('\n', newline))
    await expect(result).resolves.toBe(true)
  })

  it.each([
    { ...measured, input_i: '-inf', input_tp: '-inf', input_lra: '0.00', output_i: '-inf', output_tp: '-inf', target_offset: 'inf' },
    { ...measured, input_i: '-inf', input_lra: '0.00', output_i: '-inf', target_offset: 'inf' },
  ])('preserves the existing silence and short-signal handling', async (measurement) => {
    const { result, runCommand } = await render(JSON.stringify(measurement))
    await expect(result).resolves.toBe(true)
    const filter = runCommand.mock.calls.at(-1)?.[1].join(' ')
    expect(filter).not.toContain('measured_I=')
    expect(filter).toContain(measurement.input_tp === '-inf' ? 'anull' : 'alimiter=limit=0.95')
  })

  it.each([
    'no analysis', '{"input_i":"bad\nvalue"}', '{"input_i":"-18.50"}',
    JSON.stringify({ ...measured, input_tp: 'NaN' }),
  ])('reports invalid analysis as an audio-analysis failure without silently dropping audio', async (stderr) => {
    const { result, runCommand } = await render(stderr)
    await expect(result).rejects.toThrow('VIDEO_MERGE_LOUDNESS_ANALYSIS_FAILED')
    expect(runCommand).toHaveBeenCalledTimes(2)
  })
})
