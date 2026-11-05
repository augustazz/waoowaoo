export type ScreenplayLineKind =
  | 'blank'
  | 'action'
  | 'dialogue'
  | 'parenthetical'

export interface ScreenplayLine {
  readonly kind: ScreenplayLineKind
  readonly text: string
  /** Character name for dialogue lines only. */
  readonly character: string | null
}

export interface ScreenplayScene {
  readonly index: number
  readonly heading: string | null
  readonly lines: readonly ScreenplayLine[]
  readonly text: string
}

const SCENE_HEADING_PATTERNS: readonly RegExp[] = [
  /^(?:INT|EXT|INT\/EXT|I\/E)[.．\s-]/i,
  /^(?:第\s*[0-9零一二三四五六七八九十百千]+\s*[场幕集])(?:\s|$|[：:·.\-—])/,
  /^(?:场景|场次)\s*[0-9零一二三四五六七八九十百千]+/,
  /^[0-9]+(?:[.、．-][0-9]+)*[.、．]?\s*(?:内景|外景|内外景)/,
  /^(?:内景|外景|内外景)\s*[：:·.\-—]/,
]

/** Heuristic only: the original text is always preserved for display. */
export function isScreenplaySceneHeading(value: string): boolean {
  const line = value.trim()
  if (!line || line.length > 80) return false
  return SCENE_HEADING_PATTERNS.some((pattern) => pattern.test(line))
}

const DIALOGUE_PATTERN = /^([^\s：:，,。！？!?]{1,16})\s*[：:]\s*(.+)$/u

function screenplayLine(value: string): ScreenplayLine {
  const text = value.trim()
  if (!text) return { kind: 'blank', text: '', character: null }
  if (/^[（(].*[)）]$/u.test(text)) {
    return { kind: 'parenthetical', text, character: null }
  }
  const dialogue = DIALOGUE_PATTERN.exec(text)
  if (dialogue) {
    return {
      kind: 'dialogue',
      text: dialogue[2]?.trim() ?? '',
      character: dialogue[1]?.trim() ?? null,
    }
  }
  return { kind: 'action', text, character: null }
}

/**
 * Splits a screenplay into scenes using common Chinese and English scene
 * heading conventions. When no heading is recognized the whole text becomes a
 * single scene, so the workbench never loses or reorders content.
 */
export function parseScreenplayScenes(text: string): ScreenplayScene[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const scenes: Array<{ heading: string | null; lines: string[] }> = []
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] }
  let sawHeading = false
  for (const line of lines) {
    if (isScreenplaySceneHeading(line)) {
      if (sawHeading || current.lines.some((value) => value.trim())) {
        scenes.push(current)
      }
      current = { heading: line.trim(), lines: [] }
      sawHeading = true
      continue
    }
    current.lines.push(line)
  }
  if (sawHeading || current.lines.some((value) => value.trim())) {
    scenes.push(current)
  }
  if (scenes.length === 0) {
    return [{
      index: 0,
      heading: null,
      lines: lines.map(screenplayLine),
      text,
    }]
  }
  return scenes.map((scene, index) => ({
    index,
    heading: scene.heading,
    lines: scene.lines.map(screenplayLine),
    text: [scene.heading, ...scene.lines].filter((value): value is string => value !== null).join('\n').trim(),
  }))
}
