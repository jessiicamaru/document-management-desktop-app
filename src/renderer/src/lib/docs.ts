// Small helpers used across the UI.

import { DEFAULT_META, type DocEntry, type DocMeta, type StudyStatus } from '../../../shared/types'
import { t } from '../../../shared/i18n'

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
// Searching itself runs in a background worker in the main process (window.api.search).

export { normalize, makeSnippet, type Snippet } from '../../../shared/text'

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
 * Folders are sorted by name; documents by title, or newest change first (issue #23).
 */
export function buildTree(docs: DocEntry[], prefix = '', order: 'name' | 'modified' = 'name'): TreeFolder {
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
    f.docs.sort((a, b) => (order === 'modified' && b.mtime !== a.mtime ? b.mtime - a.mtime : a.title.localeCompare(b.title, 'vi')))
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

/** Short badge text for a document type. */
export function kindLabel(kind: DocEntry['kind']): string {
  return kind === 'image' ? t('ẢNH') : kind.toUpperCase()
}

/** Drag data type of a document dragged from the sidebar (dropped on a calendar event to link it). */
export const DOC_DRAG_TYPE = 'application/x-studydocs-doc'
