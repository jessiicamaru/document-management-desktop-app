// @vitest-environment happy-dom
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mammoth from 'mammoth'
import { docxText, docxTitle, extractText, kindOf, scanLibrary } from '../src/main/library'
import { decodeText } from '../src/shared/text'
// @ts-expect-error plain JS helper script
import { buildSampleDocx } from '../scripts/make-sample-docx.mjs'

let dir: string
let docx: string
let bytes: Buffer
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-docx-'))
  docx = path.join(dir, 'flex.docx')
  bytes = await buildSampleDocx()
  await writeFile(docx, bytes)
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('Word documents', () => {
  it('title comes from the document properties', async () => {
    expect(await docxTitle(docx)).toBe('CSS Flexbox — ghi chú')
  })
  it('text is read for search, paragraph by paragraph', async () => {
    const text = await docxText(docx)
    expect(text).toContain('Flexbox xếp các phần tử con theo một trục')
    expect(text.split('\n').length).toBeGreaterThan(4)
    expect(text).not.toContain('<')
  })
  it('turns into HTML with headings for the outline (what the viewer shows)', async () => {
    // In Node mammoth takes a Buffer; the app (browser build) passes an ArrayBuffer.
    const { value } = await mammoth.convertToHtml({ buffer: bytes })
    expect(value).toContain('<h1>CSS Flexbox</h1>')
    expect(value).toContain('<h2>Trục chính và trục phụ</h2>')
    expect(value).toContain('<strong>một trục</strong>')
  })
})

describe('Text files and pictures', () => {
  it('are recognised by extension', () => {
    expect(['a.txt', 'b.docx', 'c.PNG', 'd.jpeg', 'e.svg', 'f.webp'].map(kindOf)).toEqual(['txt', 'docx', 'image', 'image', 'image', 'image'])
  })
  it('text in any common encoding is read correctly', () => {
    const s = 'Sự kiện đã xảy ra'
    expect(decodeText(new TextEncoder().encode(s))).toBe(s)
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(s)]))).toBe(s)
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')])
    expect(decodeText(utf16)).toBe(s)
    // Old Windows Vietnamese (1258): "Vi" + ê (0xEA) + "t" is not valid UTF-8.
    expect(decodeText(Uint8Array.from([0x56, 0x69, 0xea, 0x74]))).toBe('Viêt')
  })
  it('a .txt is searchable; a picture is listed but has no text', async () => {
    await writeFile(path.join(dir, 'notes.txt'), 'git add -p chọn từng đoạn')
    await writeFile(path.join(dir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(await extractText(path.join(dir, 'notes.txt'), 'txt')).toBe('git add -p chọn từng đoạn')
    expect(await extractText(path.join(dir, 'pic.svg'), 'image')).toBe('')
    const kinds = (await scanLibrary(dir)).map((d) => `${d.kind}:${d.title}`).sort()
    expect(kinds).toEqual(['docx:CSS Flexbox — ghi chú', 'image:pic', 'txt:notes'])
  })
})
