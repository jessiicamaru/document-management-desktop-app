// Inline text editing for Markdown documents.
//
// 1. sourceRangesPlugin tags every editable block (paragraph, heading, table cell) in the
//    rendered HTML with data-src="start:end": its character range in the .md file.
// 2. While editing, those blocks are plain-text editable. On save, for each changed block we
//    know the text before and after the edit, and the Markdown source of the block.
// 3. alignText maps each character of the rendered text to the same character in the source
//    (skipping Markdown syntax like **, #, [](...)), diffWords finds what changed, and only
//    those characters are replaced in the source, so formatting around them is kept.
// The caller re-renders the result and checks the text matches before writing anything.

import type MarkdownItModule from 'markdown-it'

type MarkdownIt = InstanceType<typeof MarkdownItModule>

export class MdEditError extends Error {}

export interface MdBlockEdit {
  /** Range of the block in the source file (from data-src). */
  start: number
  end: number
  /** Rendered text before and after editing. */
  oldText: string
  newText: string
}

interface RangeEnv {
  /** Character offset of each line start, relative to the text given to markdown-it. */
  lineStarts?: number[]
  /** Where that text starts in the file (front matter is cut off before rendering). */
  offset?: number
  length?: number
}

export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/** Splits a table row line into cell ranges [start, end) on unescaped "|". */
export function tableCellRanges(line: string): [number, number][] {
  const cuts: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '|') cuts.push(i)
  }
  const cells: [number, number][] = []
  let from = 0
  for (const cut of [...cuts, line.length]) {
    cells.push([from, cut])
    from = cut + 1
  }
  // A leading/trailing pipe produces an empty cell outside the table: drop it.
  if (line.slice(cells[0][0], cells[0][1]).trim() === '' && cuts.length && line.trimStart().startsWith('|')) cells.shift()
  const last = cells[cells.length - 1]
  if (last && line.slice(last[0], last[1]).trim() === '' && line.trimEnd().endsWith('|')) cells.pop()
  return cells
}

/** markdown-it plugin: adds data-src="start:end" to editable blocks when env.lineStarts is given. */
export function sourceRangesPlugin(md: MarkdownIt): void {
  md.core.ruler.push('source_ranges', (state) => {
    const env = state.env as RangeEnv
    if (!env.lineStarts) return
    const starts = env.lineStarts
    const offset = env.offset ?? 0
    const total = env.length ?? state.src.length
    const lineStart = (l: number): number => (l < starts.length ? starts[l] : total)
    const tokens = state.tokens

    tokens.forEach((t, i) => {
      if ((t.type === 'paragraph_open' || t.type === 'heading_open') && t.map) {
        t.attrSet('data-src', `${offset + lineStart(t.map[0])}:${offset + lineStart(t.map[1])}`)
        if (t.type === 'paragraph_open' && t.hidden) {
          // Tight list items don't render <p>; wrap the text in a <span> that carries the range.
          t.meta = { ...t.meta, sdSpan: true }
          const close = tokens.slice(i + 1).find((x) => x.type === 'paragraph_close' && x.level === t.level)
          if (close) close.meta = { ...close.meta, sdSpan: true }
        }
      }
      if (t.type === 'tr_open' && t.map) {
        const lineFrom = lineStart(t.map[0])
        const line = state.src.slice(lineFrom, lineStart(t.map[0] + 1)).replace(/\r?\n$/, '')
        const cells = tableCellRanges(line)
        const cellTokens = []
        for (let j = i + 1; j < tokens.length && tokens[j].type !== 'tr_close'; j++) {
          if (tokens[j].type === 'td_open' || tokens[j].type === 'th_open') cellTokens.push(tokens[j])
        }
        if (cellTokens.length !== cells.length) return // unusual row: leave it read-only
        cellTokens.forEach((cell, k) => {
          cell.attrSet('data-src', `${offset + lineFrom + cells[k][0]}:${offset + lineFrom + cells[k][1]}`)
        })
      }
    })
  })

  const renderParagraph = (tag: 'open' | 'close') => {
    const key = tag === 'open' ? 'paragraph_open' : 'paragraph_close'
    const fallback = md.renderer.rules[key]
    md.renderer.rules[key] = (tokens, idx, options, env, self) => {
      const t = tokens[idx]
      if (t.hidden && t.meta?.sdSpan) {
        return tag === 'open' ? `<span data-src="${md.utils.escapeHtml(String(t.attrGet('data-src') ?? ''))}">` : '</span>'
      }
      return fallback ? fallback(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
    }
  }
  renderParagraph('open')
  renderParagraph('close')
}

/**
 * Maps each character of `text` to its position in `source`, in order, skipping anything
 * in the source that isn't in the text (Markdown syntax). Returns null if impossible.
 */
export function alignText(source: string, text: string): number[] | null {
  const map: number[] = []
  let j = 0
  for (let i = 0; i < text.length; i++) {
    while (j < source.length && source[j] !== text[i]) j++
    if (j >= source.length) return null
    map.push(j++)
  }
  return map
}

export interface Hunk {
  /** Range in the old text that is replaced... */
  start: number
  end: number
  /** ...by this text. */
  insert: string
}

const tokenize = (s: string): string[] => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []

/** Word-level diff: the smallest set of replacements turning `a` into `b`. */
export function diffWords(a: string, b: string): Hunk[] {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  if (p === a.length && p === b.length) return []

  // Diff only the middle part, on whole words, re-including the partial words at its edges.
  const wordStart = (str: string, i: number): number => {
    while (i > 0 && /[\p{L}\p{N}_]/u.test(str[i - 1])) i--
    return i
  }
  const from = wordStart(a, p)
  const A = tokenize(a.slice(from, a.length - s))
  const B = tokenize(b.slice(from, b.length - s))
  if (A.length * B.length > 4_000_000) return [{ start: p, end: a.length - s, insert: b.slice(p, b.length - s) }]

  // Classic LCS table on tokens.
  const n = A.length
  const m = B.length
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = A[i] === B[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }

  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let posA = from
  let current: Hunk | null = null
  const flush = (): void => {
    if (current) hunks.push(current)
    current = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      flush()
      posA += A[i].length
      i++
      j++
    } else if (j < m && (i >= n || dp[at(i, j + 1)] >= dp[at(i + 1, j)])) {
      current ??= { start: posA, end: posA, insert: '' }
      current.insert += B[j++]
    } else {
      current ??= { start: posA, end: posA, insert: '' }
      posA += A[i].length
      current.end = posA
      i++
    }
  }
  flush()
  return hunks
}

/** Escapes characters that Markdown would treat as syntax inside a line of text. */
export function escapeMarkdownText(s: string): string {
  return s.replace(/[\\`*_[\]<>|~]/g, '\\$&')
}

/** Applies text edits to the Markdown source. Throws MdEditError if a block can't be mapped. */
export function applyMarkdownEdits(source: string, edits: MdBlockEdit[]): string {
  let out = source
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    const segment = out.slice(edit.start, edit.end)
    const map = alignText(segment, edit.oldText)
    if (!map) throw new MdEditError('Không khớp được đoạn văn với file Markdown. Hãy sửa đoạn này trong raw.')
    let next = segment
    for (const h of diffWords(edit.oldText, edit.newText).reverse()) {
      let from: number
      let to: number
      if (h.end > h.start) {
        from = map[h.start]
        to = map[h.end - 1] + 1
      } else {
        // Pure insertion: right after the previous character (so it joins its formatting).
        from = to = h.start > 0 ? map[h.start - 1] + 1 : (map[0] ?? 0)
      }
      next = next.slice(0, from) + escapeMarkdownText(h.insert) + next.slice(to)
    }
    out = out.slice(0, edit.start) + next + out.slice(edit.end)
  }
  return out
}
