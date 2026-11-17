// Notes are written in Markdown (issue #21): **bold**, lists, `code`, links...
// Raw HTML is not allowed in notes, and the result is sanitised anyway. Links open in the
// browser (the main window never navigates, see will-navigate in src/main/index.ts).

import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const cache = new Map<string, string>()

/** Note text -> safe HTML. */
export function renderNote(text: string): string {
  let html = cache.get(text)
  if (html === undefined) {
    html = DOMPurify.sanitize(md.render(text), { USE_PROFILES: { html: true } })
    if (cache.size > 500) cache.clear()
    cache.set(text, html)
  }
  return html
}
