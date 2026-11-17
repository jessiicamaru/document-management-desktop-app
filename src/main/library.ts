// Scans the library folder and pulls a title + searchable text out of each document.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocEntry, DocKind } from '../shared/types'

/** A document as found inside one folder: `path` is relative to that folder. */
export type ScannedDoc = Omit<DocEntry, 'root' | 'rel'>

/** How many files are read at the same time while scanning. */
const READ_CONCURRENCY = 16

/**
 * Turns a library-relative path into an absolute one.
 * Returns null for anything that would land outside the library (e.g. "../secret.txt").
 */
export function resolveInLibrary(root: string, rel: string): string | null {
  const base = path.resolve(root)
  const abs = path.resolve(base, rel)
  return abs.startsWith(base + path.sep) ? abs : null
}

const EXTENSIONS: Record<string, DocKind> = {
  '.md': 'md',
  '.markdown': 'md',
  '.html': 'html',
  '.htm': 'html'
}

/** Files bigger than this are listed but not indexed for search. */
const MAX_INDEX_BYTES = 5 * 1024 * 1024

function shouldSkipDir(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

export function kindOf(file: string): DocKind | null {
  return EXTENSIONS[path.extname(file).toLowerCase()] ?? null
}

/**
 * Walks the folder recursively and returns every .md / .html document.
 * Pass the previous result as `cache`: files whose size and modified time did not
 * change are reused instead of being read again.
 */
export async function scanLibrary(root: string, cache: ScannedDoc[] = []): Promise<ScannedDoc[]> {
  const files: { abs: string; kind: DocKind }[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // folder vanished or no permission: just skip it
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) await walk(abs)
        continue
      }
      const kind = kindOf(entry.name)
      if (entry.isFile() && kind) files.push({ abs, kind })
    }
  }
  await walk(root)

  const previous = new Map(cache.map((d) => [d.path, d]))
  const docs: ScannedDoc[] = []
  for (let i = 0; i < files.length; i += READ_CONCURRENCY) {
    const batch = files.slice(i, i + READ_CONCURRENCY)
    const results = await Promise.all(batch.map((f) => readEntry(root, f.abs, f.kind, previous)))
    for (const doc of results) if (doc) docs.push(doc)
  }
  docs.sort((a, b) => a.path.localeCompare(b.path, 'vi'))
  return docs
}

async function readEntry(root: string, abs: string, kind: DocKind, previous: Map<string, ScannedDoc>): Promise<ScannedDoc | null> {
  try {
    const stat = await fs.stat(abs)
    const rel = path.relative(root, abs).split(path.sep).join('/')
    const cached = previous.get(rel)
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached

    const name = path.basename(abs)
    const fallbackTitle = name.replace(/\.[^.]+$/, '')
    let title = fallbackTitle
    let text = ''
    let hash: string | undefined
    if (stat.size <= MAX_INDEX_BYTES) {
      const buffer = await fs.readFile(abs)
      hash = createHash('sha1').update(buffer).digest('hex')
      const source = buffer.toString('utf8')
      const extracted = kind === 'html' ? extractHtml(source) : extractMarkdown(source)
      title = extracted.title || fallbackTitle
      text = extracted.text
    }
    return { path: rel, name, kind, title, text, size: stat.size, mtime: stat.mtimeMs, hash }
  } catch {
    return null
  }
}

// ---------- text extraction ----------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…'
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
}

export function extractHtml(source: string): { title: string; text: string } {
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const h1Match = source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = collapse(stripTags(titleMatch?.[1] ?? h1Match?.[1] ?? ''))

  const body = source
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  return { title, text: collapse(stripTags(body)) }
}

export function extractMarkdown(source: string): { title: string; text: string } {
  let body = source
  let title = ''

  // Optional YAML front matter: only `title:` is read here.
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fm) {
    const t = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (t) title = t[1]
    body = body.slice(fm[0].length)
  }
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m)
    if (h1) title = h1[1].trim()
  }

  const text = body
    .replace(/```[\w-]*\n?/g, ' ') // keep code contents, drop fences
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> link text
    .replace(/[#>*_`~|-]+/g, ' ')
  return { title, text: collapse(stripTags(text)) }
}
