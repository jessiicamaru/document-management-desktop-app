// PDF documents, shown with pdf.js (issue #19), so they work like every other document:
// outline, reading position, Ctrl+F, highlights and notes.
//
// Pages are laid out as empty boxes of the right size; a page is drawn (canvas + an
// invisible text layer for selecting text) only when it comes near the screen, and pages
// far away are dropped again, so big PDFs stay light. Highlights are TextQuotes like in the
// other views, plus the page number they are on.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, DocEntry } from '../../../shared/types'
import { createAnchoring } from '../../../shared/anchor'
import { loadLocal, saveLocal } from '../lib/docs'
import type { FindResult, OutlineItem, ReaderCallbacks, ReaderHandle } from './reader'
import { t } from '../../../shared/i18n'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const anchoring = createAnchoring()

interface Props extends ReaderCallbacks {
  doc: DocEntry
  onError: (err: unknown) => void
}

interface Slot {
  /** 1-based page number. */
  n: number
  el: HTMLDivElement
  /** Page size at 100%, in CSS px. */
  width: number
  height: number
  /** Set while the page is drawn (or being drawn). */
  drawn: Promise<void> | null
  task: RenderTask | null
  layer: HTMLDivElement | null
  /** Identifies the current drawing; an older one that finishes late is thrown away. */
  token: object | null
}

type Zoom = 'fit' | number
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
/** Pages drawn ahead of the screen, and how far away a drawn page is dropped again. */
const MARGIN_PX = 800
const KEEP_PAGES = 6

/** The text of a page exactly as its text layer will contain it. */
const pageText = (items: unknown[]): string => items.map((i) => (i as { str?: string }).str ?? '').join('')

/** Number of matches of `query` in `text`, with the same rules as the highlighting. */
function countMatches(text: string, query: string): number {
  const div = document.createElement('div')
  div.textContent = text
  return anchoring.findAll(div, query).length
}

const PdfView = forwardRef<ReaderHandle, Props>(function PdfView(props, ref) {
  const { doc } = props
  const cb = useRef(props)
  cb.current = props

  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const slots = useRef<Slot[]>([])
  const scale = useRef(1)
  const [zoom, setZoom] = useState<Zoom>(() => loadLocal<Zoom>('pdf-zoom', 'fit'))
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [shownScale, setShownScale] = useState(1)
  /** Text of each page (null until read), for Ctrl+F and to know which highlights are gone. */
  const texts = useRef<(string | null)[]>([])
  const allTexts = useRef<Promise<void> | null>(null)
  /** Page (1-based) and y offset at 100% of each outline entry. */
  const outlineAt = useRef<{ page: number; y: number }[]>([])
  const annotations = useRef<Annotation[]>([])
  const found = useRef<{ page: number; k: number }[]>([])
  const foundIndex = useRef(0)
  const foundQuery = useRef('')
  const relayout = useRef<() => void>(() => {})

  // ---------- drawing pages ----------

  /** Draws a page (canvas + text layer + highlights). Resolves when done. */
  function draw(slot: Slot): Promise<void> {
    if (slot.drawn) return slot.drawn
    const pdf = pdfRef.current!
    const s = scale.current
    const token = {}
    slot.token = token
    const current = (): boolean => slot.token === token && s === scale.current && pdfRef.current === pdf
    slot.drawn = (async () => {
      const page = await pdf.getPage(slot.n)
      if (!current()) return
      const viewport = page.getViewport({ scale: s })
      const ratio = window.devicePixelRatio || 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.className = 'pdf-canvas'
      const renderTask = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
      slot.task = renderTask
      renderTask.promise.catch(() => {}) // cancelled when the page is dropped; handled below
      const content = await page.getTextContent()
      texts.current[slot.n - 1] ??= pageText(content.items)
      const layer = document.createElement('div')
      layer.className = 'textLayer'
      await new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport }).render()
      try {
        await renderTask.promise
      } catch {
        return // cancelled: the page was dropped or the zoom changed
      }
      if (!current()) return
      slot.el.replaceChildren(canvas, layer)
      slot.layer = layer
      drawAnnotations(slot)
      if (foundQuery.current && found.current[foundIndex.current]?.page === slot.n) showFound(false)
    })().catch((err) => {
      if (!/cancel/i.test(String(err))) console.error('PDF page', slot.n, err)
    })
    return slot.drawn
  }

  function drop(slot: Slot): void {
    slot.task?.cancel()
    slot.task = null
    slot.drawn = null
    slot.layer = null
    slot.token = null
    slot.el.replaceChildren()
  }

  /** Sizes every page box for the current zoom and redraws what is on screen. */
  function layout(): void {
    const scroller = scrollRef.current
    if (!scroller || !slots.current.length) return
    // Keep the same place in the document when the zoom changes.
    const before = currentPage()
    const old = slots.current[before - 1]
    const within = old ? (scroller.scrollTop - old.el.offsetTop) / Math.max(1, old.el.offsetHeight) : 0
    const widest = Math.max(...slots.current.map((s) => s.width))
    const z = zoomRef.current
    scale.current = z === 'fit' ? Math.max(0.25, Math.min(4, (scroller.clientWidth - 48) / widest)) : z
    setShownScale(scale.current)
    for (const slot of slots.current) {
      drop(slot)
      slot.el.style.width = `${Math.floor(slot.width * scale.current)}px`
      slot.el.style.height = `${Math.floor(slot.height * scale.current)}px`
      slot.el.style.setProperty('--scale-factor', String(scale.current))
      slot.el.style.setProperty('--total-scale-factor', String(scale.current))
    }
    if (old) scroller.scrollTop = old.el.offsetTop + within * old.el.offsetHeight
    drawVisible()
  }

  /** Draws pages on (or near) the screen and drops pages far away. */
  function drawVisible(): void {
    const scroller = scrollRef.current
    if (!scroller) return
    const top = scroller.scrollTop - MARGIN_PX
    const bottom = scroller.scrollTop + scroller.clientHeight + MARGIN_PX
    const near: number[] = []
    for (const slot of slots.current) {
      const y = slot.el.offsetTop
      if (y + slot.el.offsetHeight >= top && y <= bottom) near.push(slot.n)
    }
    for (const slot of slots.current) {
      if (near.includes(slot.n)) void draw(slot)
      else if (slot.drawn && (slot.n < near[0] - KEEP_PAGES || slot.n > near[near.length - 1] + KEEP_PAGES)) drop(slot)
    }
  }

  /** The page at the top third of the screen. */
  function currentPage(): number {
    const scroller = scrollRef.current
    if (!scroller) return 1
    const y = scroller.scrollTop + scroller.clientHeight / 3
    let n = 1
    for (const slot of slots.current) {
      if (slot.el.offsetTop <= y) n = slot.n
      else break
    }
    return n
  }

  /** Scrolls so that point (y at 100%) of page n is near the top, and waits for it to be drawn. */
  async function scrollToPage(n: number, y = 0): Promise<Slot | null> {
    const slot = slots.current[n - 1]
    const scroller = scrollRef.current
    if (!slot || !scroller) return null
    scroller.scrollTop = slot.el.offsetTop + y * scale.current - 12
    drawVisible()
    await draw(slot)
    return slot
  }

  // ---------- page texts (find, missing highlights) ----------

  /** Reads the text of every page, a few at a time so the window stays responsive. */
  function loadAllTexts(): Promise<void> {
    allTexts.current ??= (async () => {
      const pdf = pdfRef.current
      if (!pdf) return
      for (let n = 1; n <= pdf.numPages; n++) {
        if (pdfRef.current !== pdf) return
        if (texts.current[n - 1] == null) {
          const page = await pdf.getPage(n)
          texts.current[n - 1] = pageText((await page.getTextContent()).items)
        }
      }
      reportMissing()
    })()
    return allTexts.current
  }

  // ---------- highlights ----------

  function drawAnnotations(slot: Slot): void {
    if (!slot.layer) return
    anchoring.clear(slot.layer)
    anchoring.apply(
      slot.layer,
      annotations.current.filter((a) => a.page === slot.n)
    )
  }

  /** Highlights whose text is no longer on their page (only pages already read are checked). */
  function reportMissing(): void {
    const missing = annotations.current
      .filter((a) => {
        const text = a.page ? texts.current[a.page - 1] : ''
        return text != null && !anchoring.findQuote(text, a)
      })
      .map((a) => a.id)
    cb.current.onAnchored(missing)
  }

  // ---------- find ----------

  function showFound(scroll: boolean): FindResult {
    const m = found.current[foundIndex.current]
    const slot = m && slots.current[m.page - 1]
    if (!m || !slot?.layer) {
      anchoring.showFind(document, [], 0)
    } else {
      const ranges = anchoring.findAll(slot.layer, foundQuery.current)
      anchoring.showFind(document, ranges, m.k)
      const range = ranges[m.k]
      const scroller = scrollRef.current
      if (scroll && range && scroller) {
        const r = range.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        if (r.top < box.top + 40 || r.bottom > box.bottom - 40) scroller.scrollTop += r.top - box.top - scroller.clientHeight / 3
      }
    }
    return { index: foundIndex.current, total: found.current.length }
  }

  async function gotoFound(): Promise<FindResult> {
    const m = found.current[foundIndex.current]
    if (m) {
      const slot = slots.current[m.page - 1]
      const scroller = scrollRef.current
      const onScreen =
        slot && scroller && slot.el.offsetTop < scroller.scrollTop + scroller.clientHeight && slot.el.offsetTop + slot.el.offsetHeight > scroller.scrollTop
      if (!onScreen || !slot.layer) await scrollToPage(m.page)
    }
    return showFound(true)
  }

  // ---------- open the document ----------

  useEffect(() => {
    let cancelled = false
    const scroller = scrollRef.current!
    const pages = pagesRef.current!
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    slots.current = []
    texts.current = []
    allTexts.current = null
    pages.replaceChildren()

    let scrollTimer: ReturnType<typeof setTimeout> | undefined
    const onScroll = (): void => {
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(drawVisible, 60)
      const page = currentPage()
      let active = -1
      outlineAt.current.forEach((o, i) => {
        if (o.page <= page) active = i
      })
      cb.current.onReading(scroller.scrollTop / scale.current, active)
    }
    scroller.addEventListener('scroll', onScroll)
    // Fit to width again when the window or the side panel changes size.
    let lastWidth = scroller.clientWidth
    const resize = new ResizeObserver(() => {
      if (scroller.clientWidth !== lastWidth && zoomRef.current === 'fit') {
        lastWidth = scroller.clientWidth
        layout()
      }
    })
    resize.observe(scroller)
    relayout.current = layout

    void (async () => {
      const bytes = await window.api.readBinary(doc.path)
      if (cancelled) return
      task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true })
      const pdf = await task.promise
      if (cancelled) return void pdf.destroy()
      pdfRef.current = pdf

      // All pages get the size of the first one; others are corrected as they are read.
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
      for (let n = 1; n <= pdf.numPages; n++) {
        const el = document.createElement('div')
        el.className = 'pdf-page'
        el.dataset.page = String(n)
        pages.appendChild(el)
        slots.current.push({ n, el, width: first.width, height: first.height, drawn: null, task: null, layer: null, token: null })
      }
      layout()
      cb.current.onReady()

      // Outline (the PDF's bookmarks).
      const outline = (await pdf.getOutline().catch(() => null)) ?? []
      const items: OutlineItem[] = []
      const at: { page: number; y: number }[] = []
      const walk = async (list: typeof outline, level: number): Promise<void> => {
        for (const item of list) {
          let page = 1
          let y = 0
          try {
            const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
            if (Array.isArray(dest) && dest[0] != null) {
              page = (typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])) + 1
              const slot = slots.current[page - 1]
              if ((dest[1] as { name?: string })?.name === 'XYZ' && typeof dest[3] === 'number' && slot) y = Math.max(0, slot.height - dest[3])
            }
          } catch {
            // a broken bookmark still shows, it just goes to the first page
          }
          items.push({ level: Math.min(level, 4), text: item.title })
          at.push({ page, y })
          if (item.items?.length) await walk(item.items, level + 1)
        }
      }
      await walk(outline, 1)
      if (cancelled) return
      outlineAt.current = at
      cb.current.onOutline(items)

      // Page sizes that differ from the first page.
      let changed = false
      for (let n = 2; n <= pdf.numPages && !cancelled; n++) {
        const v = (await pdf.getPage(n)).getViewport({ scale: 1 })
        const slot = slots.current[n - 1]
        if (Math.abs(v.width - slot.width) > 1 || Math.abs(v.height - slot.height) > 1) {
          slot.width = v.width
          slot.height = v.height
          changed = true
        }
      }
      if (changed && !cancelled) layout()
      if (!cancelled) void loadAllTexts()
    })().catch((err) => cb.current.onError(err))

    return () => {
      cancelled = true
      scroller.removeEventListener('scroll', onScroll)
      resize.disconnect()
      clearTimeout(scrollTimer)
      slots.current.forEach(drop)
      slots.current = []
      const pdf = pdfRef.current
      pdfRef.current = null
      void pdf?.destroy()
      void task?.destroy()
      anchoring.showFind(document, [], 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, doc.mtime])

  // Zoom changes.
  useEffect(() => {
    saveLocal('pdf-zoom', zoom)
    relayout.current()
  }, [zoom])

  // Selecting text shows the highlight toolbar; clicking a highlight opens its note.
  useEffect(() => {
    const el = pagesRef.current!
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const mark = (e.target as HTMLElement).closest('mark[data-sd-ann]')
      const sel = getSelection()
      if (mark && (!sel || sel.isCollapsed)) {
        cb.current.onAnnotationClick(mark.getAttribute('data-sd-ann')!, mark.getBoundingClientRect())
        return
      }
      setTimeout(() => {
        const s = getSelection()
        if (!s || s.isCollapsed || !s.rangeCount) return cb.current.onSelection(null)
        const range = s.getRangeAt(0)
        const page = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>('.pdf-page')
        // One page at a time: a highlight belongs to one page.
        if (!page || page !== range.endContainer.parentElement?.closest('.pdf-page')) return cb.current.onSelection(null)
        const layer = page.querySelector('.textLayer')
        const info = layer && anchoring.selectionInfo(layer, s)
        if (!info) return cb.current.onSelection(null)
        cb.current.onSelection({ quote: info.quote, prefix: info.prefix, suffix: info.suffix, rect: info.rect, page: Number(page.dataset.page) })
      }, 0)
    }
    el.addEventListener('mouseup', onMouseUp)
    return () => el.removeEventListener('mouseup', onMouseUp)
  }, [])

  useImperativeHandle(ref, () => ({
    gotoHeading: (index) => {
      const at = outlineAt.current[index]
      if (at) void scrollToPage(at.page, at.y)
    },
    restoreScroll: (y) => {
      if (scrollRef.current) scrollRef.current.scrollTop = y * scale.current
      drawVisible()
    },
    collectChanges: async () => ({ kind: 'none' }),
    setAnnotations: (items) => {
      annotations.current = items
      for (const slot of slots.current) drawAnnotations(slot)
      reportMissing()
    },
    gotoAnnotation: (id) => {
      const a = annotations.current.find((x) => x.id === id)
      if (!a?.page) return
      void scrollToPage(a.page).then((slot) => {
        const mark = slot?.layer?.querySelector<HTMLElement>(`mark[data-sd-ann="${CSS.escape(id)}"]`)
        if (!mark) return
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        mark.animate([{ outline: '3px solid var(--accent)' }, { outline: '3px solid transparent' }], { duration: 1400 })
      })
    },
    clearSelection: () => getSelection()?.removeAllRanges(),
    find: async (query) => {
      foundQuery.current = query
      await loadAllTexts()
      if (foundQuery.current !== query) return { index: 0, total: 0 }
      const matches: { page: number; k: number }[] = []
      texts.current.forEach((text, i) => {
        const n = text ? countMatches(text, query) : 0
        for (let k = 0; k < n; k++) matches.push({ page: i + 1, k })
      })
      found.current = matches
      // Start from the page you are reading.
      const here = currentPage()
      const next = matches.findIndex((m) => m.page >= here)
      foundIndex.current = next >= 0 ? next : 0
      return gotoFound()
    },
    findStep: async (dir) => {
      const n = found.current.length
      if (n) foundIndex.current = (foundIndex.current + dir + n) % n
      return gotoFound()
    },
    clearFind: () => {
      foundQuery.current = ''
      found.current = []
      anchoring.showFind(document, [], 0)
    }
  }))

  const zoomStep = (dir: 1 | -1): void => {
    const now = scale.current
    const next = dir > 0 ? ZOOMS.find((z) => z > now + 0.01) : [...ZOOMS].reverse().find((z) => z < now - 0.01)
    if (next) setZoom(next)
  }

  return (
    <div className="pdf-view">
      <div className="pdf-scroll" ref={scrollRef} tabIndex={0}>
        <div className="pdf-pages" ref={pagesRef} />
      </div>
      <div className="pdf-zoom" role="toolbar" aria-label={t('Thu phóng')}>
        <button className="icon-btn" title={t('Thu nhỏ')} onClick={() => zoomStep(-1)}>
          −
        </button>
        <span className="pdf-zoom-value">{Math.round(shownScale * 100)}%</span>
        <button className="icon-btn" title={t('Phóng to')} onClick={() => zoomStep(1)}>
          +
        </button>
        <button className={`btn small ${zoom === 'fit' ? 'active' : ''}`} title={t('Vừa chiều ngang')} onClick={() => setZoom('fit')}>{t('Vừa khung')}</button>
      </div>
    </div>
  )
})

export default PdfView
