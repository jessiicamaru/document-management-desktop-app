// Scans the library folder and pulls a title + searchable text out of each document.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
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
  '.htm': 'html',
  '.pdf': 'pdf',
  '.epub': 'epub'
}

/** Files bigger than this are listed but not indexed for search. */
const MAX_INDEX_BYTES = 5 * 1024 * 1024
/** EPUB books are zipped, so they can be bigger and still be indexed. */
const MAX_BOOK_BYTES = 100 * 1024 * 1024
/** At most this much text of a book is kept for search. */
const MAX_BOOK_TEXT = 2 * 1024 * 1024

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
    if (stat.size <= (kind === 'epub' ? MAX_BOOK_BYTES : MAX_INDEX_BYTES)) {
      const buffer = await fs.readFile(abs)
      hash = createHash('sha1').update(buffer).digest('hex')
      // PDFs are found by file name only; their text is not indexed.
      const extracted =
        kind === 'html' ? extractHtml(buffer.toString('utf8'))
        : kind === 'md' ? extractMarkdown(buffer.toString('utf8'))
        : kind === 'epub' ? await extractEpub(buffer).catch(() => ({ title: '', text: '' }))
        : { title: '', text: '' }
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

/**
 * Title and text of an EPUB book: META-INF/container.xml points to the package file (.opf),
 * which has the title and the reading order (spine) of the chapters.
 */
export async function extractEpub(data: Buffer | Uint8Array): Promise<{ title: string; text: string }> {
  const zip = await JSZip.loadAsync(data)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1]
  const opf = opfPath ? await zip.file(opfPath)?.async('string') : undefined
  if (!opfPath || !opf) return { title: '', text: '' }

  const attr = (tag: string, name: string): string | undefined => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
  const title = collapse(stripTags(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? ''))
  const base = path.posix.dirname(opfPath)
  const hrefs = new Map<string, string>()
  for (const [tag] of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(tag, 'id')
    const href = attr(tag, 'href')
    if (id && href) hrefs.set(id, href)
  }

  let text = ''
  for (const [tag] of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const href = hrefs.get(attr(tag, 'idref') ?? '')
    if (!href) continue
    const file = zip.file(path.posix.normalize(path.posix.join(base, decodeURIComponent(href))))
    if (!file) continue
    text += ' ' + extractHtml(await file.async('string')).text
    if (text.length > MAX_BOOK_TEXT) break
  }
  return { title, text: collapse(text).slice(0, MAX_BOOK_TEXT) }
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
