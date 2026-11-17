// Main-process side of the search worker (see search-worker.ts).
// If the worker crashes it is started again with the last document list (issue #6).

import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { SearchResult, SearchStatus } from '../shared/types'
import type { FromWorker, ToWorker, WorkerDoc } from './search-worker'

export interface SearchServiceOptions {
  /** Worker script; defaults to the built search-worker.js next to this file. */
  workerFile?: string
  /** Don't restart more often than this: a worker that dies again right away is broken. */
  minRestartMs?: number
}

export class SearchService {
  private worker!: Worker
  private readonly pending = new Map<number, (results: SearchResult[]) => void>()
  private nextId = 1
  private lastDocs: { docs: WorkerDoc[]; complete: boolean } | null = null
  private lastStart = 0
  private disposed = false
  private readonly workerFile: string
  private readonly minRestartMs: number

  constructor(
    private readonly textCacheDir: string,
    private readonly onStatus: (status: SearchStatus) => void,
    options: SearchServiceOptions = {}
  ) {
    // In the installed app the worker file is unpacked next to app.asar (see package.json > build.asarUnpack).
    this.workerFile =
      options.workerFile ?? path.join(__dirname, 'search-worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    this.minRestartMs = options.minRestartMs ?? 5000
    this.start()
  }

  private start(): void {
    this.lastStart = Date.now()
    const worker = new Worker(this.workerFile, { workerData: { textCacheDir: this.textCacheDir } })
    this.worker = worker
    worker.on('message', (msg: FromWorker) => {
      if (msg.type === 'status') this.onStatus({ done: msg.done, total: msg.total })
      if (msg.type === 'result') {
        this.pending.get(msg.reqId)?.(msg.results)
        this.pending.delete(msg.reqId)
      }
    })
    worker.on('error', (err) => console.error('search worker failed', err))
    worker.on('exit', (code) => {
      if (this.disposed || this.worker !== worker) return
      console.error(`search worker stopped (code ${code}), restarting`)
      // Searches waiting for the dead worker get an empty answer now, not after a timeout.
      for (const resolve of this.pending.values()) resolve([])
      this.pending.clear()
      const wait = Math.max(0, this.minRestartMs - (Date.now() - this.lastStart))
      setTimeout(() => {
        this.start()
        if (this.lastDocs) this.post({ type: 'docs', ...this.lastDocs })
      }, wait)
    })
  }

  private post(msg: ToWorker): void {
    this.worker.postMessage(msg)
  }

  /** The documents changed: the worker indexes what's new in the background. */
  update(docs: WorkerDoc[], complete: boolean): void {
    this.lastDocs = { docs, complete }
    this.post({ type: 'docs', docs, complete })
  }

  search(query: string): Promise<SearchResult[]> {
    const reqId = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve)
      this.post({ type: 'search', reqId, query })
      setTimeout(() => {
        if (this.pending.delete(reqId)) resolve([])
      }, 15000)
    })
  }

  /** Stops the worker for good (app quitting, tests). */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.worker.terminate()
  }
}
