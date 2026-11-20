// OCR for scanned PDFs (pages that are pictures, without text): tesseract.js reads each page,
// in the app and offline (Vietnamese + English data ship with it, see electron.vite.config.ts).
// The words and their boxes are kept in the app's data (main process, 'ocr:*'); PdfView draws
// them as an invisible text layer, so selecting, highlighting and Ctrl+F work, and search finds
// the text too. The PDF file itself is never changed.

import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OcrData, OcrPage, OcrWord } from '../../../shared/types'

const BASE = new URL('tesseract/', document.baseURI).href

/** Page images are read at about 2× (≈150 dpi for A4), at most this many pixels on a side. */
const MAX_SIDE = 2600

/**
 * Reads every page. `onProgress(done, total)` after each one; stops (resolving null) when
 * `cancelled()` turns true.
 */
export async function recognizePdf(pdf: PDFDocumentProxy, onProgress: (done: number, total: number) => void, cancelled: () => boolean): Promise<OcrData | null> {
  const { createWorker, OEM } = await import('tesseract.js')
  const worker = await createWorker(['vie', 'eng'], OEM.LSTM_ONLY, {
    workerPath: `${BASE}worker.min.js`,
    corePath: `${BASE}core/`,
    langPath: `${BASE}lang/`,
    gzip: true,
    cacheMethod: 'none',
    // The app's security policy has no blob: workers: load the worker file itself.
    workerBlobURL: false
  })
  try {
    const pages: OcrPage[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      if (cancelled()) return null
      onProgress(n - 1, pdf.numPages)
      const page = await pdf.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, MAX_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false })
      const words: OcrWord[] = []
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words) {
              const t = w.text.trim()
              if (!t || w.confidence < 25) continue
              words.push({ t, x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale })
            }
          }
        }
      }
      pages.push({ n, words })
      canvas.width = canvas.height = 0
    }
    onProgress(pdf.numPages, pdf.numPages)
    return { version: 1, at: Date.now(), pages }
  } finally {
    await worker.terminate()
  }
}

/** The text of an OCR page exactly as its text layer contains it (words joined by spaces). */
export const ocrPageText = (page: OcrPage): string => page.words.map((w) => w.t).join(' ')

const measure = document.createElement('canvas').getContext('2d')!

/**
 * An invisible text layer for an OCR page, like pdf.js's: one span per word over the picture,
 * stretched to the word's box, so selecting text follows the page. `scale`: page zoom.
 */
export function ocrTextLayer(page: OcrPage, scale: number): HTMLDivElement {
  const layer = document.createElement('div')
  layer.className = 'textLayer ocr-layer'
  page.words.forEach((w, i) => {
    const span = document.createElement('span')
    span.textContent = i < page.words.length - 1 ? `${w.t} ` : w.t
    const size = Math.max(4, (w.y1 - w.y0) * scale)
    measure.font = `${size}px sans-serif`
    const width = measure.measureText(w.t).width || 1
    span.style.left = `${w.x0 * scale}px`
    span.style.top = `${w.y0 * scale}px`
    span.style.fontSize = `${size}px`
    span.style.transform = `scaleX(${((w.x1 - w.x0) * scale) / width})`
    layer.appendChild(span)
  })
  return layer
}
