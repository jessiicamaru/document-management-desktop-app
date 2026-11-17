// Reads individual files out of a .zip (an EPUB is a zip) without loading the whole archive.
//
// A zip ends with a "central directory" listing every file and where it is stored. We read
// only that directory and then the few files we need (a few KB), instead of a 100 MB book.
// Supports "stored" and "deflate" entries, which is what EPUBs use. ZIP64 archives (> 4 GB)
// are not supported; callers treat that like any unreadable book.

import { promises as fs } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

interface Entry {
  method: number
  compressedSize: number
  localHeaderOffset: number
}

export interface ZipReader {
  /** File names in the archive. */
  names(): string[]
  /** Content of one file, or null if it isn't in the archive. */
  read(name: string): Promise<Buffer | null>
  close(): Promise<void>
}

const EOCD = 0x06054b50 // "end of central directory" record
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export async function openZip(file: string): Promise<ZipReader> {
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    // The end record is at the very end, after an optional comment of up to 64 KB.
    const tailSize = Math.min(size, 22 + 0xffff)
    const tail = Buffer.alloc(tailSize)
    await handle.read(tail, 0, tailSize, size - tailSize)
    let eocd = -1
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('not a zip file')
    const dirSize = tail.readUInt32LE(eocd + 12)
    const dirOffset = tail.readUInt32LE(eocd + 16)
    if (dirOffset === 0xffffffff) throw new Error('ZIP64 is not supported')

    const dir = Buffer.alloc(dirSize)
    await handle.read(dir, 0, dirSize, dirOffset)
    const entries = new Map<string, Entry>()
    for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === CENTRAL; ) {
      const nameLength = dir.readUInt16LE(p + 28)
      const extraLength = dir.readUInt16LE(p + 30)
      const commentLength = dir.readUInt16LE(p + 32)
      const name = dir.toString('utf8', p + 46, p + 46 + nameLength)
      entries.set(name, {
        method: dir.readUInt16LE(p + 10),
        compressedSize: dir.readUInt32LE(p + 20),
        localHeaderOffset: dir.readUInt32LE(p + 42)
      })
      p += 46 + nameLength + extraLength + commentLength
    }

    return {
      names: () => [...entries.keys()],
      async read(name) {
        const e = entries.get(name)
        if (!e) return null
        const header = Buffer.alloc(30)
        await handle.read(header, 0, 30, e.localHeaderOffset)
        if (header.readUInt32LE(0) !== LOCAL) throw new Error(`bad zip entry: ${name}`)
        const start = e.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
        const data = Buffer.alloc(e.compressedSize)
        await handle.read(data, 0, e.compressedSize, start)
        if (e.method === 0) return data
        if (e.method === 8) return inflateRawSync(data)
        throw new Error(`unsupported zip compression ${e.method}`)
      },
      close: () => handle.close()
    }
  } catch (err) {
    await handle.close()
    throw err
  }
}
