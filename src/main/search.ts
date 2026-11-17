// Main-process side of the search worker (see search-worker.ts).

import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { SearchResult, SearchStatus } from '../shared/types'
import type { FromWorker, ToWorker, WorkerDoc } from './search-worker'

export class SearchService {
  private readonly worker: Worker
  private readonly pending = new Map<number, (results: SearchResult[]) => void>()
  private nextId = 1

  constructor(textCacheDir: string, onStatus: (status: SearchStatus) => void) {
    // In the installed app the worker file is unpacked next to app.asar (see package.json > build.asarUnpack).
    const file = path.join(__dirname, 'search-worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    this.worker = new Worker(file, { workerData: { textCacheDir } })
    this.worker.on('message', (msg: FromWorker) => {
      if (msg.type === 'status') onStatus({ done: msg.done, total: msg.total })
      if (msg.type === 'result') {
        this.pending.get(msg.reqId)?.(msg.results)
        this.pending.delete(msg.reqId)
      }
    })
    this.worker.on('error', (err) => console.error('search worker failed', err))
  }

  private post(msg: ToWorker): void {
    this.worker.postMessage(msg)
  }

  /** The documents changed: the worker indexes what's new in the background. */
  update(docs: WorkerDoc[], complete: boolean): void {
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
}
