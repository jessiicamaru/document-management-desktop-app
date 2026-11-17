// Accent-insensitive text helpers used by search (Vietnamese: "su kien" finds "sự kiện").

/**
 * Typographic punctuation folded to plain ASCII ("—" finds "-", "“" finds '"'). Besides
 * being friendlier to search, it keeps the folded text of most books (Vietnamese, English)
 * free of characters above U+00FF, so V8 stores it with 1 byte per character instead of 2
 * (issue #12: the search worker keeps every folded text in memory).
 */
const PUNCT: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '.', '•': '*', '‧': '.',
  '​': ' ', '‌': ' ', '‍': ' ', '⁠': ' ', '﻿': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': '\n', ' ': '\n'
}
const PUNCT_RE = new RegExp(`[${Object.keys(PUNCT).join('')}]`, 'g')

/** Lowercase and drop Vietnamese accents. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(PUNCT_RE, (c) => PUNCT[c])
    .toLowerCase()
}

const folded = new Map<string, string>()

/**
 * Like normalize(), but keeps the length: character i of the result is character i of the
 * input with its accent removed. So a match position found in the folded text is the same
 * position in the original text, which is what snippets need.
 *
 * Built in a character buffer, not by adding strings together: a book has millions of
 * accented letters, and joining that many small strings costs gigabytes of memory.
 */
export function foldAccents(s: string): string {
  const codes = new Uint16Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 0x80) {
      codes[i] = code >= 65 && code <= 90 ? code + 32 : code // A-Z -> a-z
      continue
    }
    const ch = s[i]
    let f = folded.get(ch)
    if (f === undefined) {
      const n = normalize(ch)
      f = n.length === 1 ? n : n.length === 0 ? ' ' : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch
      folded.set(ch, f)
    }
    codes[i] = f.charCodeAt(0)
  }
  // Turn the buffer into one flat string, a slice at a time (fromCharCode takes a limited number of arguments).
  const parts: string[] = []
  for (let i = 0; i < codes.length; i += 8192) parts.push(String.fromCharCode(...codes.subarray(i, i + 8192)))
  return parts.join('')
}

/**
 * Text of a .txt file whatever its encoding: a BOM says UTF-8 / UTF-16; otherwise UTF-8 if
 * it is valid, else Windows-1258 (old Vietnamese Windows files).
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1258').decode(bytes)
  }
}

export interface Snippet {
  before: string
  match: string
  after: string
}

/** A short piece of `text` around [start, end). */
export function snippetAt(text: string, start: number, end: number, radius = 60): Snippet {
  const from = Math.max(0, start - radius)
  const to = Math.min(text.length, end + radius)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? '…' : '')
  }
}

/**
 * Finds where `query` occurs in `text` (accent-insensitive): the whole query as a phrase
 * first ("su kien" -> "sự kiện"), otherwise the earliest of the given terms.
 * `foldedText` may be passed when it was already computed (big texts).
 */
export function findInText(text: string, query: string, terms: string[], foldedText = foldAccents(text)): { start: number; end: number } | null {
  const phrase = normalize(query.trim()).replace(/\s+/g, ' ')
  if (phrase.includes(' ')) {
    const i = foldedText.indexOf(phrase)
    if (i >= 0) return { start: i, end: i + phrase.length }
  }
  let best: { start: number; end: number } | null = null
  for (const t of terms) {
    const i = foldedText.indexOf(t)
    if (i >= 0 && (!best || i < best.start)) best = { start: i, end: i + t.length }
  }
  return best
}

/** Cuts a short piece of `text` around the search match. */
export function makeSnippet(text: string, query: string, terms: string[], radius = 60): Snippet {
  const at = findInText(text, query, terms)
  return at ? snippetAt(text, at.start, at.end, radius) : { before: text.slice(0, radius * 2), match: '', after: '' }
}
