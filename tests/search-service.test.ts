import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SearchService } from '../src/main/search'

// A stand-in worker: crashes on its first search (in the first run only), answers afterwards
// with how many documents it was told about.
const FAKE_WORKER = `
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const marker = require('node:path').join(workerData.textCacheDir, 'crashed-once')
let docs = []
parentPort.on('message', (msg) => {
  if (msg.type === 'docs') docs = msg.docs
  if (msg.type === 'search') {
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker, '')
      process.exit(1)
    }
    parentPort.postMessage({ type: 'result', reqId: msg.reqId, results: [{ path: 'docs:' + docs.length, snippet: null }] })
  }
})
`

let dir: string
let workerFile: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-search-'))
  workerFile = path.join(dir, 'fake-worker.cjs')
  await writeFile(workerFile, FAKE_WORKER)
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('SearchService (issue #6)', () => {
  it('answers right away when the worker dies, then restarts it with the last document list', async () => {
    const service = new SearchService(dir, () => {}, { workerFile, minRestartMs: 50 })
    const doc = { id: 'k/a.md', abs: 'a.md', kind: 'md' as const, title: 'a', name: 'a.md', rel: 'a.md', size: 1, mtime: 1 }
    service.update([doc, { ...doc, id: 'k/b.md' }], true)

    const started = Date.now()
    expect(await service.search('x')).toEqual([]) // the worker crashed on this one
    expect(Date.now() - started).toBeLessThan(5000) // not the 15 s timeout

    await new Promise((r) => setTimeout(r, 300)) // restarted
    expect(await service.search('x')).toEqual([{ path: 'docs:2', snippet: null }])
    await service.dispose()
  })
})
