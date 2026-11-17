// Tags and study status for one library, stored in <library>/.docs-meta.json.
//
// Safety rules, because this file often lives in a synced folder (Git, OneDrive):
//  - Writes go through a queue, one at a time, so two quick clicks never overwrite each other.
//  - The current state is kept in memory; the file is only read on open or when it changes on disk.
//  - A file that cannot be parsed is copied to a backup before anything else is written.
//
// This module does not import Electron, so it can be unit tested with plain Node.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_META, type DocEntry, type DocMeta } from '../shared/types'

export const META_FILE = '.docs-meta.json'

interface MetaFile {
  version: 1
  docs: Record<string, DocMeta>
}

type ReadResult = { kind: 'missing' } | { kind: 'ok'; docs: Record<string, DocMeta>; raw: string } | { kind: 'corrupt'; raw: string }

function isMetaFile(value: unknown): value is MetaFile {
  return !!value && typeof value === 'object' && typeof (value as MetaFile).docs === 'object' && (value as MetaFile).docs !== null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class MetaStore {
  readonly file: string
  private docs: Record<string, DocMeta> = {}
  private lastWritten = ''
  private queue: Promise<unknown> = Promise.resolve()
  /** Human-readable problem to show in the UI, if any. */
  warning: string | null = null

  private constructor(readonly root: string) {
    this.file = path.join(root, META_FILE)
  }

  static async open(root: string): Promise<MetaStore> {
    const store = new MetaStore(root)
    const result = await store.read()
    if (result.kind === 'ok') {
      store.docs = result.docs
      store.lastWritten = result.raw
    } else if (result.kind === 'corrupt') {
      await store.backupCorrupt(result.raw)
    }
    return store
  }

  all(): Record<string, DocMeta> {
    return this.docs
  }

  /** Changes tags/status of one document. Resolves with the full metadata after it is saved. */
  update(docPath: string, patch: Partial<DocMeta>, doc?: Pick<DocEntry, 'hash' | 'name'>): Promise<Record<string, DocMeta>> {
    return this.enqueue(async () => {
      const merged: DocMeta = { ...DEFAULT_META, ...this.docs[docPath], ...patch }
      merged.tags = [...new Set(merged.tags.map((t) => t.trim()).filter(Boolean))]
      if (doc?.hash) merged.hash = doc.hash
      if (doc?.name) merged.name = doc.name
      await this.write({ ...this.docs, [docPath]: merged })
      return this.docs
    })
  }

  /**
   * Called after every scan. Moves metadata of files that disappeared onto new files
   * that are clearly the same document (same content hash, or same file name), and
   * remembers hash/name for entries that don't have them yet.
   */
  reconcile(docs: Pick<DocEntry, 'path' | 'hash' | 'name'>[]): Promise<boolean> {
    return this.enqueue(async () => {
      const next = { ...this.docs }
      const byPath = new Map(docs.map((d) => [d.path, d]))
      let changed = false

      const orphans = Object.keys(next).filter((p) => !byPath.has(p))
      const newcomers = docs.filter((d) => !next[d.path])
      for (const orphanPath of orphans) {
        const orphan = next[orphanPath]
        const byHash = orphan.hash ? newcomers.filter((d) => d.hash === orphan.hash) : []
        const byName = orphan.name ? newcomers.filter((d) => d.name === orphan.name) : []
        // Only move when there is exactly one obvious candidate.
        const target = byHash.length === 1 ? byHash[0] : byHash.length === 0 && byName.length === 1 ? byName[0] : null
        if (!target) continue
        next[target.path] = { ...orphan, hash: target.hash, name: target.name }
        delete next[orphanPath]
        newcomers.splice(newcomers.indexOf(target), 1)
        changed = true
      }

      for (const [p, m] of Object.entries(next)) {
        const d = byPath.get(p)
        if (d && (m.hash !== d.hash || m.name !== d.name)) {
          next[p] = { ...m, hash: d.hash, name: d.name }
          changed = true
        }
      }

      if (changed) await this.write(next)
      return changed
    })
  }

  /** The file changed on disk (e.g. synced from another PC). Returns true if the in-memory state changed. */
  reloadFromDisk(): Promise<boolean> {
    return this.enqueue(async () => {
      const result = await this.read()
      if (result.kind === 'missing') return false
      if (result.kind === 'corrupt') {
        await this.backupCorrupt(result.raw)
        return false
      }
      if (result.raw === this.lastWritten) return false
      this.docs = result.docs
      this.lastWritten = result.raw
      return true
    })
  }

  // ---------- internals ----------

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job)
    this.queue = run.catch(() => undefined) // a failed job must not block the next one
    return run
  }

  private async read(): Promise<ReadResult> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      throw err
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return isMetaFile(parsed) ? { kind: 'ok', docs: parsed.docs, raw } : { kind: 'corrupt', raw }
    } catch {
      return { kind: 'corrupt', raw }
    }
  }

  private async backupCorrupt(raw: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(this.root, `.docs-meta.corrupt-${stamp}.json`)
    await fs.writeFile(backup, raw, 'utf8')
    this.warning =
      `File ${META_FILE} bị hỏng (có thể do xung đột khi đồng bộ). ` +
      `Bản cũ đã được sao lưu thành ${path.basename(backup)}; tag và trạng thái mới sẽ được ghi vào file mới.`
  }

  /** Writes to a temp file then renames it, retrying briefly if Windows has the file locked. */
  private async write(docs: Record<string, DocMeta>): Promise<void> {
    const json = JSON.stringify({ version: 1, docs } satisfies MetaFile, null, 2)
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, json, 'utf8')
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, this.file)
        break
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
          await fs.rm(tmp, { force: true })
          throw err
        }
        await sleep(50 * (attempt + 1))
      }
    }
    this.docs = docs
    this.lastWritten = json
  }
}
