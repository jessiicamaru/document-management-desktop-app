// Search, in a background thread (worker_threads), so a big library never freezes the app.
//
// The main process sends the list of documents whenever it changes. This worker then reads
// each document's text in the background (books included, without their images) and keeps:
//  - a small MiniSearch index of titles / file names / paths  -> instant title matches
//  - each document's text with accents removed (same length as the original), in memory
//    -> accent-insensitive full-text search by plain substring matching
// The original text is cached on disk (UTF-8 with checkpoints, see text-cache.ts), so a
// snippet around a match is read from the right place instead of keeping every book twice
// in memory. Folded texts are mostly 1 byte per character in memory (see PUNCT in text.ts).

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import MiniSearch from 'minisearch'
import type { DocKind, SearchResult } from '../shared/types'
import { findInText, foldAccents, normalize } from '../shared/text'
import { extractText } from './library'
import { decodeTextCache, encodeTextCache, readTextCacheSlice } from './text-cache'

/** What the main process tells us about each document. */
export interface WorkerDoc {
  id: string
  abs: string
  kind: DocKind
  title: string
  name: string
  rel: string
  size: number
  mtime: number
}

/** complete: false while folders are still being scanned (the list may grow). */
export type ToWorker = { type: 'docs'; docs: WorkerDoc[]; complete: boolean } | { type: 'search'; reqId: number; query: string }
export type FromWorker = { type: 'result'; reqId: number; results: SearchResult[] } | { type: 'status'; done: number; total: number }

const textCacheDir: string = workerData.textCacheDir
const RADIUS = 60
const MAX_RESULTS = 150

const docs = new Map<string, WorkerDoc>()
/** id -> folded (accent-free, lowercase) text; same length as the original text. */
const folded = new Map<string, string>()
const titles = new MiniSearch<{ id: string; title: string; name: string; rel: string }>({
  fields: ['title', 'name', 'rel'],
  processTerm: (t) => normalize(t),
  searchOptions: { prefix: true, fuzzy: 0.2, combineWith: 'AND', boost: { title: 3, name: 2 } }
})

const send = (msg: FromWorker): void => parentPort!.postMessage(msg)
const hasText = (d: WorkerDoc): boolean => d.kind !== 'pdf'
const cacheFile = (d: WorkerDoc): string =>
  path.join(textCacheDir, createHash('sha1').update(`${d.abs.toLowerCase()}|${d.size}|${d.mtime}`).digest('hex') + '.u8')

// ---------- keeping up with the document list ----------

let queue: string[] = []
let working = false
/** Whether the last list we got was the whole workspace (only then old cache files are deleted). */
let complete = false

function updateDocs(list: WorkerDoc[]): void {
  const next = new Map(list.map((d) => [d.id, d]))
  for (const [id, old] of docs) {
    const now = next.get(id)
    if (now && now.mtime === old.mtime && now.size === old.size && now.title === old.title) continue
    docs.delete(id)
    folded.delete(id)
    titles.discard(id)
  }
  for (const d of list) {
    if (docs.has(d.id)) continue
    docs.set(d.id, d)
    titles.add({ id: d.id, title: d.title, name: d.name, rel: d.rel })
  }
  // Notes and web pages first (small, quick), books after. The queue holds ids: the list may
  // be sent again while we work, and each id is looked up again when its turn comes.
  queue = [...docs.values()]
    .filter((d) => hasText(d) && !folded.has(d.id))
    .sort((a, b) => Number(a.kind === 'epub') - Number(b.kind === 'epub'))
    .map((d) => d.id)
  void work()
}

async function work(): Promise<void> {
  if (working) return
  working = true
  await fs.mkdir(textCacheDir, { recursive: true })
  const total = (): number => [...docs.values()].filter(hasText).length
  while (queue.length) {
    const id = queue.shift()!
    const d = docs.get(id)
    if (!d || folded.has(id)) continue
    let text = ''
    try {
      text = foldAccents(await textOf(d))
    } catch {
      // unreadable: searchable by title only
    }
    // The file may have changed while we were reading it; then it is queued again.
    if (docs.get(id) === d) folded.set(id, text)
    if (folded.size % 5 === 0 || !queue.length) send({ type: 'status', done: folded.size, total: total() })
  }
  working = false
  if (complete) await pruneCache()
}

/** Deletes cached texts of files that are no longer in the workspace (or changed since). */
async function pruneCache(): Promise<void> {
  const keep = new Set([...docs.values()].filter(hasText).map((d) => path.basename(cacheFile(d))))
  for (const name of await fs.readdir(textCacheDir).catch(() => [] as string[])) {
    // .txt: the old UTF-16 format, replaced by .u8 (issue #12).
    if ((name.endsWith('.u8') || name.endsWith('.txt')) && !keep.has(name)) await fs.rm(path.join(textCacheDir, name), { force: true })
  }
}

/** Text of a document, from the disk cache if it was extracted before. */
async function textOf(d: WorkerDoc): Promise<string> {
  const file = cacheFile(d)
  const cached = await fs.readFile(file).then(decodeTextCache, () => null)
  if (cached !== null) return cached
  const text = await extractText(d.abs, d.kind)
  await fs.writeFile(file, encodeTextCache(text)).catch(() => {})
  return text
}

/** Original text around [start, end), read from the cache file. */
async function snippetFromCache(d: WorkerDoc, start: number, end: number): Promise<SearchResult['snippet']> {
  try {
    const from = Math.max(0, start - RADIUS)
    const piece = await readTextCacheSlice(cacheFile(d), from, end + RADIUS - from)
    if (piece === null) return null
    return {
      before: (from > 0 ? '…' : '') + piece.slice(0, start - from),
      match: piece.slice(start - from, end - from),
      after: piece.slice(end - from) + (from + piece.length < (folded.get(d.id)?.length ?? 0) ? '…' : '')
    }
  } catch {
    return null
  }
}

// ---------- searching ----------

async function search(query: string): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []
  const terms = normalize(q).split(/\s+/).filter(Boolean)
  const scores = new Map<string, number>()

  // 1. Titles, file names and folders.
  for (const hit of titles.search(q)) scores.set(hit.id as string, 1000 + hit.score)

  // 2. Text: every word must appear somewhere in the document.
  const textHits = new Map<string, { start: number; end: number }>()
  for (const [id, text] of folded) {
    if (!text || !terms.every((t) => text.includes(t))) continue
    const at = findInText(text, q, terms, text)
    if (!at) continue
    textHits.set(id, at)
    // Notes/pages a bit above books; more occurrences rank higher.
    const d = docs.get(id)!
    let count = 0
    for (let i = text.indexOf(terms[0]); i >= 0 && count < 50; i = text.indexOf(terms[0], i + 1)) count++
    scores.set(id, (scores.get(id) ?? 0) + (d.kind === 'epub' ? 10 : 20) + count)
  }

  const ranked = [...scores].sort((a, b) => b[1] - a[1]).slice(0, MAX_RESULTS)
  return Promise.all(
    ranked.map(async ([id]) => {
      const at = textHits.get(id)
      const d = docs.get(id)!
      return { path: id, snippet: at ? await snippetFromCache(d, at.start, at.end) : null }
    })
  )
}

parentPort!.on('message', (msg: ToWorker) => {
  if (msg.type === 'docs') {
    complete = msg.complete
    updateDocs(msg.docs)
  }
  if (msg.type === 'search') {
    search(msg.query)
      .then((results) => send({ type: 'result', reqId: msg.reqId, results }))
      .catch(() => send({ type: 'result', reqId: msg.reqId, results: [] }))
  }
})
