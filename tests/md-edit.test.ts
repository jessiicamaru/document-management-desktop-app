import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'
import { alignText, applyMarkdownEdits, diffWords, lineStartsOf, sourceRangesPlugin, tableCellRanges } from '../src/renderer/src/lib/md-edit'

/** Applies hunks to a string, to check diffWords produces the target text. */
const patch = (a: string, hunks: ReturnType<typeof diffWords>): string =>
  [...hunks].reverse().reduce((s, h) => s.slice(0, h.start) + h.insert + s.slice(h.end), a)

/** Renders with source ranges and returns [range, text] of every editable block. */
function blocks(src: string): { start: number; end: number; text: string }[] {
  const md = new MarkdownIt()
  sourceRangesPlugin(md)
  const html = md.render(src, { lineStarts: lineStartsOf(src), offset: 0, length: src.length })
  return [...html.matchAll(/data-src="(\d+):(\d+)"[^>]*>([\s\S]*?)<\/(p|h\d|td|th|span)>/g)].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
    text: m[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
  }))
}

describe('diffWords', () => {
  it.each([
    ['Lưu chuỗi event và replay', 'Lưu chuỗi sự kiện và replay'],
    ['abc', 'abcd'],
    ['xin chào', 'chào'],
    ['một hai ba', 'một ba bốn'],
    ['', 'mới'],
    ['same', 'same']
  ])('turns %j into %j', (a, b) => {
    expect(patch(a, diffWords(a, b))).toBe(b)
  })

  it('replaces whole words, not scattered letters', () => {
    expect(diffWords('Lưu event nhé', 'Lưu sự kiện nhé')).toEqual([{ start: 4, end: 9, insert: 'sự kiện' }])
  })
})

describe('alignText', () => {
  it('skips Markdown syntax', () => {
    const map = alignText('Xem **đậm** nhé', 'Xem đậm nhé')!
    expect(map.slice(4, 7)).toEqual([6, 7, 8])
  })
  it('returns null when text is not in the source', () => {
    expect(alignText('abc', 'abd')).toBeNull()
  })
})

describe('tableCellRanges', () => {
  it('splits a row with outer pipes and escaped pipes', () => {
    const line = '| a | b \\| c |'
    expect(tableCellRanges(line).map(([s, e]) => line.slice(s, e).trim())).toEqual(['a', 'b \\| c'])
  })
  it('handles rows without outer pipes', () => {
    const line = 'a | b'
    expect(tableCellRanges(line).map(([s, e]) => line.slice(s, e).trim())).toEqual(['a', 'b'])
  })
})

describe('sourceRangesPlugin', () => {
  const src = '# Tiêu đề\n\nĐoạn **một**\ndòng hai.\n\n- mục A\n- mục B\n\n| x | y |\n|---|---|\n| 1 | 2 |\n'
  it('tags paragraphs, headings, tight list items and table cells with their source range', () => {
    const found = blocks(src)
    const texts = found.map((b) => b.text)
    expect(texts).toEqual(['Tiêu đề', 'Đoạn một\ndòng hai.', 'mục A', 'mục B', 'x', 'y', '1', '2'])
    for (const b of found) expect(alignText(src.slice(b.start, b.end), b.text)).not.toBeNull()
  })
})

describe('applyMarkdownEdits', () => {
  const src = '# Event Sourcing\n\nLưu **chuỗi event** rồi replay.\n\n| Cột | Ý nghĩa |\n|---|---|\n| v1 | đầu |\n'

  const edit = (oldText: string, newText: string) => {
    const b = blocks(src).find((x) => x.text === oldText)!
    return applyMarkdownEdits(src, [{ start: b.start, end: b.end, oldText, newText }])
  }

  it('edits text inside bold and keeps the formatting', () => {
    expect(edit('Lưu chuỗi event rồi replay.', 'Lưu chuỗi sự kiện rồi replay.')).toContain('Lưu **chuỗi sự kiện** rồi replay.')
  })
  it('edits a heading without touching the #', () => {
    expect(edit('Event Sourcing', 'Event Sourcing cơ bản')).toContain('# Event Sourcing cơ bản\n')
  })
  it('edits one table cell only', () => {
    expect(edit('đầu', 'phiên bản đầu')).toContain('| v1 | phiên bản đầu |')
  })
  it('escapes Markdown characters typed by the user', () => {
    expect(edit('Lưu chuỗi event rồi replay.', 'Lưu chuỗi event rồi replay *ngay*.')).toContain('replay \\*ngay\\*.')
  })
  it('throws when the old text cannot be found in the block', () => {
    expect(() => applyMarkdownEdits(src, [{ start: 0, end: 5, oldText: 'không có', newText: 'x' }])).toThrow()
  })
})
