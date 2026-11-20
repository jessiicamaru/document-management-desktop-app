import { describe, expect, it } from 'vitest'
import { applyHtmlEdits, editModeInjection, HtmlEditError, sanitizeInline } from '../src/main/html-edit'

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

describe('editing HTML with formatting', () => {
  it('the script added to the page in edit mode is valid JavaScript', () => {
    const html = editModeInjection('n0nce')
    const js = html.slice(html.indexOf('>', html.indexOf('<script')) + 1, html.lastIndexOf('</script>'))
    expect(() => new Function(js)).not.toThrow()
  })

  it('keeps bold, links and pictures; drops scripts, handlers and javascript: links', () => {
    expect(sanitizeInline('Lưu <b>chuỗi</b> <a href="https://x.dev" class="k">link</a> <img src="data:image/webp;base64,AAAA" alt="">')).toBe(
      'Lưu <b>chuỗi</b> <a href="https://x.dev" class="k">link</a> <img src="data:image/webp;base64,AAAA" alt="">'
    )
    expect(sanitizeInline('a<script>alert(1)</script><img src=x onerror="alert(1)"><a href=" JaVaScript:alert(1)">b</a>')).toBe('a<img src="x"><a>b</a>')
    expect(sanitizeInline('<div>trong <p>khối</p></div><!-- c -->')).toBe('trong khối')
    expect(sanitizeInline('<a href="data:text/html,x">y</a>')).toBe('<a>y</a>')
    expect(sanitizeInline('Đoạn mới<b></b><i><b></b></i> và<br>dòng')).toBe('Đoạn mới và<br>dòng')
  })

  it('new paragraphs (Enter) go right after their block, on their own lines, indented like it', () => {
    const out = applyHtmlEdits(page, [{ path: [1, 1, 0], tag: 'p', html: 'Lưu <strong>chuỗi</strong> event &amp; replay.', after: [{ tag: 'p', html: 'Đoạn <b>mới</b>' }, { tag: 'p', html: 'Thêm nữa' }] }])
    expect(out).toContain('    <p>Lưu <strong>chuỗi</strong> event &amp; replay.</p>\n    <p>Đoạn <b>mới</b></p>\n    <p>Thêm nữa</p>\n    <ul>')
    const li = applyHtmlEdits(page, [{ path: [1, 1, 1, 0], tag: 'li', html: 'Một', after: [{ tag: 'li', html: 'Một rưỡi' }] }])
    expect(li).toContain('<ul><li>Một</li>\n<li>Một rưỡi</li><li>Hai</li></ul>')
    expect(() => applyHtmlEdits(page, [{ path: [1, 0], tag: 'h1', html: 'x', after: [{ tag: 'div' as 'p', html: 'y' }] }])).toThrow(HtmlEditError)
  })
})

describe('new headings and lists typed while editing', () => {
  it('go after their block: a heading, then a list with one item per line', () => {
    const out = applyHtmlEdits(page, [
      {
        path: [1, 1, 0],
        tag: 'p',
        html: 'Lưu <strong>chuỗi</strong> event &amp; replay.',
        after: [
          { tag: 'h2', html: 'Mục mới' },
          { tag: 'ul', html: '<li>Một <b>a</b></li><li>Hai<script>x</script></li><p>bỏ</p>' }
        ]
      }
    ])
    expect(out).toContain('replay.</p>\n    <h2>Mục mới</h2>\n    <ul>\n      <li>Một <b>a</b></li>\n      <li>Hai</li>\n    </ul>\n    <ul><li>Một</li>')
  })

  it('refuses other block types', () => {
    expect(() => applyHtmlEdits(page, [{ path: [1, 0], tag: 'h1', html: 'x', after: [{ tag: 'table' as 'p', html: 'y' }] }])).toThrow(HtmlEditError)
  })
})

describe('dragging blocks into a new order', () => {
  it('reorders list items, byte for byte', () => {
    const out = applyHtmlEdits(page, [{ path: [1, 1, 1], tag: 'ul', order: [{ i: 1 }, { i: 0 }] }])
    expect(out).toBe(page.replace('<ul><li>Một</li><li>Hai</li></ul>', '<ul><li>Hai</li><li>Một</li></ul>'))
  })

  it('a moved block keeps its own edits; new blocks can sit among the others', () => {
    const out = applyHtmlEdits(page, [
      { path: [1, 1], tag: 'section', order: [{ i: 1 }, { tag: 'p', html: 'Mới <b>thêm</b>' }, { i: 0 }] },
      { path: [1, 1, 0], tag: 'p', html: 'Lưu <strong>chuỗi</strong> event.' }
    ])
    expect(out).toContain('  <section>\n    <ul><li>Một</li><li>Hai</li></ul>\n    <p>Mới <b>thêm</b></p>\n    <p>Lưu <strong>chuỗi</strong> event.</p>\n  </section>')
  })

  it('a paragraph can follow a list (an element that is not a text block)', () => {
    const out = applyHtmlEdits(page, [{ path: [1, 1, 1], tag: 'ul', after: [{ tag: 'p', html: 'Sau danh sách' }] }])
    expect(out).toContain('<ul><li>Một</li><li>Hai</li></ul>\n    <p>Sau danh sách</p>\n  </section>')
  })

  it('refuses when text sits between the blocks, or the order does not match the file', () => {
    const mixed = page.replace('<ul>', 'chữ lẻ <ul>')
    expect(() => applyHtmlEdits(mixed, [{ path: [1, 1], tag: 'section', order: [{ i: 1 }, { i: 0 }] }])).toThrow(HtmlEditError)
    expect(() => applyHtmlEdits(page, [{ path: [1, 1], tag: 'section', order: [{ i: 0 }, { i: 0 }] }])).toThrow(HtmlEditError)
    expect(() => applyHtmlEdits(page, [{ path: [1, 1], tag: 'section', order: [{ i: 0 }] }])).toThrow(HtmlEditError)
  })
})
