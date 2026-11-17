// EPUB books, shown with epub.js.
//
// The book is read as bytes through window.api (no network), unzipped in memory by epub.js,
// and each chapter is shown in an iframe. Book scripts never run (the app's CSP blocks them).
// Books are read page by page, like a real book: buttons, ←/→, PageUp/PageDown or the
// mouse wheel turn the page; a wide window shows two pages side by side. The reading
// position is remembered as an EPUB CFI (an exact position in the book), highlights too.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import ePub from 'epubjs'
import type { Annotation, DocEntry } from '../../../shared/types'
import { loadLocal, saveLocal } from '../lib/docs'
import { generateLocations } from '../lib/epub-locations'
import { HIGHLIGHT_COLORS } from './Annotations'
import type { FindResult, ReaderCallbacks, ReaderHandle } from './reader'

type Book = ReturnType<typeof ePub>
type Rendition = ReturnType<Book['renderTo']>
/** The part of epub.js's spine item (Section) used for searching the book. */
interface SpineItem {
  load(request: unknown): Promise<unknown>
  unload(): void
  find(query: string): { cfi: string; excerpt: string }[]
}

interface TocEntry {
  href: string
  label: string
  level: number
}

interface Props extends ReaderCallbacks {
  doc: DocEntry
  onError: (err: unknown) => void
}

const positionKey = (path: string): string => `epubpos:${path}`
const locationsKey = (doc: DocEntry): string => `epubloc:${doc.path}:${doc.mtime}`

/** Joins a path relative to `base` (a file path inside the book), handling "../". */
function resolveIn(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1)
  for (const p of href.split('/')) {
    if (p === '..') parts.pop()
    else if (p !== '.' && p !== '') parts.push(p)
  }
  return parts.join('/')
}

/**
 * epub.js turns a range that starts or ends on an element (double-clicking a bold word,
 * triple-clicking a paragraph) into a one-character highlight. Move both ends into text nodes.
 */
function toTextRange(range: Range): Range {
  const doc = range.startContainer.ownerDocument!
  const r = range.cloneRange()
  const texts = (root: Node): TreeWalker => doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  if (r.startContainer.nodeType !== Node.TEXT_NODE) {
    const node = r.startContainer.childNodes[r.startOffset] ?? r.startContainer
    const w = texts(doc.body)
    w.currentNode = node
    const first = node.nodeType === Node.TEXT_NODE ? node : w.nextNode()
    if (first) r.setStart(first, 0)
  }
  if (r.endContainer.nodeType !== Node.TEXT_NODE) {
    // The node just before the end boundary: its last text node is where the selection ends.
    const before = r.endContainer.childNodes[r.endOffset - 1]
    let last: Node | null = null
    if (before?.nodeType === Node.TEXT_NODE) last = before
    else if (before) {
      const w = texts(before)
      for (let n = w.nextNode(); n; n = w.nextNode()) last = n
    }
    if (!last) {
      // Nothing before the boundary inside that element: use the text just before the element.
      const w = texts(doc.body)
      w.currentNode = r.endContainer
      last = w.previousNode()
    }
    if (last) r.setEnd(last, (last as Text).data.length)
  }
  return r
}
const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Colours and reading font follow the app (Settings > Đọc Markdown, light/dark). */
function applyTheme(rendition: Rendition): void {
  rendition.themes.override('color', css('--ink'))
  rendition.themes.override('background', css('--paper'))
  rendition.themes.override('font-family', css('--read-font') || 'inherit')
  rendition.themes.fontSize(css('--read-size') || '16px')
}

const EpubView = forwardRef<ReaderHandle, Props>(function EpubView(props, ref) {
  const { doc } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const rendition = useRef<Rendition | null>(null)
  const toc = useRef<TocEntry[]>([])
  const annotations = useRef<Annotation[]>([])
  const drawn = useRef<string[]>([])
  const bookRef = useRef<Book | null>(null)
  const [progress, setProgress] = useState<{ chapter: string; percent: number | null }>({ chapter: '', percent: null })
  const cb = useRef(props)
  cb.current = props

  // Ctrl+F results: positions (CFI) of every match in the book; the current one is marked.
  const found = useRef<string[]>([])
  const foundIndex = useRef(0)
  const foundMark = useRef<string | null>(null)
  const clearFoundMark = (): void => {
    if (foundMark.current) rendition.current?.annotations.remove(foundMark.current, 'highlight')
    foundMark.current = null
  }
  const gotoFound = async (): Promise<FindResult> => {
    clearFoundMark()
    const cfi = found.current[foundIndex.current]
    if (cfi && rendition.current) {
      await rendition.current.display(cfi)
      rendition.current.annotations.highlight(cfi, {}, () => {}, 'sd-epub-find', { fill: '#f97316', 'fill-opacity': '0.5' })
      foundMark.current = cfi
    }
    return { index: foundIndex.current, total: found.current.length }
  }

  const next = (): void => void rendition.current?.next()
  const prev = (): void => void rendition.current?.prev()

  /**
   * Outline links are written relative to the book's navigation file, which is often in
   * its own folder (e.g. Nav/toc.xhtml -> "../Text/ch5.xhtml"); epub.js expects them
   * relative to the package. Find the chapter it means.
   */
  const chapterHref = (href: string): string => {
    const book = bookRef.current
    if (!book) return href
    const [file, hash] = href.split('#')
    const navFile = (book.packaging as unknown as { navPath?: string; ncxPath?: string }).navPath ||
      (book.packaging as unknown as { ncxPath?: string }).ncxPath || ''
    const spine = book.spine as unknown as { get(target: string): { href: string } | null; spineItems: { href: string }[] }
    const candidates = [file, resolveIn(navFile, file)]
    let item = candidates.map((c) => spine.get(c)).find(Boolean) ?? null
    if (!item) {
      const name = file.split('/').pop()!
      item = spine.spineItems.find((it) => it.href === resolveIn(navFile, file) || it.href.split('/').pop() === name) ?? null
    }
    return item ? item.href + (hash ? `#${hash}` : '') : href
  }

  /** Replaces the highlights drawn in the book. */
  const draw = (): void => {
    const r = rendition.current
    if (!r) return
    for (const cfi of drawn.current) r.annotations.remove(cfi, 'highlight')
    drawn.current = []
    const missing: string[] = []
    for (const a of annotations.current) {
      if (!a.cfi) {
        missing.push(a.id)
        continue
      }
      try {
        const fill = HIGHLIGHT_COLORS.find((c) => c.id === a.color)?.css ?? '#facc15'
        r.annotations.highlight(
          a.cfi,
          { id: a.id },
          (e: MouseEvent) => cb.current.onAnnotationClick(a.id, (e.target as Element).getBoundingClientRect()),
          'sd-epub-hl',
          { fill, 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply' }
        )
        drawn.current.push(a.cfi)
      } catch {
        missing.push(a.id)
      }
    }
    cb.current.onAnchored(missing)
  }

  useEffect(() => {
    let book: Book | null = null
    let cancelled = false
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = (): void => {
      if (rendition.current) applyTheme(rendition.current)
    }

    // Mouse wheel turns the page (at most one page per 350 ms, so one flick = one page).
    let lastWheel = 0
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < 4 || Date.now() - lastWheel < 350) return
      lastWheel = Date.now()
      if (e.deltaY > 0) next()
      else prev()
    }
    hostRef.current!.addEventListener('wheel', onWheel, { passive: true })
    // Keys when the focus is in the app rather than in the book.
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
    }
    window.addEventListener('keydown', onKey)
    // Re-layout the pages when the window or the side panel changes size.
    const resize = new ResizeObserver(() => {
      const host = hostRef.current
      // The view manager only exists once the book has opened; earlier size changes are picked up by display().
      const r = rendition.current as unknown as { manager?: unknown; resize: (w: number, h: number) => void } | null
      if (host && r?.manager) r.resize(host.clientWidth, host.clientHeight)
    })
    resize.observe(hostRef.current!)

    void (async () => {
      const bytes = await window.api.readBinary(doc.path)
      if (cancelled) return
      book = ePub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      bookRef.current = book
      const r = book.renderTo(hostRef.current!, {
        width: '100%',
        height: '100%',
        flow: 'paginated',
        spread: 'auto',
        minSpreadWidth: 1100, // two pages side by side when there is room
        allowScriptedContent: false
      })
      rendition.current = r
      applyTheme(r)
      darkQuery.addEventListener('change', onScheme)

      // Chapters list -> outline panel.
      const nav = await book.loaded.navigation
      const flatten = (items: { href: string; label: string; subitems?: unknown[] }[], level: number): TocEntry[] =>
        items.flatMap((it) => [
          { href: it.href, label: it.label.trim(), level },
          ...flatten((it.subitems ?? []) as { href: string; label: string }[], level + 1)
        ])
      toc.current = flatten(nav.toc, 1).map((t) => ({ ...t, href: chapterHref(t.href) }))
      cb.current.onOutline(toc.current.map((t) => ({ level: Math.min(t.level, 3), text: t.label })))

      // Where you are: remember the position, highlight the current chapter in the outline.
      r.on('relocated', (location: { start: { cfi: string; href: string; percentage?: number } }) => {
        saveLocal(positionKey(doc.path), location.start.cfi)
        // The last outline entry in this chapter that starts at or before here.
        let active = -1
        toc.current.forEach((t, i) => {
          if (t.href.split('#')[0] === location.start.href) active = active < 0 ? i : active
        })
        cb.current.onReading(0, active)
        const ready = (book?.locations as unknown as { length(): number } | undefined)?.length() ?? 0
        setProgress({
          chapter: active >= 0 ? toc.current[active].label : '',
          percent: ready ? Math.round((book!.locations.percentageFromCfi(location.start.cfi) ?? 0) * 100) : null
        })
      })
      // Turning pages with the keyboard / mouse wheel while the book has the focus.
      r.on('keyup', (e: KeyboardEvent) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return
        if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
      })
      // Selecting text -> highlight toolbar.
      r.on('selected', (_cfi: string, contents: { window: Window; document: Document; cfiFromRange(range: Range): string }) => {
        const selected = contents.window.getSelection()
        if (!selected?.rangeCount) return
        const range = toTextRange(selected.getRangeAt(0))
        const cfiRange = contents.cfiFromRange(range)
        const quote = range.toString()
        if (!quote.trim()) return
        const frame = contents.document.defaultView?.frameElement?.getBoundingClientRect()
        const rr = range.getBoundingClientRect()
        const dx = frame?.left ?? 0
        const dy = frame?.top ?? 0
        cb.current.onSelection({
          quote,
          prefix: '',
          suffix: '',
          cfi: cfiRange,
          rect: { left: rr.left + dx, right: rr.right + dx, top: rr.top + dy, bottom: rr.bottom + dy }
        })
      })
      // Inside each chapter: clicking clears the toolbar; app shortcuts still work.
      r.hooks.content.register((contents: { document: Document }) => {
        contents.document.addEventListener('mousedown', () => cb.current.onSelection(null))
        contents.document.addEventListener('scroll', () => cb.current.onSelection(null), true)
        contents.document.addEventListener('wheel', onWheel, { passive: true })
        // Ctrl+F inside the book opens the app's find bar.
        contents.document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault()
            window.dispatchEvent(new Event('studydocs:find'))
          }
        })
      })
      r.on('rendered', () => draw())

      await r.display(loadLocal<string | null>(positionKey(doc.path), null) ?? undefined)
      if (cancelled) return
      draw()
      cb.current.onReady()

      // "% read" needs the book split into locations: cached per book version, else computed
      // in the background (a few seconds for a big book) without blocking reading.
      const saved = loadLocal<string | null>(locationsKey(doc), null)
      if (saved) book.locations.load(saved)
      else {
        // Computed in small slices so turning pages stays smooth meanwhile (issue #13).
        const locations = await generateLocations(book as unknown as Parameters<typeof generateLocations>[0], 1600, () => cancelled)
        if (!locations || cancelled) return
        book.locations.load(locations as unknown as string)
        saveLocal(locationsKey(doc), book.locations.save())
      }
      const loc = r.currentLocation() as unknown as { start?: { cfi: string } }
      if (loc?.start) setProgress((p) => ({ ...p, percent: Math.round((book!.locations.percentageFromCfi(loc.start!.cfi) ?? 0) * 100) }))
    })().catch((err) => cb.current.onError(err))

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      resize.disconnect()
      darkQuery.removeEventListener('change', onScheme)
      rendition.current?.destroy()
      rendition.current = null
      drawn.current = []
      bookRef.current = null
      book?.destroy()
    }
  }, [doc.path, doc.mtime])

  useImperativeHandle(ref, () => ({
    gotoHeading: (index) => {
      const href = toc.current[index]?.href
      if (href) rendition.current?.display(href).catch((err: unknown) => cb.current.onError(err))
    },
    restoreScroll: () => {}, // the position is restored from the saved CFI when the book opens
    collectChanges: async () => ({ kind: 'none' }),
    setAnnotations: (items) => {
      annotations.current = items
      draw()
    },
    gotoAnnotation: (id) => {
      const cfi = annotations.current.find((a) => a.id === id)?.cfi
      if (cfi) void rendition.current?.display(cfi)
    },
    clearSelection: () => {
      const contents = rendition.current?.getContents() as unknown as { window: Window }[] | undefined
      for (const c of contents ?? []) c.window.getSelection()?.removeAllRanges()
    },
    // Ctrl+F searches the whole book, chapter by chapter (epub.js Section.find).
    find: async (query) => {
      clearFoundMark()
      found.current = []
      const book = bookRef.current
      if (!book || !query.trim()) return { index: 0, total: 0 }
      const spine = book.spine as unknown as { spineItems: SpineItem[] }
      for (const item of spine.spineItems) {
        await item.load(book.load.bind(book))
        found.current.push(...item.find(query.trim()).map((m) => m.cfi))
        item.unload()
      }
      foundIndex.current = 0
      return gotoFound()
    },
    findStep: async (dir) => {
      const n = found.current.length
      if (n) foundIndex.current = (foundIndex.current + dir + n) % n
      return gotoFound()
    },
    clearFind: () => {
      clearFoundMark()
      found.current = []
    }
  }))

  return (
    <div className="epub-view">
      <div ref={hostRef} className="epub-host" />
      <div className="epub-bar">
        <button className="icon-btn" title="Trang trước (←)" onClick={prev}>
          ‹
        </button>
        <span className="epub-progress" title={progress.chapter}>
          {progress.chapter}
          {progress.percent !== null && <b>{progress.percent}%</b>}
        </span>
        <button className="icon-btn" title="Trang sau (→)" onClick={next}>
          ›
        </button>
      </div>
    </div>
  )
})

export default EpubView
