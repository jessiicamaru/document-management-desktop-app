// A JSON file holding one entry per document of one workspace folder, keyed by the
// document's path in that folder. Used for tags/status (meta.json) and for highlights/notes
// (notes.json). The files live in the app's own data folder, one sub-folder per workspace
// folder: %APPDATA%\Study Docs\data\<folder key>\ (see dataDirOf in index.ts). Documents'
// folders are never written to.
//
// Safety rules:
//  - Writes go through a queue, one at a time, so two quick clicks never overwrite each other.
//  - The current state is kept in memory; the file is only read on open.
//  - A file that cannot be parsed is copied to a backup before anything else is written.
//  - Entries follow a document that is renamed or moved (same content, or same file name).
//
// No Electron imports here, so this file is unit tested directly.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocEntry } from '../shared/types'
import { t } from '../shared/i18n'

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
   * @param fileName e.g. "meta.json"
   * @param contents what the file holds, for messages, e.g. "tag và trạng thái"
   */
  protected constructor(
    readonly dir: string,
    private readonly fileName: string,
    private readonly contents: string
  ) {
    this.file = path.join(dir, fileName)
  }

  /** Reads the file; subclasses call this from their static open(). */
  protected async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const result = await this.read()
    if (result.kind === 'ok') {
      this.docs = result.docs
      this.lastWritten = result.raw
    } else if (result.kind === 'corrupt') {
      await this.handleCorrupt(result.raw)
    }
  }

  /** Combines two versions of one document's entry (from a Git conflict or a backup). */
  protected abstract mergeEntry(a: V, b: V): V

  /** Merges `extra` into `base`, entry by entry. */
  private mergeDocs(base: Record<string, V>, extra: Record<string, V>): Record<string, V> {
    const out = { ...base }
    for (const [p, entry] of Object.entries(extra)) out[p] = out[p] ? this.mergeEntry(out[p], entry) : entry
    return out
  }

  /**
   * Tries to get the data out of a file that isn't valid JSON (issue #25):
   *  - a Git merge conflict (<<<<<<< / ======= / >>>>>>>): both sides are read and merged;
   *  - trailing commas left by hand editing.
   * Returns null when it can't be repaired safely.
   */
  recover(raw: string): Record<string, V> | null {
    const parse = (text: string): Record<string, V> | null => {
      for (const t of [text, text.replace(/,(\s*[}\]])/g, '$1')]) {
        try {
          const parsed = JSON.parse(t) as StoreFile<V>
          if (parsed && typeof parsed === 'object' && parsed.docs && typeof parsed.docs === 'object') return parsed.docs
        } catch {
          // try the next repair
        }
      }
      return null
    }
    if (!/^<{7}( |$)/m.test(raw)) return parse(raw)

    // Rebuild "ours" and "theirs" from the conflict blocks (diff3 base sections are dropped).
    const ours: string[] = []
    const theirs: string[] = []
    let side: 'both' | 'ours' | 'base' | 'theirs' = 'both'
    for (const line of raw.split(/\r?\n/)) {
      if (/^<{7}( |$)/.test(line)) side = 'ours'
      else if (/^\|{7}( |$)/.test(line) && side === 'ours') side = 'base'
      else if (/^={7}$/.test(line) && side !== 'both') side = 'theirs'
      else if (/^>{7}( |$)/.test(line) && side === 'theirs') side = 'both'
      else {
        if (side === 'both' || side === 'ours') ours.push(line)
        if (side === 'both' || side === 'theirs') theirs.push(line)
      }
    }
    if (side !== 'both') return null // unfinished conflict block
    const a = parse(ours.join('\n'))
    const b = parse(theirs.join('\n'))
    return a && b ? this.mergeDocs(a, b) : null
  }

  /** Backup files of this store in the folder (newest first), e.g. ".docs-meta.corrupt-2026-….json". */
  async backups(): Promise<string[]> {
    const prefix = `${this.fileName.replace(/\.json$/, '')}.corrupt-`
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    return names.filter((n) => n.startsWith(prefix) && n.endsWith('.json')).sort().reverse()
  }

  /** Full path of one of this store's backups; throws for anything else (no path tricks). */
  backupPath(name: string): string {
    const prefix = `${this.fileName.replace(/\.json$/, '')}.corrupt-`
    if (typeof name !== 'string' || !name.startsWith(prefix) || !name.endsWith('.json') || /[\\/]/.test(name)) {
      throw new Error(t('Không phải bản sao lưu của app'))
    }
    return path.join(this.dir, name)
  }

  /**
   * Merges a backup into the current data (nothing current is lost). The backup is then
   * renamed to ".merged-…" so it isn't offered again. Returns how many documents it had.
   */
  restoreBackup(name: string): Promise<number> {
    return this.enqueue(async () => {
      const file = this.backupPath(name)
      const docs = this.recover(await fs.readFile(file, 'utf8'))
      if (!docs) throw new Error(t('Không đọc được {0}. Hãy mở file và sửa tay (hoặc bỏ bản này).', { 0: name }))
      await this.write(this.mergeDocs(this.docs, docs))
      await fs.rename(file, file.replace('.corrupt-', '.merged-'))
      this.warning = null
      return Object.keys(docs).length
    })
  }

  /** Merges entries from a backup file made with "Sao lưu dữ liệu". Returns how many documents it had. */
  importDocs(docs: Record<string, V>): Promise<number> {
    return this.enqueue(async () => {
      const n = Object.keys(docs).length
      if (n) await this.write(this.mergeDocs(this.docs, docs))
      return n
    })
  }

  /** Entries of documents that no longer exist. */
  orphans(existing: Iterable<string>): string[] {
    const keep = new Set(existing)
    return Object.keys(this.docs).filter((p) => !keep.has(p))
  }

  /** Removes the entries of documents that no longer exist. Returns how many were removed. */
  pruneOrphans(existing: Iterable<string>): Promise<number> {
    return this.enqueue(async () => {
      const gone = this.orphans(existing)
      if (!gone.length) return 0
      const next = { ...this.docs }
      for (const p of gone) delete next[p]
      await this.write(next)
      return gone.length
    })
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
      if (result.kind === 'corrupt') return this.handleCorrupt(result.raw)
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

  /**
   * The file can't be parsed. It is always copied to a backup first. A Git conflict (or a
   * small slip like a trailing comma) is then repaired and merged automatically; anything
   * else waits for the user in the recovery dialog. Returns true if the data changed.
   */
  private async handleCorrupt(raw: string): Promise<boolean> {
    const backup = await this.backupCorrupt(raw)
    const recovered = this.recover(raw)
    if (!recovered) return false
    // Keep what is in memory too, in case the broken file lost something.
    await this.write(this.mergeDocs(recovered, this.docs))
    await fs.rename(backup, backup.replace('.corrupt-', '.merged-')).catch(() => undefined)
    this.warning = t('File {0} bị xung đột khi đồng bộ; app đã tự gộp hai phiên bản (bản gốc lưu ở {1}).', { 0: this.fileName, 1: path.basename(backup).replace('.corrupt-', '.merged-') })
    return true
  }

  private async backupCorrupt(raw: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(this.dir, `${this.fileName.replace(/\.json$/, '')}.corrupt-${stamp}.json`)
    await fs.writeFile(backup, raw, 'utf8')
    this.warning =
      t('File {0} bị hỏng (có thể do xung đột khi đồng bộ). ', { 0: this.fileName }) +
      t('Bản cũ đã được sao lưu thành {0}; {1} mới sẽ được ghi vào file mới. ', { 0: path.basename(backup), 1: this.contents }) +
      t('Mở "Khôi phục" để gộp lại dữ liệu cũ.')
    return backup
  }
}
