import { describe, expect, it } from 'vitest'
import { looksLikeSameFolder, matchScore, remapEntries, type FoundDoc } from '../src/main/relink'

const docs: FoundDoc[] = [
  { path: 'a.md', hash: 'h1', name: 'a.md' },
  { path: 'sub/b.md', hash: 'h2', name: 'b.md' },
  { path: 'moved/c.md', hash: 'h3', name: 'c.md' },
  { path: 'big.pdf', name: 'big.pdf' } // too big to hash
]

describe('finding a folder\'s old data (review point 2)', () => {
  it('scores old entries by content, then by path or file name', () => {
    const old = { 'a.md': { hash: 'h1', name: 'a.md' }, 'c.md': { hash: 'h3', name: 'c.md' }, 'big.pdf': { name: 'big.pdf' }, 'gone.md': { hash: 'zz', name: 'gone.md' } }
    expect(matchScore(old, docs)).toEqual({ total: 4, matched: 3, byContent: 2 })
  })

  it('needs half of the documents, and a content match or several names', () => {
    expect(looksLikeSameFolder({ total: 1, matched: 1, byContent: 1 })).toBe(true)
    expect(looksLikeSameFolder({ total: 4, matched: 3, byContent: 0 })).toBe(true)
    expect(looksLikeSameFolder({ total: 2, matched: 2, byContent: 0 })).toBe(false) // two file names only: could be chance
    expect(looksLikeSameFolder({ total: 10, matched: 4, byContent: 4 })).toBe(false) // less than half
    expect(looksLikeSameFolder({ total: 0, matched: 0, byContent: 0 })).toBe(false)
  })

  it('moves entries to where their documents are now', () => {
    const old = {
      'a.md': { hash: 'h1', name: 'a.md', tags: ['same place'] },
      'c.md': { hash: 'h3', name: 'c.md', tags: ['moved, same content'] },
      'old/big.pdf': { name: 'big.pdf', tags: ['moved, same name'] },
      'gone.md': { hash: 'zz', name: 'gone.md', tags: ['nowhere'] }
    }
    expect(Object.keys(remapEntries(old, docs)).sort()).toEqual(['a.md', 'big.pdf', 'gone.md', 'moved/c.md'])
  })

  it('does not guess when several files have the same name', () => {
    const twins: FoundDoc[] = [
      { path: 'x/notes.md', name: 'notes.md' },
      { path: 'y/notes.md', name: 'notes.md' }
    ]
    expect(Object.keys(remapEntries({ 'z/notes.md': { name: 'notes.md' } }, twins))).toEqual(['z/notes.md'])
  })
})
