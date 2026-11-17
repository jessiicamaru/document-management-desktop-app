// A JSON file inside a workspace folder holding one entry per document, keyed by the
// document's path in that folder. Used for tags/status (.docs-meta.json) and for
// highlights/notes (.docs-notes.json).
//
// Safety rules, because these files often live in a synced folder (Git, OneDrive):
//  - Writes go through a queue, one at a time, so two quick clicks never overwrite each other.
//  - The current state is kept in memory; the file is only read on open or when it changes on disk.
//  - A file that cannot be parsed is copied to a backup before anything else is written.
//  - Entries follow a document that is renamed or moved (same content, or same file name).
//
// No Electron imports here, so this file is unit tested directly.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocEntry } from '../shared/types'

/** Every entry remembers the document's content hash and file name, to follow renames. */
export interface DocKeyed {
  hash?: string
  name?: string
}

interface StoreFile<V> {
  version: 1
  docs: Record<string, V>
}

type ReadResult<V> = { kind: 'missing' } | { kind: 'ok'; docs: Record<string, V>; raw: string } | { kind: 'corrupt'; raw: string }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export abstract class DocStore<V extends DocKeyed> {
  readonly file: string
  protected docs: Record<string, V> = {}
  private lastWritten = ''
  private queue: Promise<unknown> = Promise.resolve()
  /** Human-readable problem to show in the UI, if any. */
  warning: string | null = null

  /**
   * @param fileName e.g. ".docs-meta.json"
   * @param contents what the file holds, for messages, e.g. "tag và trạng thái"
   */
  protected constructor(
    readonly root: string,
    private readonly fileName: string,
    private readonly contents: string
  ) {
    this.file = path.join(root, fileName)
  }

  /** Reads the file; subclasses call this from their static open(). */
  protected async load(): Promise<void> {
    const result = await this.read()
    if (result.kind === 'ok') {
      this.docs = result.docs
      this.lastWritten = result.raw
    } else if (result.kind === 'corrupt') {
      await this.backupCorrupt(result.raw)
    }
  }

  all(): Record<string, V> {
    return this.docs
  }

  /**
   * Called after every scan. Moves entries of files that disappeared onto new files
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

      for (const [p, entry] of Object.entries(next)) {
        const d = byPath.get(p)
        if (d && (entry.hash !== d.hash || entry.name !== d.name)) {
          next[p] = { ...entry, hash: d.hash, name: d.name }
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

  // ---------- for subclasses ----------

  /** Runs `job` after every earlier job finished; a failed job does not block the next one. */
  protected enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Writes to a temp file then renames it, retrying briefly if Windows has the file locked. */
  protected async write(docs: Record<string, V>): Promise<void> {
    const json = JSON.stringify({ version: 1, docs } satisfies StoreFile<V>, null, 2)
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

  // ---------- internals ----------

  private async read(): Promise<ReadResult<V>> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      throw err
    }
    try {
      const parsed = JSON.parse(raw) as StoreFile<V>
      const valid = !!parsed && typeof parsed === 'object' && typeof parsed.docs === 'object' && parsed.docs !== null
      return valid ? { kind: 'ok', docs: parsed.docs, raw } : { kind: 'corrupt', raw }
    } catch {
      return { kind: 'corrupt', raw }
    }
  }

  private async backupCorrupt(raw: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(this.root, `${this.fileName.replace(/\.json$/, '')}.corrupt-${stamp}.json`)
    await fs.writeFile(backup, raw, 'utf8')
    this.warning =
      `File ${this.fileName} bị hỏng (có thể do xung đột khi đồng bộ). ` +
      `Bản cũ đã được sao lưu thành ${path.basename(backup)}; ${this.contents} mới sẽ được ghi vào file mới.`
  }
}
