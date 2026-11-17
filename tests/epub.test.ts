import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { epubText, epubTitle, scanLibrary } from '../src/main/library'
import { openZip } from '../src/main/zip'
// @ts-expect-error plain JS helper script
import { buildSampleEpub } from '../scripts/make-sample-epub.mjs'

let dir: string
let book: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-epub-'))
  book = path.join(dir, 'git.epub')
  await writeFile(book, await buildSampleEpub())
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('openZip', () => {
  it('reads stored and deflated files without loading the whole archive', async () => {
    const zip = new JSZip()
    zip.file('a.txt', 'stored text', { compression: 'STORE' })
    zip.file('b/c.txt', 'nén '.repeat(1000), { compression: 'DEFLATE' })
    const file = path.join(dir, 't.zip')
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const r = await openZip(file)
    try {
      expect(r.names()).toEqual(expect.arrayContaining(['a.txt', 'b/c.txt'])) // plus folder entries like "b/"
      expect((await r.read('a.txt'))!.toString()).toBe('stored text')
      expect((await r.read('b/c.txt'))!.toString()).toBe('nén '.repeat(1000))
      expect(await r.read('missing')).toBeNull()
    } finally {
      await r.close()
    }
  })
  it('refuses files that are not zips', async () => {
    const file = path.join(dir, 'x.zip')
    await writeFile(file, 'not a zip')
    await expect(openZip(file)).rejects.toThrow()
  })
})

describe('EPUB', () => {
  it('reads the title from the package file', async () => {
    expect(await epubTitle(book)).toBe('Git cơ bản')
  })
  it('reads the chapter text in reading order', async () => {
    const text = await epubText(book)
    expect(text.indexOf('Chương 1')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Chương 1')).toBeLessThan(text.indexOf('Chương 2'))
    expect(text).toContain('pull trước khi push')
  })
  it('scanning lists the book with its title (and no text: search reads it later)', async () => {
    const [doc] = await scanLibrary(dir)
    expect(doc).toMatchObject({ path: 'git.epub', kind: 'epub', title: 'Git cơ bản' })
    expect(doc).not.toHaveProperty('text')
  })
})
