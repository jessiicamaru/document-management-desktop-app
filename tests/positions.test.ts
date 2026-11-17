import { describe, expect, it } from 'vitest'
import { staleKeys } from '../src/renderer/src/lib/positions'

describe('staleKeys (issue #8)', () => {
  const docs = [
    { path: 'aaaa/notes/a.md', mtime: 10 },
    { path: 'aaaa/books/b.epub', mtime: 20 }
  ]
  const roots = [
    { key: 'aaaa', available: true },
    { key: 'usb1', available: false }
  ]
  it('keeps positions of documents that exist, and other app keys', () => {
    expect(staleKeys(['pos:aaaa/notes/a.md', 'epubpos:aaaa/books/b.epub', 'epubloc:aaaa/books/b.epub:20', 'selected:workspace', 'outline-open'], docs, roots)).toEqual([])
  })
  it('drops deleted documents, removed folders and old versions of a book', () => {
    expect(
      staleKeys(['pos:aaaa/notes/gone.md', 'pos:zzzz/x.md', 'epubloc:aaaa/books/b.epub:19', 'epubpos:aaaa/old.epub'], docs, roots)
    ).toEqual(['pos:aaaa/notes/gone.md', 'pos:zzzz/x.md', 'epubloc:aaaa/books/b.epub:19', 'epubpos:aaaa/old.epub'])
  })
  it('keeps everything of a folder that is only temporarily unavailable', () => {
    expect(staleKeys(['pos:usb1/a.md', 'epubloc:usb1/b.epub:5'], docs, roots)).toEqual([])
  })
})
