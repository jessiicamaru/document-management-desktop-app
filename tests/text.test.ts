import { describe, expect, it } from 'vitest'
import { findInText, foldAccents, normalize, snippetAt } from '../src/shared/text'

describe('foldAccents', () => {
  it('removes accents and lowercases, keeping the same length', () => {
    const s = 'Sự Kiện — Đường đi của Event Sourcing'
    const f = foldAccents(s)
    expect(f).toBe('su kien - duong di cua event sourcing') // typographic dash folded too
    expect(f.length).toBe(s.length)
  })
  it('agrees with normalize() on Vietnamese text', () => {
    const s = 'Kiến trúc dữ liệu, ủy quyền, NGƯỜI'
    expect(foldAccents(s)).toBe(normalize(s))
  })
})

describe('findInText', () => {
  const text = 'Kiến trúc dữ liệu. Ta lưu chuỗi sự kiện đã xảy ra.'
  it('finds the whole phrase, at the position of the original text', () => {
    const at = findInText(text, 'su kien', ['su', 'kien'])!
    expect(text.slice(at.start, at.end)).toBe('sự kiện')
  })
  it('falls back to the earliest single word', () => {
    const at = findInText(text, 'kien', ['kien'])!
    expect(text.slice(at.start, at.end)).toBe('Kiến')
  })
  it('snippetAt adds ellipses when cut', () => {
    expect(snippetAt('0123456789', 4, 6, 2)).toEqual({ before: '…23', match: '45', after: '67…' })
  })
})
