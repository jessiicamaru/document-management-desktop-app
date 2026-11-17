import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractHtml, extractMarkdown, resolveInLibrary, scanLibrary } from '../src/main/library'

describe('extractHtml', () => {
  it('reads <title>, drops head/style/script, decodes entities', () => {
    const html = `<html><head><title>Bài &amp; học</title><style>.x{color:red}</style></head>
      <body><h1>Heading</h1><script>alert(1)</script><p>CQRS &lt;3 ES&#33;</p></body></html>`
    const { title, text } = extractHtml(html)
    expect(title).toBe('Bài & học')
    expect(text).toBe('Heading CQRS <3 ES!')
  })

  it('falls back to the first <h1>', () => {
    expect(extractHtml('<h1>Only <b>heading</b></h1>').title).toBe('Only heading')
  })
})

describe('extractMarkdown', () => {
  it('uses front matter title and strips markdown syntax', () => {
    const md = '---\ntitle: "Tiêu đề"\n---\n# Khác\nXem [link](a.md) và ![ảnh](x.png)'
    const { title, text } = extractMarkdown(md)
    expect(title).toBe('Tiêu đề')
    expect(text).toBe('Khác Xem link và ảnh')
  })

  it('falls back to the first # heading', () => {
    expect(extractMarkdown('intro\n# Heading one\n').title).toBe('Heading one')
  })
})

describe('resolveInLibrary', () => {
  const root = path.resolve('/lib')
  it('allows paths inside the library', () => {
    expect(resolveInLibrary(root, 'a/b.md')).toBe(path.join(root, 'a', 'b.md'))
  })
  it('refuses paths that escape the library', () => {
    expect(resolveInLibrary(root, '../secret.txt')).toBeNull()
    expect(resolveInLibrary(root, 'a/../../secret.txt')).toBeNull()
    expect(resolveInLibrary(root, '')).toBeNull()
  })
})

describe('scanLibrary', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'studydocs-scan-'))
    await mkdir(path.join(dir, 'sub'))
    await mkdir(path.join(dir, '.hidden'))
    await mkdir(path.join(dir, 'node_modules'))
    await writeFile(path.join(dir, 'a.md'), '# A')
    await writeFile(path.join(dir, 'sub', 'b.html'), '<title>B</title>')
    await writeFile(path.join(dir, 'sub', 'notes.txt'), 'ignored')
    await writeFile(path.join(dir, '.hidden', 'c.md'), '# hidden')
    await writeFile(path.join(dir, 'node_modules', 'd.md'), '# dep')
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('finds md/html files, skipping hidden folders and node_modules', async () => {
    const docs = await scanLibrary(dir)
    expect(docs.map((d) => [d.path, d.title, d.kind])).toEqual([
      ['a.md', 'A', 'md'],
      ['sub/b.html', 'B', 'html']
    ])
    expect(docs[0].hash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('reuses unchanged entries from the cache', async () => {
    const first = await scanLibrary(dir)
    const second = await scanLibrary(dir, first)
    expect(second[0]).toBe(first[0]) // same object: not read again
  })
})
