// Text of a PDF, for full-text search (issue #19). Runs in the search worker only: it is
// loaded with a dynamic import, so pdf.js never weighs on the main process.
//
// pdf.js normally parses in its own worker; here we already are in a background thread, so
// its parser runs right here ("fake worker", found through globalThis.pdfjsWorker).

import { promises as fs } from 'node:fs'
// @ts-expect-error the worker module has no type declarations
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker

/** Bigger files are searched by name only. */
const MAX_FILE_BYTES = 150 * 1024 * 1024

export async function pdfText(abs: string, maxChars: number): Promise<string> {
  const stat = await fs.stat(abs)
  if (stat.size > MAX_FILE_BYTES) return ''
  const data = new Uint8Array(await fs.readFile(abs))
  const task = getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 })
  const pdf = await task.promise
  try {
    const pages: string[] = []
    let length = 0
    for (let n = 1; n <= pdf.numPages && length < maxChars; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str + (item.hasEOL ? '\n' : '')
      }
      page.cleanup()
      pages.push(text)
      length += text.length + 2
    }
    return pages.join('\n\n').slice(0, maxChars)
  } finally {
    await pdf.destroy()
  }
}
