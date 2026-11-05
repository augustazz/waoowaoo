export type TextDiffLineKind = 'same' | 'added' | 'removed'

export interface TextDiffLine {
  readonly kind: TextDiffLineKind
  readonly text: string
  readonly oldLine: number | null
  readonly newLine: number | null
}

export type TextDiffResult =
  | { readonly supported: true; readonly lines: readonly TextDiffLine[] }
  | { readonly supported: false; readonly reason: 'too_large' }

// Screenplays are usually a few hundred lines. Cap the LCS table so a pasted
// multi-megabyte document cannot freeze the workbench.
const MAX_DIFF_LINES = 1_500

function splitTextLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  return normalized.length === 0 ? [] : normalized.split('\n')
}

/**
 * Line-level LCS diff. Returns the operations needed to turn `before` into
 * `after`, with the original line number on each side.
 */
export function diffTextLines(before: string, after: string): TextDiffResult {
  const oldLines = splitTextLines(before)
  const newLines = splitTextLines(after)
  if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
    return { supported: false, reason: 'too_large' }
  }

  const oldCount = oldLines.length
  const newCount = newLines.length
  const width = newCount + 1
  // Uint16Array is enough for 1,500 lines and keeps the table small.
  const lcs = new Uint16Array((oldCount + 1) * width)
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex * width + newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? lcs[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(
            lcs[(oldIndex + 1) * width + newIndex],
            lcs[oldIndex * width + newIndex + 1],
          )
    }
  }

  const lines: TextDiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  let oldLine = 1
  let newLine = 1

  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({ kind: 'same', text: oldLines[oldIndex], oldLine, newLine })
      oldIndex += 1
      newIndex += 1
      oldLine += 1
      newLine += 1
    } else if (
      lcs[(oldIndex + 1) * width + newIndex] >= lcs[oldIndex * width + newIndex + 1]
    ) {
      lines.push({ kind: 'removed', text: oldLines[oldIndex], oldLine, newLine: null })
      oldIndex += 1
      oldLine += 1
    } else {
      lines.push({ kind: 'added', text: newLines[newIndex], oldLine: null, newLine })
      newIndex += 1
      newLine += 1
    }
  }

  while (oldIndex < oldCount) {
    lines.push({ kind: 'removed', text: oldLines[oldIndex], oldLine, newLine: null })
    oldIndex += 1
    oldLine += 1
  }
  while (newIndex < newCount) {
    lines.push({ kind: 'added', text: newLines[newIndex], oldLine: null, newLine })
    newIndex += 1
    newLine += 1
  }

  return { supported: true, lines }
}
