import { describe, expect, it } from 'vitest'
import { diffTextLines } from '@/features/project-workspace/canvas/script/diff-text'

function simplify(lines: readonly { kind: string; text: string; oldLine: number | null; newLine: number | null }[]) {
  return lines.map((line) => ({
    kind: line.kind,
    text: line.text,
    oldLine: line.oldLine,
    newLine: line.newLine,
  }))
}

describe('diffTextLines', () => {
  it('marks identical documents as unchanged', () => {
    const result = diffTextLines('第一场\n客厅', '第一场\n客厅')
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.lines.every((line) => line.kind === 'same')).toBe(true)
    expect(result.lines.map((line) => line.text)).toEqual(['第一场', '客厅'])
  })

  it('marks an inserted line as added', () => {
    const result = diffTextLines('第一场\n第二场', '第一场\n新增段落\n第二场')
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(simplify(result.lines)).toEqual([
      { kind: 'same', text: '第一场', oldLine: 1, newLine: 1 },
      { kind: 'added', text: '新增段落', oldLine: null, newLine: 2 },
      { kind: 'same', text: '第二场', oldLine: 2, newLine: 3 },
    ])
  })

  it('marks a removed line as removed', () => {
    const result = diffTextLines('第一场\n旧段落\n第二场', '第一场\n第二场')
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(simplify(result.lines)).toEqual([
      { kind: 'same', text: '第一场', oldLine: 1, newLine: 1 },
      { kind: 'removed', text: '旧段落', oldLine: 2, newLine: null },
      { kind: 'same', text: '第二场', oldLine: 3, newLine: 2 },
    ])
  })

  it('represents a replacement as a removal followed by an addition', () => {
    const result = diffTextLines('旧对白', '新对白')
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.lines.map((line) => line.kind)).toEqual(['removed', 'added'])
    expect(result.lines[0]).toMatchObject({ text: '旧对白', oldLine: 1, newLine: null })
    expect(result.lines[1]).toMatchObject({ text: '新对白', oldLine: null, newLine: 1 })
  })

  it('normalizes CRLF and handles empty sides', () => {
    const result = diffTextLines('第一场\r\n客厅', '第一场\n客厅\n新增')
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.lines.map((line) => line.text)).toEqual(['第一场', '客厅', '新增'])
    expect(result.lines[2]?.kind).toBe('added')

    const fromEmpty = diffTextLines('', '第一场')
    expect(fromEmpty.supported).toBe(true)
    if (!fromEmpty.supported) return
    expect(fromEmpty.lines).toEqual([{ kind: 'added', text: '第一场', oldLine: null, newLine: 1 }])

    const toEmpty = diffTextLines('第一场', '')
    expect(toEmpty.supported).toBe(true)
    if (!toEmpty.supported) return
    expect(toEmpty.lines).toEqual([{ kind: 'removed', text: '第一场', oldLine: 1, newLine: null }])
  })

  it('rejects documents above the diff line cap', () => {
    const text = Array.from({ length: 1_501 }, (_, index) => `line ${String(index)}`).join('\n')
    const result = diffTextLines(text, text)
    expect(result.supported).toBe(false)
    if (result.supported) return
    expect(result.reason).toBe('too_large')
  })
})
