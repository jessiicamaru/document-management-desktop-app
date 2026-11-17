// Small helpers used across the UI.

import MiniSearch from 'minisearch'
import { DEFAULT_META, type DocEntry, type DocMeta, type StudyStatus } from '../../../shared/types'

export const STATUSES: { id: StudyStatus; label: string }[] = [
  { id: 'new', label: 'Chưa học' },
  { id: 'learning', label: 'Đang học' },
  { id: 'review', label: 'Cần ôn' },
  { id: 'done', label: 'Đã thuộc' }
]

export const statusLabel = (s: StudyStatus): string => STATUSES.find((x) => x.id === s)?.label ?? s

export function metaOf(meta: Record<string, DocMeta>, path: string): DocMeta {
  return { ...DEFAULT_META, ...meta[path] }
}

/** URL the main process serves a document at (see protocol.handle in src/main/index.ts). */
export function docUrl(path: string): string {
  return 'doc://library/' + path.split('/').map(encodeURIComponent).join('/')
}

/** Inverse of docUrl: returns the library-relative path and #hash, or null for non-library URLs. */
export function parseDocUrl(url: string): { path: string; hash: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'doc:') return null
    return {
      path: decodeURIComponent(u.pathname).replace(/^\/+/, ''),
      hash: decodeURIComponent(u.hash.replace(/^#/, ''))
    }
  } catch {
    return null
  }
}

/** Error from window.api calls without Electron's "Error invoking remote method ..." prefix. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// ---------- search ----------

/** Lowercase and drop Vietnamese accents, so "su kien" finds "sự kiện". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

interface IndexedDoc {
  path: string
  title: string
  name: string
  text: string
  tags: string
}

export function buildIndex(docs: DocEntry[], meta: Record<string, DocMeta>): MiniSearch<IndexedDoc> {
  const index = new MiniSearch<IndexedDoc>({
    idField: 'path',
    fields: ['title', 'name', 'tags', 'text'],
    processTerm: (term) => normalize(term),
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
      boost: { title: 4, tags: 3, name: 2 }
    }
  })
  index.addAll(
    docs.map((d) => ({
      path: d.path,
      title: d.title,
      name: d.name,
      text: d.text,
      tags: (meta[d.path]?.tags ?? []).join(' ')
    }))
  )
  return index
}

export interface Snippet {
  before: string
  match: string
  after: string
}

/**
 * Cuts a short piece of `text` around the search match. Prefers the whole query as a
 * phrase ("su kien" -> "sự kiện"), and falls back to the first single matched term.
 */
export function makeSnippet(text: string, query: string, terms: string[], radius = 60): Snippet {
  // Build an accent-free copy plus a map back to positions in the original text.
  let norm = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    for (const c of normalize(text[i])) {
      norm += c
      map.push(i)
    }
  }
  let best = -1
  let len = 0
  const phrase = normalize(query.trim()).replace(/\s+/g, ' ')
  const phraseIdx = phrase.includes(' ') ? norm.indexOf(phrase) : -1
  if (phraseIdx >= 0) {
    best = phraseIdx
    len = phrase.length
  }
  for (const t of best >= 0 ? [] : terms) {
    const idx = norm.indexOf(t)
    if (idx >= 0 && (best < 0 || idx < best)) {
      best = idx
      len = t.length
    }
  }
  if (best < 0) return { before: text.slice(0, radius * 2), match: '', after: '' }
  const start = map[best]
  const end = map[best + len - 1] + 1
  const from = Math.max(0, start - radius)
  const to = Math.min(text.length, end + radius)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? '…' : '')
  }
}

// ---------- folder tree ----------

export interface TreeFolder {
  name: string
  path: string
  folders: TreeFolder[]
  docs: DocEntry[]
}

/**
 * Groups documents into nested folders by their path inside their workspace folder (doc.rel).
 * `prefix` is put in front of every folder path, so folders of different workspace
 * folders get distinct ids (used to remember which ones are collapsed).
 */
export function buildTree(docs: DocEntry[], prefix = ''): TreeFolder {
  const root: TreeFolder = { name: '', path: prefix, folders: [], docs: [] }
  for (const doc of docs) {
    const parts = doc.rel.split('/')
    let cur = root
    for (const part of parts.slice(0, -1)) {
      let next = cur.folders.find((f) => f.name === part)
      if (!next) {
        next = { name: part, path: cur.path ? `${cur.path}/${part}` : part, folders: [], docs: [] }
        cur.folders.push(next)
      }
      cur = next
    }
    cur.docs.push(doc)
  }
  const sort = (f: TreeFolder): void => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    f.docs.sort((a, b) => a.title.localeCompare(b.title, 'vi'))
    f.folders.forEach(sort)
  }
  sort(root)
  return root
}

// ---------- tiny localStorage wrapper (never throws) ----------

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
