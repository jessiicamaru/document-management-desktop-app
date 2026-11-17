// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createAnchoring } from '../src/shared/anchor'
import type { Annotation } from '../src/shared/types'

const A = createAnchoring()

const ann = (id: string, quote: string, prefix = '', suffix = '', note = ''): Annotation => ({
  id,
  quote,
  prefix,
  suffix,
  note,
  color: 'yellow',
  created: 0,
  updated: 0
})

let root: HTMLElement
beforeEach(() => {
  document.body.innerHTML = `<article id="r"><h1>Event Sourcing</h1>
    <p>Lưu <strong>chuỗi event</strong> rồi replay. Event là sự thật.</p>
    <script>var event = 1</script><style>p{}</style>
    <svg><text>event trong sơ đồ</text></svg>
    <p>Event store chỉ ghi thêm.</p></article>`
  root = document.getElementById('r')!
})

describe('findQuote / describe', () => {
  it('finds the right occurrence using the text around it', () => {
    const text = 'Event một. Event hai. Event ba.'
    expect(A.findQuote(text, { quote: 'Event', prefix: 'một. ', suffix: ' hai' })).toEqual({ start: 11, end: 16 })
    expect(A.findQuote(text, { quote: 'Event', prefix: 'hai. ', suffix: ' ba' })).toEqual({ start: 22, end: 27 })
  })
  it('still finds the quote when the surrounding text changed', () => {
    expect(A.findQuote('Mở đầu mới. Event hai.', { quote: 'Event hai', prefix: 'cũ. ', suffix: '.' })).toEqual({ start: 12, end: 21 })
  })
  it('returns null when the quote is gone', () => {
    expect(A.findQuote('abc', { quote: 'xyz', prefix: '', suffix: '' })).toBeNull()
  })
  it('describe keeps 32 characters of context on each side', () => {
    const text = 'x'.repeat(50) + 'QUOTE' + 'y'.repeat(50)
    const q = A.describe(text, 50, 55)
    expect(q).toEqual({ quote: 'QUOTE', prefix: 'x'.repeat(32), suffix: 'y'.repeat(32) })
  })
})

describe('textIndex', () => {
  it('ignores scripts, styles and SVG', () => {
    const { text } = A.textIndex(root)
    expect(text).toContain('chuỗi event')
    expect(text).not.toContain('var event')
    expect(text).not.toContain('trong sơ đồ')
  })
})

describe('apply / clear', () => {
  it('highlights text across inline tags and reports missing quotes', () => {
    const missing = A.apply(root, [ann('a1', 'Lưu chuỗi event', '', ' rồi'), ann('a2', 'không có trong bài')])
    expect(missing).toEqual(['a2'])
    const marks = root.querySelectorAll('mark[data-sd-ann="a1"]')
    expect([...marks].map((m) => m.textContent).join('')).toBe('Lưu chuỗi event')
    expect(root.querySelector('strong mark')).not.toBeNull() // the bold part is wrapped inside <strong>
  })

  it('does not change the text, and clear() restores the original DOM', () => {
    const before = root.innerHTML
    const textBefore = A.textIndex(root).text
    A.apply(root, [ann('a1', 'replay. Event là')])
    expect(root.querySelector('mark')).not.toBeNull()
    expect(A.textIndex(root).text).toBe(textBefore)
    A.clear(root)
    expect(root.innerHTML).toBe(before)
  })

  it('picks the occurrence that matches the context', () => {
    A.apply(root, [ann('a1', 'Event', 'thật.\n    ', ' store')])
    const mark = root.querySelector('mark[data-sd-ann="a1"]')!
    expect(mark.closest('p')!.textContent).toContain('Event store')
  })
})

describe('selectionInfo / offsetsOf', () => {
  it('turns a DOM selection into quote + context', () => {
    const strong = root.querySelector('strong')!.firstChild!
    const range = document.createRange()
    range.setStart(strong, 0)
    range.setEnd(strong, 5) // "chuỗi"
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const info = A.selectionInfo(root, sel)!
    expect(info.quote).toBe('chuỗi')
    expect(info.prefix.endsWith('Lưu ')).toBe(true)
    expect(info.suffix.startsWith(' event')).toBe(true)
  })
})

describe('printNotes', () => {
  it('numbers notes in reading order and lists them at the end', () => {
    A.printNotes(root, [ann('b', 'Event store', '', '', 'ghi chú hai'), ann('a', 'chuỗi event', '', '', 'ghi chú một'), ann('c', 'replay')], 'Ghi chú')
    const refs = [...root.querySelectorAll('sup[data-sd-ref] a')].map((a) => a.textContent)
    expect(refs).toEqual(['1', '2'])
    const items = [...root.querySelectorAll('[data-sd-notes] li')].map((li) => li.textContent)
    expect(items[0]).toContain('ghi chú một')
    expect(items[1]).toContain('ghi chú hai')
    expect(root.querySelector('mark[data-sd-ann="c"]')).not.toBeNull() // highlight without note: drawn, not numbered
  })
})

describe('findAll (Ctrl+F, issue #17)', () => {
  it('finds every match, accent- and case-insensitive, across inline tags', () => {
    document.body.innerHTML = `<article id="f"><p>Sự kiện là <strong>sự</strong> kiện. SU KIEN!</p><script>sự kiện</script></article>`
    const root = document.getElementById('f')!
    const ranges = A.findAll(root, 'su kien')
    expect(ranges.map((r) => r.toString())).toEqual(['Sự kiện', 'sự kiện', 'SU KIEN'])
  })
  it('returns nothing for an empty query', () => {
    expect(A.findAll(document.body, '   ')).toEqual([])
  })
})
