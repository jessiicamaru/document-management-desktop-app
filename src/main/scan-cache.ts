// Remembers title + hash of every scanned file between app runs (%APPDATA%\Study Docs\scan-cache.json),
// so reopening a big library only needs a quick look at file sizes and dates.
// An entry is used only while the file's size and modified time are unchanged.

import { promises as fs, renameSync, writeFileSync } from 'node:fs'
import type { CachedInfo, InfoCache } from './library'
import { pathKey } from './workspace'

interface Entry extends CachedInfo {
  size: number
  mtime: number
}

export class ScanCache implements InfoCache {
  private entries: Record<string, Entry> = {}
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      this.entries = JSON.parse(await fs.readFile(this.file, 'utf8')).entries ?? {}
    } catch {
      this.entries = {} // missing or damaged: it's only a cache
    }
  }

  get(abs: string, size: number, mtime: number): CachedInfo | undefined {
    const e = this.entries[pathKey(abs)]
    return e && e.size === size && e.mtime === mtime ? { title: e.title, hash: e.hash } : undefined
  }

  set(abs: string, size: number, mtime: number, info: CachedInfo): void {
    this.entries[pathKey(abs)] = { size, mtime, ...info }
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), 2000) // many files change at once while scanning
  }

  /**
   * Same as save(), but finishes before returning. Used while the app is quitting, when an
   * asynchronous write might never complete (issue #7). Skipped if nothing changed.
   */
  saveSync(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, entries: this.entries }), 'utf8')
      renameSync(`${this.file}.tmp`, this.file)
    } catch (err) {
      console.error('Could not save scan cache', err)
    }
  }

  async save(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    const tmp = `${this.file}.tmp`
    try {
      await fs.writeFile(tmp, JSON.stringify({ version: 1, entries: this.entries }), 'utf8')
      await fs.rename(tmp, this.file)
    } catch (err) {
      console.error('Could not save scan cache', err)
    }
  }
}
