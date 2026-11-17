// Cached text of a document for search snippets (issue #12).
//
// Stored as UTF-8 (about half the size of UTF-16 for Vietnamese or English text) with a
// small table of checkpoints: for every ~4096 characters, where that character starts in
// the file. A snippet at character N then reads only a few KB starting at the checkpoint
// before N, instead of the whole file.
//
// File layout:  "SDT1" | n (uint32) | n × (char index uint32, byte offset uint32) | UTF-8 text
// Character indexes count UTF-16 code units, like JavaScript string indexes.
//
// No Electron imports here, so this file is unit tested directly.

import { promises as fs } from 'node:fs'

const MAGIC = 'SDT1'
export const CHECKPOINT_EVERY = 4096
/** A UTF-16 code unit takes at most 3 bytes in UTF-8 (a surrogate pair is 4 bytes for 2 units). */
const MAX_BYTES_PER_UNIT = 3

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/** Encodes `text` with its checkpoint table. */
export function encodeTextCache(text: string): Buffer {
  const points: [number, number][] = []
  const parts: Buffer[] = []
  let bytes = 0
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + CHECKPOINT_EVERY)
    // Never split a surrogate pair: a checkpoint must be at the start of a character.
    if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end++
    points.push([start, bytes])
    const part = Buffer.from(text.slice(start, end), 'utf8')
    parts.push(part)
    bytes += part.length
    start = end
  }
  const header = Buffer.alloc(8 + points.length * 8)
  header.write(MAGIC, 0, 'latin1')
  header.writeUInt32LE(points.length, 4)
  points.forEach(([ch, by], i) => {
    header.writeUInt32LE(ch, 8 + i * 8)
    header.writeUInt32LE(by, 12 + i * 8)
  })
  return Buffer.concat([header, ...parts])
}

interface Header {
  points: [number, number][]
  /** Where the text starts in the file. */
  dataStart: number
}

function parseHeader(buf: Buffer): Header | null {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== MAGIC) return null
  const n = buf.readUInt32LE(4)
  if (buf.length < 8 + n * 8) return null
  const points: [number, number][] = []
  for (let i = 0; i < n; i++) points.push([buf.readUInt32LE(8 + i * 8), buf.readUInt32LE(12 + i * 8)])
  return { points, dataStart: 8 + n * 8 }
}

/** The whole text of a cache file's contents; null if it isn't one. */
export function decodeTextCache(buf: Buffer): string | null {
  const header = parseHeader(buf)
  return header ? buf.toString('utf8', header.dataStart) : null
}

/** Characters [from, from + length) of a cache file, reading only the part needed. */
export async function readTextCacheSlice(file: string, from: number, length: number): Promise<string | null> {
  const handle = await fs.open(file, 'r')
  try {
    const head = Buffer.alloc(8)
    await handle.read(head, 0, 8, 0)
    if (head.toString('latin1', 0, 4) !== MAGIC) return null
    const n = head.readUInt32LE(4)
    const table = Buffer.alloc(8 + n * 8)
    await handle.read(table, 0, table.length, 0)
    const header = parseHeader(table)
    if (!header || !n) return header ? '' : null
    // Last checkpoint at or before `from`.
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (header.points[mid][0] <= from) lo = mid
      else hi = mid - 1
    }
    const [ch, by] = header.points[lo]
    const want = from - ch + length
    const buf = Buffer.alloc(want * MAX_BYTES_PER_UNIT + 4)
    const { bytesRead } = await handle.read(buf, 0, buf.length, header.dataStart + by)
    // A multi-byte character cut at the end of what was read turns into U+FFFD; it lies
    // beyond what we need, because we read 3 bytes for every unit wanted.
    const text = buf.toString('utf8', 0, bytesRead)
    return text.slice(from - ch, from - ch + length)
  } finally {
    await handle.close()
  }
}
