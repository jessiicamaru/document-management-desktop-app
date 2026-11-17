import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { META_FILE, MetaStore } from '../src/main/meta-store'
import { NOTES_FILE, NotesStore } from '../src/main/notes-store'
import type { Annotation } from '../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-recovery-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const json = (docs: object): string => JSON.stringify({ version: 1, docs }, null, 2)
const ann = (id: string, note: string, updated: number): Annotation => ({
  id,
  note,
  updated,
  created: 1,
  quote: 'q',
  prefix: '',
  suffix: '',
  color: 'yellow'
})

// What Git leaves behind when two PCs changed the same file.
const conflict = `{
  "version": 1,
  "docs": {
<<<<<<< HEAD
    "a.md": { "tags": ["x"], "status": "learning" }
=======
    "a.md": { "tags": ["y"], "status": "done" },
    "b.md": { "tags": ["z"], "status": "new" }
>>>>>>> origin/main
  }
}`

describe('broken data files (issue #25)', () => {
  it('merges both sides of a Git conflict automatically and keeps the original', async () => {
    await writeFile(path.join(dir, META_FILE), conflict)
    const store = await MetaStore.open(dir)
    expect(store.all()['a.md']).toMatchObject({ tags: ['x', 'y'], status: 'done' })
    expect(store.all()['b.md']).toMatchObject({ tags: ['z'] })
    expect(store.warning).toMatch(/tự gộp/)
    const files = await readdir(dir)
    expect(files.some((f) => f.startsWith('meta.merged-'))).toBe(true)
    expect(await store.backups()).toEqual([]) // nothing left to recover by hand
    expect(JSON.parse(await readFile(path.join(dir, META_FILE), 'utf8')).docs['b.md'].tags).toEqual(['z'])
  })

  it('handles diff3-style conflicts and trailing commas', () => {
    const store = Object.create(MetaStore.prototype) as MetaStore
    const diff3 = conflict.replace('=======', '||||||| base\n    "a.md": { "tags": [], "status": "new" }\n=======')
    expect(Object.keys(store.recover(diff3)!)).toEqual(['a.md', 'b.md'])
    expect(store.recover('{"version":1,"docs":{"a.md":{"tags":["t",],"status":"new"},},}')!['a.md'].tags).toEqual(['t'])
    expect(store.recover('{ broken')).toBeNull()
  })

  it('lets you merge a backup back once it has been fixed, without losing new data', async () => {
    await writeFile(path.join(dir, NOTES_FILE), '{ broken')
    const store = await NotesStore.open(dir)
    const [backup] = await store.backups()
    expect(backup).toMatch(/^notes\.corrupt-/)
    await expect(store.restoreBackup(backup)).rejects.toThrow(/sửa tay/)

    await store.save('a.md', ann('new1', 'mới', 5))
    // The user fixes the backup by hand.
    await writeFile(path.join(dir, backup), json({ 'a.md': { items: [ann('old1', 'cũ', 1)] }, 'b.md': { items: [ann('old2', '', 1)] } }))
    expect(await store.restoreBackup(backup)).toBe(2)
    expect(store.byDoc()['a.md'].map((a) => a.id)).toEqual(['new1', 'old1'])
    expect(store.byDoc()['b.md']).toHaveLength(1)
    expect(store.warning).toBeNull()
    expect(await store.backups()).toEqual([])
  })

  it('only touches its own backup files', async () => {
    const store = await MetaStore.open(dir)
    expect(() => store.backupPath('../secret.json')).toThrow()
    expect(() => store.backupPath('notes.corrupt-1.json')).toThrow()
    expect(store.backupPath('meta.corrupt-1.json')).toBe(path.join(dir, 'meta.corrupt-1.json'))
  })
})

describe('workspace-wide tags and clean-up (issue #22)', () => {
  it('renames and deletes a tag on every document', async () => {
    const store = await MetaStore.open(dir)
    await store.update('a.md', { tags: ['js', 'web'] })
    await store.update('b.md', { tags: ['js', 'javascript'] })
    await store.update('c.md', { tags: ['css'] })
    expect(await store.renameTag('js', 'javascript')).toBe(2)
    expect(store.all()['a.md'].tags).toEqual(['javascript', 'web'])
    expect(store.all()['b.md'].tags).toEqual(['javascript']) // merged, not duplicated
    expect(await store.deleteTag('javascript')).toBe(2)
    expect(store.all()['b.md'].tags).toEqual([])
    expect(store.all()['c.md'].tags).toEqual(['css'])
  })

  it('removes entries of files that no longer exist', async () => {
    const store = await MetaStore.open(dir)
    await store.update('a.md', { tags: ['x'] })
    await store.update('gone.md', { tags: ['y'] })
    expect(store.orphans(['a.md'])).toEqual(['gone.md'])
    expect(await store.pruneOrphans(['a.md'])).toBe(1)
    expect(Object.keys(store.all())).toEqual(['a.md'])
  })
})

describe('note about the whole document (issue #21)', () => {
  it('is saved next to the highlights and survives deleting them', async () => {
    const store = await NotesStore.open(dir)
    await store.save('a.md', ann('h1', '', 1))
    await store.setDocNote('a.md', '## Tóm tắt\n- ý chính')
    await store.remove('a.md', 'h1')
    expect(store.docNotes()).toEqual({ 'a.md': '## Tóm tắt\n- ý chính' })
    const reopened = await NotesStore.open(dir)
    expect(reopened.docNotes()['a.md']).toContain('ý chính')
    await reopened.setDocNote('a.md', '  ')
    expect(reopened.all()['a.md']).toBeUndefined() // nothing left for that file
  })
})
