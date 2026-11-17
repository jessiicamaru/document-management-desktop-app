import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKPOINT_EVERY, decodeTextCache, encodeTextCache, readTextCacheSlice } from '../src/main/text-cache'
import { foldAccents } from '../src/shared/text'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-textcache-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

// Vietnamese, emoji (surrogate pairs), CJK and plain ASCII, long enough for many checkpoints.
const sample = Array.from({ length: 3000 }, (_, i) => `Đoạn ${i}: sự kiện “được lưu” — 😀 漢字 abc. `).join('')

describe('text cache (issue #12)', () => {
  it('round-trips the text and is smaller than UTF-16', () => {
    const buf = encodeTextCache(sample)
    expect(decodeTextCache(buf)).toBe(sample)
    expect(buf.length).toBeLessThan(sample.length * 2)
    expect(decodeTextCache(Buffer.from('not a cache'))).toBeNull()
    expect(decodeTextCache(encodeTextCache(''))).toBe('')
  })

  it('reads any slice exactly, also across checkpoints and next to emoji', async () => {
    const file = path.join(dir, 'a.u8')
    await writeFile(file, encodeTextCache(sample))
    const starts = [0, 1, 59, CHECKPOINT_EVERY - 1, CHECKPOINT_EVERY, CHECKPOINT_EVERY + 1, 3 * CHECKPOINT_EVERY - 30, sample.length - 50]
    for (let i = 0; i < 200; i++) starts.push(Math.floor((i * 7919) % (sample.length - 1)))
    for (const from of starts) {
      expect(await readTextCacheSlice(file, from, 140)).toBe(sample.slice(from, from + 140))
    }
    expect(await readTextCacheSlice(file, sample.length - 5, 100)).toBe(sample.slice(-5))
  })

  it('folded Vietnamese text with typographic punctuation only uses 1-byte characters', () => {
    const folded = foldAccents('“Sự kiện” — được lưu… ‘đúng’ thứ tự • Ưu tiên')
    expect([...folded].every((c) => c.charCodeAt(0) < 256)).toBe(true)
    expect(folded).toBe('"su kien" - duoc luu. \'dung\' thu tu * uu tien')
  })
})
