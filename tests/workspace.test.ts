import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSameOrInside, labelRoots, normalizeRoot, rootConflict, rootKeyOf, splitDocId } from '../src/main/workspace'

const win = process.platform === 'win32'
const p = (...parts: string[]): string => path.resolve(path.sep, ...parts)

describe('rootKeyOf', () => {
  it('is stable and short', () => {
    expect(rootKeyOf(p('data', 'Học'))).toBe(rootKeyOf(p('data', 'Học') + path.sep))
    expect(rootKeyOf(p('data', 'Học'))).toMatch(/^[0-9a-f]{8}$/)
    expect(rootKeyOf(p('data', 'A'))).not.toBe(rootKeyOf(p('data', 'B')))
  })
  it.runIf(win)('ignores case on Windows', () => {
    expect(rootKeyOf('D:\\Hoc')).toBe(rootKeyOf('d:\\HOC'))
  })
})

describe('splitDocId', () => {
  it('splits at the first slash only', () => {
    expect(splitDocId('abcd1234/backend/Event Sourcing.html')).toEqual({ key: 'abcd1234', rel: 'backend/Event Sourcing.html' })
  })
  it('rejects ids without a key or a path', () => {
    expect(splitDocId('nokey')).toBeNull()
    expect(splitDocId('/a.md')).toBeNull()
    expect(splitDocId('abcd/')).toBeNull()
  })
})

describe('isSameOrInside / rootConflict', () => {
  it('detects nesting but not shared name prefixes', () => {
    expect(isSameOrInside(p('a', 'b'), p('a'))).toBe(true)
    expect(isSameOrInside(p('ab'), p('a'))).toBe(false)
  })
  it('refuses duplicates and nested folders, accepts siblings', () => {
    const existing = [p('docs', 'hoc')]
    expect(rootConflict(existing, p('docs', 'hoc'))).toMatch(/đã có/)
    expect(rootConflict(existing, p('docs', 'hoc', 'react'))).toMatch(/bên trong/)
    expect(rootConflict(existing, p('docs'))).toMatch(/chứa/)
    expect(rootConflict(existing, p('notes'))).toBeNull()
  })
})

describe('labelRoots', () => {
  it('uses the folder name, and adds the location when names clash', () => {
    const labels = labelRoots([p('work', 'Docs'), p('home', 'Docs'), p('Học')])
    expect(labels[2]).toBe('Học')
    expect(labels[0]).toBe(`Docs (${path.dirname(normalizeRoot(p('work', 'Docs')))})`)
    expect(labels[0]).not.toBe(labels[1])
  })
})
