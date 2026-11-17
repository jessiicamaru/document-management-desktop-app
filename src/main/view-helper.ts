// Small scripts appended to HTML documents by the doc:// protocol.
//
// The document runs in a sandboxed, cross-origin iframe, so the app can't look inside it.
// viewModeInjection runs inside the page while you read, and talks to the app with postMessage:
//  - outline (h1-h3), the heading you're reading, and the scroll position
//  - highlights: reports what you select, draws highlights, reports clicks on them
//  - forwards app shortcuts (Alt+←/→, Ctrl+K/P/E/,) typed while the page has focus
// printNotesInjection is used only when exporting to PDF with notes.
// Neither ever changes the file; highlights exist only in the page shown/printed.

import { createAnchoring } from '../shared/anchor'
import type { Annotation } from '../shared/types'
import { t } from '../shared/i18n'

/** Source of createAnchoring, run inside the page. It is self-contained by design. */
const anchoringSource = (): string => `(${createAnchoring.toString()})()`

/** JSON that is safe to put inside a <script> element. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c')

export function viewModeInjection(): string {
  return `
<script data-studydocs>
(() => {
  const anchoring = ${anchoringSource()}
  const send = (msg) => parent.postMessage({ source: 'studydocs', ...msg }, '*')
  let headings = []
  let annotations = []

  // ---------- outline + reading position ----------
  const collect = () => {
    headings = [...document.querySelectorAll('h1, h2, h3')].filter((h) => h.textContent.trim() && h.getClientRects().length)
    send({
      type: 'outline',
      items: headings.map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim().replace(/\\s+/g, ' ') }))
    })
  }

  let pending = false
  const report = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      let active = -1
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= 90) active = i
        else break
      }
      send({ type: 'scroll', y: Math.round(scrollY), active })
    })
  }
  addEventListener('scroll', report, { passive: true })

  // ---------- find (Ctrl+F) ----------
  let found = []
  let foundIndex = 0
  const showFound = () => {
    anchoring.showFind(document, found, foundIndex)
    const current = found[foundIndex]
    if (current) {
      const r = current.getBoundingClientRect()
      if (r.top < 60 || r.bottom > innerHeight - 40) scrollBy({ top: r.top - innerHeight / 3, behavior: 'instant' })
    }
    send({ type: 'find-result', index: foundIndex, total: found.length })
  }

  // ---------- highlights ----------
  const drawHighlights = () => {
    const missing = anchoring.apply(document.body, annotations)
    send({ type: 'anchored', missing })
  }
  const reportSelection = () => {
    setTimeout(() => send({ type: 'selection', info: anchoring.selectionInfo(document.body, getSelection()) }), 0)
  }
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return
    const mark = e.target.closest && e.target.closest('mark[data-sd-ann]')
    const sel = getSelection()
    if (mark && (!sel || sel.isCollapsed)) {
      const r = mark.getBoundingClientRect()
      send({ type: 'annotation-click', id: mark.getAttribute('data-sd-ann'), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
      return
    }
    reportSelection()
  })
  document.addEventListener('keyup', (e) => { if (e.shiftKey) reportSelection() })

  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.source !== 'studydocs-app') return
    const msg = e.data
    if (msg.type === 'goto') headings[msg.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (msg.type === 'restore') scrollTo({ top: msg.y, behavior: 'instant' })
    if (msg.type === 'annotations') {
      annotations = msg.items
      drawHighlights()
    }
    if (msg.type === 'goto-annotation') {
      const mark = document.querySelector('mark[data-sd-ann="' + CSS.escape(msg.id) + '"]')
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        mark.animate([{ outline: '3px solid rgba(180,83,31,.9)' }, { outline: '3px solid transparent' }], { duration: 1400 })
      }
    }
    if (msg.type === 'clear-selection') getSelection()?.removeAllRanges()
    // Ctrl+F: find in this page.
    if (msg.type === 'find') {
      found = anchoring.findAll(document.body, msg.query)
      foundIndex = 0
      showFound()
    }
    if (msg.type === 'find-step' && found.length) {
      foundIndex = (foundIndex + msg.dir + found.length) % found.length
      showFound()
    }
    if (msg.type === 'find-clear') {
      found = []
      anchoring.showFind(document, [], 0)
    }
  })

  // ---------- shortcuts ----------
  // Alt+←/→ make the app open another document, which removes this page. That must only
  // happen once the key is released: removing the page while it is still handling the key
  // press crashes the app's window. So: block the key on press, report it on release.
  const isHistoryKey = (e) => e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
  addEventListener('keyup', (e) => {
    if (isHistoryKey(e)) send({ type: 'key', key: e.key === 'ArrowLeft' ? 'back' : 'forward' })
  }, true)
  addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase()
    if (isHistoryKey(e)) {
      e.preventDefault()
    } else if ((e.ctrlKey || e.metaKey) && ['k', 'p', 'e', ',', 'f', 'o'].includes(key)) {
      e.preventDefault()
      send({ type: 'key', key: 'ctrl+' + key })
    } else if (e.key === 'Escape') {
      send({ type: 'selection', info: null })
    }
  }, true)

  const ready = () => {
    collect()
    send({ type: 'ready' })
    report()
    setTimeout(collect, 1000) // headings added later by the page's own scripts
  }
  if (document.readyState === 'complete') ready()
  else addEventListener('load', ready)
})()
</script>`
}

/** Export to PDF with notes: draws the highlights, numbers the notes and lists them at the end. */
export function printNotesInjection(annotations: Annotation[], docNote = ''): string {
  return `
<script data-studydocs>
(() => {
  const anchoring = ${anchoringSource()}
  anchoring.printNotes(document.body, ${scriptJson(annotations)}, ${scriptJson(t('Ghi chú'))}, ${scriptJson(docNote)}, ${scriptJson(t('(đoạn trích này không còn trong bài)'))})
})()
</script>`
}
