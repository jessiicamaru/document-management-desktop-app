// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
// @ts-expect-error epub.js internals have no type declarations
import Locations from 'epubjs/lib/locations'
import { generateLocations } from '../src/renderer/src/lib/epub-locations'

/** Two chapters with long paragraphs, inline tags and empty text nodes. */
const chapters = [
  `<p>${'Sự kiện được lưu lại theo thứ tự. '.repeat(40)}</p>\n  <p>Có <b>chữ đậm</b> và <i>${'nghiêng '.repeat(60)}</i>.</p>`,
  `<h1>Chương 2</h1>\n<p>${'Replay để dựng lại trạng thái. '.repeat(80)}</p>`
].map((body) => new DOMParser().parseFromString(`<html><head><title>x</title></head><body>${body}</body></html>`, 'text/html'))

/** Just enough of an epub.js Book for generateLocations(). */
const fakeBook = () => {
  let unloads = 0
  const sections = chapters.map((doc, i) => ({
    linear: true,
    cfiBase: `/6/${(i + 1) * 2}`,
    load: async () => doc.documentElement,
    unload: () => void unloads++
  }))
  return { book: { spine: { each: (fn: (s: (typeof sections)[number]) => void) => sections.forEach(fn) }, load: async () => null }, unloads: () => unloads }
}

describe('generateLocations (issue #13)', () => {
  it('gives exactly the same locations as epub.js', async () => {
    const reference = Object.create(Locations.prototype)
    reference.break = 150
    const expected = chapters.flatMap((doc, i) => reference.parse(doc.documentElement, `/6/${(i + 1) * 2}`, 150))
    const { book, unloads } = fakeBook()
    const ours = await generateLocations(book as never, 150, () => false)
    expect(expected.length).toBeGreaterThan(10)
    expect(ours).toEqual(expected)
    expect(unloads()).toBe(2) // chapters are unloaded again
  })

  it('stops when the book is closed', async () => {
    const { book } = fakeBook()
    expect(await generateLocations(book as never, 150, () => true)).toBeNull()
  })
})
