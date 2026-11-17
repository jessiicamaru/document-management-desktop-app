import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScanCache } from '../src/main/scan-cache'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-cache-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('ScanCache', () => {
  it('saveSync writes everything before returning (used when the app quits, issue #7)', async () => {
    const file = path.join(dir, 'scan-cache.json')
    const cache = new ScanCache(file)
    cache.set(path.join(dir, 'a.epub'), 100, 5, { title: 'Sách A', hash: 'h' })
    cache.saveSync()
    const reopened = new ScanCache(file)
    await reopened.load()
    expect(reopened.get(path.join(dir, 'a.epub'), 100, 5)).toEqual({ title: 'Sách A', hash: 'h' })
    expect(reopened.get(path.join(dir, 'a.epub'), 101, 5)).toBeUndefined() // file changed
  })
})
