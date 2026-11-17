import { describe, expect, it } from 'vitest'
import { applyHtmlEdits, HtmlEditError } from '../src/main/html-edit'

const page = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>T</title>
  <style>p{color:red}</style>
</head>
<body>
  <h1>Event   Sourcing</h1>
  <section>
    <p>Lưu <strong>chuỗi</strong> event &amp; replay.</p>
    <ul><li>Một</li><li>Hai</li></ul>
  </section>
</body>
</html>
`

describe('applyHtmlEdits', () => {
  // body = [1], h1 = [1,0], section = [1,1], p = [1,1,0], ul = [1,1,1], li#2 = [1,1,1,1]
  it('replaces only the inner HTML of the edited block, keeping the rest byte-for-byte', () => {
    const out = applyHtmlEdits(page, [{ path: [1, 1, 0], tag: 'p', html: 'Lưu <strong>chuỗi</strong> sự kiện &amp; replay.' }])
    expect(out).toBe(page.replace('event &amp; replay', 'sự kiện &amp; replay'))
  })

  it('applies several edits at once', () => {
    const out = applyHtmlEdits(page, [
      { path: [1, 0], tag: 'h1', html: 'ES' },
      { path: [1, 1, 1, 1], tag: 'li', html: 'Hai (sửa)' }
    ])
    expect(out).toContain('<h1>ES</h1>')
    expect(out).toContain('<li>Hai (sửa)</li>')
    expect(out).toContain('<li>Một</li>')
    expect(out).toContain('<style>p{color:red}</style>')
  })

  it('works with Windows line endings and a byte-order mark', () => {
    const crlf = '﻿' + page.replace(/\n/g, '\r\n')
    const out = applyHtmlEdits(crlf, [{ path: [1, 1, 0], tag: 'p', html: 'X' }])
    expect(out).toBe(crlf.replace('Lưu <strong>chuỗi</strong> event &amp; replay.', 'X'))
  })

  it('refuses when the element at that position is a different tag', () => {
    expect(() => applyHtmlEdits(page, [{ path: [1, 1, 0], tag: 'li', html: 'X' }])).toThrow(HtmlEditError)
  })

  it('refuses elements without an end tag in the source', () => {
    const src = '<html><body><ul><li>Một<li>Hai</ul></body></html>'
    expect(() => applyHtmlEdits(src, [{ path: [1, 0, 0], tag: 'li', html: 'X' }])).toThrow(/thẻ đóng/)
  })

  it('refuses a path that does not exist', () => {
    expect(() => applyHtmlEdits(page, [{ path: [1, 9], tag: 'p', html: 'X' }])).toThrow(HtmlEditError)
  })
})
