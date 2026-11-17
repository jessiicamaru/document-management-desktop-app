// EPUB books, shown with epub.js.
//
// The book is read as bytes through window.api (no network), unzipped in memory by epub.js,
// and each chapter is shown in an iframe. Book scripts never run (the app's CSP blocks them).
// Chapters scroll vertically like the other documents. The reading position is remembered
// as an EPUB CFI (an exact position in the book), highlights too.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import ePub from 'epubjs'
import type { Annotation, DocEntry } from '../../../shared/types'
import { loadLocal, saveLocal } from '../lib/docs'
import { HIGHLIGHT_COLORS } from './Annotations'
import type { ReaderCallbacks, ReaderHandle } from './reader'

type Book = ReturnType<typeof ePub>
type Rendition = ReturnType<Book['renderTo']>

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
  const cb = useRef(props)
  cb.current = props

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

    void (async () => {
      const bytes = await window.api.readBinary(doc.path)
      if (cancelled) return
      book = ePub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      const r = book.renderTo(hostRef.current!, { width: '100%', height: '100%', flow: 'scrolled-doc', allowScriptedContent: false })
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
      toc.current = flatten(nav.toc, 1)
      cb.current.onOutline(toc.current.map((t) => ({ level: Math.min(t.level, 3), text: t.label })))

      // Where you are: remember the position, highlight the current chapter in the outline.
      r.on('relocated', (location: { start: { cfi: string; href: string } }) => {
        saveLocal(positionKey(doc.path), location.start.cfi)
        const active = toc.current.findIndex((t) => t.href.split('#')[0] === location.start.href)
        cb.current.onReading(0, active)
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
      })
      r.on('rendered', () => draw())

      await r.display(loadLocal<string | null>(positionKey(doc.path), null) ?? undefined)
      if (cancelled) return
      draw()
      cb.current.onReady()
    })().catch((err) => cb.current.onError(err))

    return () => {
      cancelled = true
      darkQuery.removeEventListener('change', onScheme)
      rendition.current?.destroy()
      rendition.current = null
      drawn.current = []
      book?.destroy()
    }
  }, [doc.path, doc.mtime])

  useImperativeHandle(ref, () => ({
    gotoHeading: (index) => void rendition.current?.display(toc.current[index]?.href),
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
    }
  }))

  return <div ref={hostRef} className="epub-host" />
})

export default EpubView
