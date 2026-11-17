import { describe, expect, it } from 'vitest'
import { extractEpub } from '../src/main/library'
// @ts-expect-error plain JS helper script
import { buildSampleEpub } from '../scripts/make-sample-epub.mjs'

describe('extractEpub', () => {
  it('reads the title and the chapters in reading order', async () => {
    const { title, text } = await extractEpub(await buildSampleEpub())
    expect(title).toBe('Git cơ bản')
    expect(text.indexOf('Git là gì?')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Chương 1')).toBeLessThan(text.indexOf('Chương 2'))
    expect(text).toContain('pull trước khi push')
  })

  it('returns nothing for a zip that is not a book', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('hello.txt', 'hi')
    expect(await extractEpub(await zip.generateAsync({ type: 'nodebuffer' }))).toEqual({ title: '', text: '' })
  })
})
