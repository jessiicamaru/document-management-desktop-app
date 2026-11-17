import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractText, kindOf, mobiTitle, scanLibrary } from '../src/main/library'
// @ts-expect-error plain JS helper script
import { buildSampleMobi } from '../scripts/make-sample-mobi.mjs'

let dir: string
let book: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-mobi-'))
  book = path.join(dir, 'docker.azw3')
  await writeFile(book, buildSampleMobi())
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('Kindle books (issue #20)', () => {
  it('are recognised by extension', () => {
    expect(['a.mobi', 'b.azw3', 'c.AZW'].map(kindOf)).toEqual(['mobi', 'mobi', 'mobi'])
  })
  it('title comes from the book headers', async () => {
    expect(await mobiTitle(book)).toBe('Docker nhanh')
    const [entry] = await scanLibrary(dir)
    expect(entry).toMatchObject({ kind: 'mobi', title: 'Docker nhanh' })
  })
  it('text is read for search, without tags', async () => {
    const text = await extractText(book, 'mobi')
    expect(text).toContain('Container đóng gói ứng dụng cùng mọi thứ nó cần')
    expect(text).toContain('Dùng volume để giữ dữ liệu lâu dài')
    expect(text).not.toContain('<')
  })
  it('not a Kindle book: no title, no crash', async () => {
    const other = path.join(dir, 'x.mobi')
    await writeFile(other, 'hello')
    expect(await mobiTitle(other)).toBe('')
    expect(await extractText(other, 'mobi')).toBe('')
  })
})
