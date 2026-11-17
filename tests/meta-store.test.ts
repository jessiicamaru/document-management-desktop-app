import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { META_FILE, MetaStore } from '../src/main/meta-store'
import type { DocEntry } from '../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-meta-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const readMetaFile = async (): Promise<Record<string, { tags: string[]; status: string }>> =>
  JSON.parse(await readFile(path.join(dir, META_FILE), 'utf8')).docs

const doc = (p: string, hash: string): DocEntry => ({
  root: 'r1',
  rel: p,
  path: p,
  name: p.split('/').pop()!,
  kind: 'md',
  title: p,
  text: '',
  size: 1,
  mtime: 1,
  hash
})

describe('MetaStore', () => {
  it('starts empty when there is no file', async () => {
    const store = await MetaStore.open(dir)
    expect(store.all()).toEqual({})
    expect(store.warning).toBeNull()
  })

  it('keeps both changes when two updates run at the same time', async () => {
    const store = await MetaStore.open(dir)
    await Promise.all([
      store.update('a.md', { status: 'done' }),
      store.update('a.md', { tags: ['x'] }),
      store.update('b.md', { tags: ['y'] })
    ])
    const saved = await readMetaFile()
    expect(saved['a.md']).toMatchObject({ status: 'done', tags: ['x'] })
    expect(saved['b.md']).toMatchObject({ tags: ['y'] })
  })

  it('backs up a corrupt file instead of silently dropping it', async () => {
    const garbage = '{ "version": 1, "docs": { <<<<<<< HEAD'
    await writeFile(path.join(dir, META_FILE), garbage)
    const store = await MetaStore.open(dir)
    expect(store.warning).toMatch(/bị hỏng/)
    const backups = (await readdir(dir)).filter((f) => f.startsWith('.docs-meta.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(await readFile(path.join(dir, backups[0]), 'utf8')).toBe(garbage)
  })

  it('moves tags to a renamed file with the same content', async () => {
    const store = await MetaStore.open(dir)
    await store.update('old.md', { tags: ['keep'] }, { hash: 'h1', name: 'old.md' })
    await store.reconcile([doc('new-name.md', 'h1')])
    expect(store.all()).toEqual({ 'new-name.md': expect.objectContaining({ tags: ['keep'], hash: 'h1' }) })
  })

  it('moves tags to a moved-and-edited file with the same name', async () => {
    const store = await MetaStore.open(dir)
    await store.update('a/notes.md', { status: 'review' }, { hash: 'h1', name: 'notes.md' })
    await store.reconcile([doc('b/notes.md', 'h2')])
    expect(store.all()['b/notes.md']).toMatchObject({ status: 'review' })
  })

  it('does not guess when several files could match', async () => {
    const store = await MetaStore.open(dir)
    await store.update('x/notes.md', { status: 'done' }, { hash: 'h1', name: 'notes.md' })
    await store.reconcile([doc('a/notes.md', 'h2'), doc('b/notes.md', 'h3')])
    expect(Object.keys(store.all())).toEqual(['x/notes.md'])
  })

  it('reloads changes made by another program, but not its own writes', async () => {
    const store = await MetaStore.open(dir)
    await store.update('a.md', { status: 'learning' })
    expect(await store.reloadFromDisk()).toBe(false)

    const external = { version: 1, docs: { 'a.md': { tags: ['from-other-pc'], status: 'done' } } }
    await writeFile(path.join(dir, META_FILE), JSON.stringify(external))
    expect(await store.reloadFromDisk()).toBe(true)
    expect(store.all()['a.md']).toMatchObject({ status: 'done', tags: ['from-other-pc'] })
  })
})
