import { describe, expect, it } from 'vitest'
import type { DocEntry } from '../src/shared/types'
import { buildTree, docUrl, errorMessage, makeSnippet, normalize, parseDocUrl } from '../src/renderer/src/lib/docs'

const doc = (path: string, title = path): DocEntry => ({
  root: 'r1',
  rel: path,
  path,
  name: path.split('/').pop()!,
  kind: path.endsWith('.md') ? 'md' : 'html',
  title,
  size: 0,
  mtime: 0
})

describe('normalize', () => {
  it('drops Vietnamese accents and lowercases', () => {
    expect(normalize('Sự Kiện')).toBe('su kien')
    expect(normalize('Đường đi')).toBe('duong di')
  })
})

describe('makeSnippet', () => {
  const text = 'Kiến trúc dữ liệu. Thay vì lưu state, ta lưu chuỗi sự kiện đã xảy ra.'

  it('prefers the whole query as a phrase', () => {
    const s = makeSnippet(text, 'su kien', ['su', 'kien'])
    expect(s.match).toBe('sự kiện')
  })

  it('falls back to the first matched single term', () => {
    const s = makeSnippet(text, 'kien', ['kien'])
    expect(s.match).toBe('Kiến')
    expect(s.before).toBe('')
  })

  it('returns the start of the text when nothing matches', () => {
    const s = makeSnippet(text, 'zzz', ['zzz'], 5)
    expect(s.match).toBe('')
    expect(s.before).toBe(text.slice(0, 10))
  })
})

describe('buildTree', () => {
  it('groups documents into sorted folders', () => {
    const tree = buildTree([doc('b/z.md', 'Z'), doc('a.md', 'A'), doc('b/c/y.html', 'Y'), doc('b/x.md', 'X')])
    expect(tree.docs.map((d) => d.path)).toEqual(['a.md'])
    expect(tree.folders.map((f) => f.path)).toEqual(['b'])
    const b = tree.folders[0]
    expect(b.docs.map((d) => d.title)).toEqual(['X', 'Z'])
    expect(b.folders[0].path).toBe('b/c')
  })
})

describe('docUrl / parseDocUrl', () => {
  it('round-trips paths with spaces and Vietnamese characters', () => {
    const p = 'học/Event Sourcing.html'
    expect(parseDocUrl(docUrl(p))).toEqual({ path: p, hash: '' })
  })

  it('keeps the #hash', () => {
    expect(parseDocUrl('doc://library/a/b.md#phan-2')).toEqual({ path: 'a/b.md', hash: 'phan-2' })
  })

  it('returns null for malformed or non-library URLs', () => {
    expect(parseDocUrl('doc://library/100%.html')).toBeNull()
    expect(parseDocUrl('https://example.com/a.html')).toBeNull()
  })
})

describe('errorMessage', () => {
  it('strips the Electron IPC prefix', () => {
    const err = new Error("Error invoking remote method 'meta:update': Error: Không lưu được")
    expect(errorMessage(err)).toBe('Không lưu được')
  })
})
