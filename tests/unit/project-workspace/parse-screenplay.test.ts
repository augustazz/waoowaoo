import { describe, expect, it } from 'vitest'
import { isScreenplaySceneHeading, parseScreenplayScenes } from '@/features/project-workspace/canvas/script/parse-screenplay'

describe('parseScreenplayScenes', () => {
  it('splits common English scene headings and keeps every line', () => {
    const scenes = parseScreenplayScenes([
      'INT. ROOM - DAY',
      'JOHN: Hello.',
      '(smiles)',
      '',
      'EXT. STREET - NIGHT',
      'A car passes.',
    ].join('\n'))
    expect(scenes).toHaveLength(2)
    expect(scenes[0]?.heading).toBe('INT. ROOM - DAY')
    expect(scenes[0]?.lines.map((line) => line.kind)).toEqual(['dialogue', 'parenthetical', 'blank'])
    expect(scenes[1]?.heading).toBe('EXT. STREET - NIGHT')
    expect(scenes[1]?.text).toContain('A car passes.')
  })

  it('recognizes Chinese scene headings and dialogue', () => {
    const scenes = parseScreenplayScenes([
      '第一场 客厅 日',
      '张三：你回来了。',
      '（停顿）',
      '李四：嗯。',
      '第二场 街道 夜',
      '雨下得很大。',
    ].join('\n'))
    expect(scenes).toHaveLength(2)
    expect(scenes[0]?.heading).toBe('第一场 客厅 日')
    expect(scenes[0]?.lines[0]).toMatchObject({ kind: 'dialogue', character: '张三', text: '你回来了。' })
    expect(scenes[1]?.heading).toBe('第二场 街道 夜')
    expect(isScreenplaySceneHeading('第一场 客厅 日')).toBe(true)
  })

  it('returns one whole-text scene when no heading is recognized', () => {
    const scenes = parseScreenplayScenes('Just a line.\nAnother line.')
    expect(scenes).toHaveLength(1)
    expect(scenes[0]?.heading).toBeNull()
    expect(scenes[0]?.text).toBe('Just a line.\nAnother line.')
  })
})
