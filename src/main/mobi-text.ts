// Text of a Kindle book (.mobi / .azw3), for full-text search (issue #20). Runs in the
// search worker only (dynamic import).
//
// foliate-js's MOBI class first sets up decompression (PalmDOC or HUFF/CDIC), then builds a
// reader that needs a DOM. The worker has no DOM, so that second step fails; the
// decompression is ready by then, and that is all we need: every text record, tags removed.

import { openAsBlob } from 'node:fs'
import { MOBI } from '../vendor/foliate/mobi.js'
import { collapse, stripTags } from './library'

export async function mobiText(abs: string, maxChars: number): Promise<string> {
  const mobi = new MOBI({ unzlib: async (data) => data })
  try {
    await mobi.open(await openAsBlob(abs))
  } catch {
    // expected: the reader part needs a DOM (see above)
  }
  const headers = mobi.headers
  // Encrypted (DRM) books can't be read.
  if (!headers || headers.palmdoc.encryption !== 0) return ''
  // Streaming decoder: a character may be split between two records.
  const decoder = new TextDecoder(headers.mobi.encoding === 65001 ? 'utf-8' : 'windows-1252')
  let html = ''
  let text = ''
  for (let i = 0; i < headers.palmdoc.numTextRecords; i++) {
    html += decoder.decode(await mobi.loadText(i), { stream: true })
    // Strip in pieces, cutting after the last complete tag.
    const cut = html.lastIndexOf('>') + 1
    text += ' ' + stripTags(html.slice(0, cut))
    html = html.slice(cut)
    if (text.length > maxChars * 1.5) break
  }
  return collapse(text + ' ' + stripTags(html)).slice(0, maxChars)
}
