import { describe, expect, it } from 'vitest'
import { decodeUtf8Strict, NotUtf8Error } from '../src/main/text-file'

describe('decodeUtf8Strict (issue #4)', () => {
  it('decodes UTF-8 and keeps a byte-order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Xin chào')])
    expect(decodeUtf8Strict(bytes)).toBe('﻿Xin chào')
  })
  it('refuses text in another encoding instead of garbling it', () => {
    // "Vi\xEA\xF2t" is Windows-1258 style bytes, not valid UTF-8
    expect(() => decodeUtf8Strict(new Uint8Array([0x56, 0x69, 0xea, 0xf2, 0x74]))).toThrow(NotUtf8Error)
  })
})
