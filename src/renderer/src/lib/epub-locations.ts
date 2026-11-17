// "% read" in a book needs the book split into "locations" (a CFI every N characters).
// epub.js's own book.locations.generate() works chapter by chapter, but splits each chapter
// in one go; a long chapter then freezes the window for seconds (issue #13).
//
// This does the same work (same CFIs, so the result loads with book.locations.load()), but
// gives the window back every few milliseconds, also in the middle of a chapter.

import { EpubCFI } from 'epubjs'

interface Section {
  linear: boolean
  cfiBase: string
  load(request: unknown): Promise<Element>
  unload(): void
}

interface BookLike {
  spine: { each(fn: (section: Section) => void): void }
  load: (path: string) => Promise<unknown>
}

interface RangeLike {
  startContainer?: Node
  startOffset?: number
  endContainer?: Node
  endOffset?: number
}

const SLICE_MS = 8

/** Waits for the next macrotask, so input and painting can happen. */
const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * Splits every linear chapter into locations of `chars` characters.
 * Stops early (returns null) as soon as `cancelled()` is true.
 */
export async function generateLocations(book: BookLike, chars: number, cancelled: () => boolean): Promise<string[] | null> {
  const sections: Section[] = []
  book.spine.each((s) => {
    if (s.linear) sections.push(s)
  })
  const request = book.load.bind(book)
  const locations: string[] = []
  let sliceEnd = performance.now() + SLICE_MS
  const maybeYield = async (): Promise<boolean> => {
    if (performance.now() < sliceEnd) return !cancelled()
    await yieldToUi()
    sliceEnd = performance.now() + SLICE_MS
    return !cancelled()
  }

  for (const section of sections) {
    if (!(await maybeYield())) return null
    const contents = await section.load(request)
    try {
      const body = contents.ownerDocument.querySelector('body')
      if (!body) continue
      // Same rules as epub.js Locations.parse(), so the CFIs are identical.
      const walker = contents.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let counter = 0
      let range: RangeLike = {}
      let prev: Text | null = null
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        if (!(await maybeYield())) return null
        const len = n.length
        if (n.textContent!.trim().length === 0) continue
        let pos = 0
        if (counter === 0) range = { startContainer: n, startOffset: 0 }
        if (chars - counter > len) {
          counter += len
          pos = len
        }
        while (pos < len) {
          const dist = chars - counter
          if (counter === 0) {
            pos += 1
            range = { startContainer: n, startOffset: pos }
          }
          if (pos + dist >= len) {
            counter += len - pos
            pos = len
          } else {
            pos += dist
            range.endContainer = n
            range.endOffset = pos
            locations.push(new EpubCFI(range as unknown as Range, section.cfiBase).toString())
            counter = 0
          }
        }
        prev = n
      }
      if (range.startContainer && prev) {
        range.endContainer = prev
        range.endOffset = prev.length
        locations.push(new EpubCFI(range as unknown as Range, section.cfiBase).toString())
      }
    } finally {
      section.unload()
    }
  }
  return locations
}
