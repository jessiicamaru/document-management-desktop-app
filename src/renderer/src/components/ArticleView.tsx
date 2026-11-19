// Read-only documents shown as a page of text: plain text (.txt) and Word (.docx). Same reading
// features as the other views: outline (Word headings), reading position, Ctrl+F, highlights
// and notes. The file is never changed.
//
// Word has two views:
//  - "Bố cục Word" (default): docx-preview lays the document out in pages, with its fonts,
//    colours, table borders, alignment, headers and footers. It is drawn inside an iframe
//    that can't run scripts or load anything from the internet, so the CSS a .docx brings
//    stays in there and can't restyle the app (review: Word layout).
//  - "Xem đơn giản": mammoth keeps only the text and its structure, as a reading page.
// If docx-preview can't draw a file, the simple view is used instead.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Annotation, DocEntry } from '../../../shared/types'
import { createAnchoring } from '../../../shared/anchor'
import { decodeText } from '../../../shared/text'
import { loadLocal, saveLocal } from '../lib/docs'
import type { FindResult, ReaderCallbacks, ReaderHandle, ScreenRect } from './reader'
import { t } from '../../../shared/i18n'

const anchoring = createAnchoring()

/** Text files bigger than this (logs...) are shown in part, so the window stays responsive. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024

interface Props extends ReaderCallbacks {
  doc: DocEntry
  onError: (err: unknown) => void
}

type WordView = 'layout' | 'simple'
type Content = { mode: 'html'; html: string; note?: string } | { mode: 'layout'; bytes: Uint8Array }

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/**
 * The page the Word layout is drawn into. No scripts can run (sandbox without allow-scripts);
 * same origin only so the app can draw into it and find highlights there. Nothing can be
 * loaded from outside (CSP): pictures and fonts of the file are data:/blob: URLs.
 */
const FRAME_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:">
<style>
html, body { margin: 0; background: #525659; }
body { overflow-y: hidden; overflow-x: auto; }
.docx-wrapper { background: #525659 !important; padding: 24px 16px 4px !important; }
.docx-wrapper > section.docx { box-shadow: 0 1px 4px rgba(0, 0, 0, .35); margin-bottom: 20px !important; color: #000; }
::selection { background: rgba(0, 90, 255, .28); }
</style></head><body><div id="sd-styles"></div><div id="sd-body"></div></body></html>`

/** What to show for the document. */
async function load(doc: DocEntry, view: WordView): Promise<Content> {
  const bytes = await window.api.readBinary(doc.path)
  if (doc.kind === 'txt') {
    const cut = bytes.length > MAX_TEXT_BYTES
    const text = decodeText(cut ? bytes.subarray(0, MAX_TEXT_BYTES) : bytes)
    return {
      mode: 'html',
      html: `<pre class="plain-text">${escapeHtml(text)}</pre>`,
      note: cut ? t('File lớn: chỉ hiện {0} MB đầu. Mở bằng app mặc định để xem hết.', { 0: MAX_TEXT_BYTES / 1024 / 1024 }) : undefined
    }
  }
  if (view === 'layout') return { mode: 'layout', bytes }
  return { mode: 'html', html: await simpleWordHtml(bytes) }
}

/** Word as a simple reading page: headings, lists, tables, bold/italic, links, images. */
async function simpleWordHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: arrayBufferOf(bytes) })
  return DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } })
}

/** Word laid out in pages (docx-preview). Embedded HTML ("alt chunks") and comments are not drawn. */
async function drawWordLayout(bytes: Uint8Array, body: HTMLElement, styles: HTMLElement): Promise<void> {
  const { renderAsync } = await import('docx-preview')
  await renderAsync(new Blob([arrayBufferOf(bytes)]), body, styles, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderChanges: false,
    renderAltChunks: false,
    useBase64URL: true, // pictures as data: URLs, nothing to free afterwards
    experimental: false
  })
}

const ArticleView = forwardRef<ReaderHandle, Props>(function ArticleView(props, ref) {
  const { doc } = props
  const cb = useRef(props)
  cb.current = props
  const scrollRef = useRef<HTMLDivElement>(null)
  /** The element holding the text: the article, or the body of the Word layout frame. */
  const articleRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameDoc, setFrameDoc] = useState<Document | null>(null)
  const headings = useRef<HTMLElement[]>([])
  const annotations = useRef<Annotation[]>([])
  const [content, setContent] = useState<Content | null>(null)
  const [wordView, setWordView] = useState<WordView>(() => loadLocal<WordView>('word-view', 'layout'))
  /** docx-preview couldn't draw this file: the simple view is shown instead. */
  const [layoutFailed, setLayoutFailed] = useState(false)
  const view: WordView = layoutFailed ? 'simple' : wordView

  useEffect(() => {
    let alive = true
    setContent(null)
    setFrameDoc(null)
    load(doc, view)
      .then((c) => alive && setContent(c))
      .catch((err) => alive && cb.current.onError(err))
    return () => {
      alive = false
    }
  }, [doc.path, doc.mtime, doc.kind, view])
  useEffect(() => setLayoutFailed(false), [doc.path, doc.mtime])

  /** A rectangle inside the frame, in app window coordinates. */
  function toApp(r: ScreenRect, node: Node): ScreenRect {
    if (node.ownerDocument === document || !frameRef.current) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    const f = frameRef.current.getBoundingClientRect()
    return { left: r.left + f.left, top: r.top + f.top, right: r.right + f.left, bottom: r.bottom + f.top }
  }

  function drawAnnotations(): void {
    const el = articleRef.current
    if (el) cb.current.onAnchored(anchoring.apply(el, annotations.current))
  }

  function reportScroll(): void {
    const scroller = scrollRef.current
    if (!scroller) return
    const top = scroller.getBoundingClientRect().top
    let active = -1
    for (let i = 0; i < headings.current.length; i++) {
      const h = headings.current[i]
      if (toApp(h.getBoundingClientRect(), h).top - top <= 90) active = i
      else break
    }
    cb.current.onReading(Math.round(scroller.scrollTop), active)
  }

  // Draw (Word layout, once its frame is ready), then: links open in the browser, outline
  // from the headings, highlights.
  useEffect(() => {
    if (!content) return
    if (content.mode === 'layout' && !frameDoc) return
    const el = content.mode === 'layout' ? frameDoc!.getElementById('sd-body') : articleRef.current
    if (!el) return
    articleRef.current = el
    let alive = true
    let stopResize: (() => void) | undefined
    void (async () => {
      if (content.mode === 'layout') {
        try {
          await drawWordLayout(content.bytes, el, frameDoc!.getElementById('sd-styles')!)
        } catch (err) {
          console.warn('Word layout failed, using the simple view', err)
          if (alive) setLayoutFailed(true)
          return
        }
        // The frame is as tall as the pages, so the view scrolls as one page with the bar above.
        const frame = frameRef.current
        const win = frameDoc!.defaultView as (Window & typeof globalThis) | null
        if (frame && win) {
          const fit = (): void => void (frame.style.height = `${frameDoc!.documentElement.scrollHeight}px`)
          const ro = new win.ResizeObserver(fit)
          ro.observe(frameDoc!.body)
          fit()
          stopResize = () => ro.disconnect()
        }
      }
      if (!alive) return
      el.querySelectorAll('a[href]').forEach((a) => {
        if (!/^https?:/i.test(a.getAttribute('href') ?? '')) a.removeAttribute('href') // Word bookmarks, odd links
      })
      headings.current =
        content.mode === 'layout'
          ? [...el.querySelectorAll<HTMLElement>('p[class*="docx_heading"], p[class*="docx_title"]')].filter((h) => h.textContent?.trim())
          : [...el.querySelectorAll<HTMLElement>('h1, h2, h3')]
      const levelOf = (h: HTMLElement): number => {
        if (/^H\d$/.test(h.tagName)) return Number(h.tagName[1])
        const n = /docx_heading(\d)/.exec(h.className)?.[1]
        return n ? Math.min(Number(n), 3) : 1
      }
      cb.current.onOutline(headings.current.map((h) => ({ level: levelOf(h), text: (h.textContent ?? '').trim() })))
      cb.current.onReady()
      reportScroll()
      drawAnnotations()
    })()
    return () => {
      alive = false
      stopResize?.()
    }
  }, [content, frameDoc])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const onScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(reportScroll)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  // Selecting text shows the highlight toolbar; clicking a highlight opens its note. In the
  // Word frame, app shortcuts (Ctrl+F, Ctrl+K, Alt+←...) are passed on to the app.
  useEffect(() => {
    const el = content?.mode === 'layout' ? frameDoc?.getElementById('sd-body') : articleRef.current
    if (!el) return
    const win = el.ownerDocument.defaultView!
    const selection = (): Selection | null => win.getSelection()
    const info = () => {
      const i = anchoring.selectionInfo(el, selection())
      return i && { ...i, rect: toApp(i.rect, el) }
    }
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const mark = (e.target as HTMLElement).closest('mark[data-sd-ann]')
      const sel = selection()
      if (mark && (!sel || sel.isCollapsed)) {
        cb.current.onAnnotationClick(mark.getAttribute('data-sd-ann')!, toApp(mark.getBoundingClientRect(), mark))
        return
      }
      setTimeout(() => cb.current.onSelection(info()), 0)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.shiftKey) cb.current.onSelection(info())
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (el.ownerDocument === document || !(e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape')) return
      const copy = new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, bubbles: true, cancelable: true })
      window.dispatchEvent(copy)
      if (copy.defaultPrevented) e.preventDefault()
    }
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('keyup', onKeyUp)
    el.ownerDocument.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('keyup', onKeyUp)
      el.ownerDocument.removeEventListener('keydown', onKeyDown)
    }
  }, [content?.mode, frameDoc])

  // ---------- find (Ctrl+F) ----------
  const found = useRef<Range[]>([])
  const foundIndex = useRef(0)
  const findDoc = (): Document => articleRef.current?.ownerDocument ?? document
  function showFound(): FindResult {
    anchoring.showFind(findDoc(), found.current, foundIndex.current)
    const current = found.current[foundIndex.current]
    const scroller = scrollRef.current
    if (current && scroller) {
      const r = toApp(current.getBoundingClientRect(), current.startContainer)
      const box = scroller.getBoundingClientRect()
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) scroller.scrollTop += r.top - box.top - scroller.clientHeight / 3
      // Long lines in plain text (or wide Word pages) scroll sideways too.
      if (r.left < box.left || r.right > box.right) current.startContainer.parentElement?.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
    return { index: foundIndex.current, total: found.current.length }
  }
  useEffect(() => () => anchoring.showFind(document, [], 0), [])

  useImperativeHandle(ref, () => ({
    gotoHeading: (index) => headings.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    restoreScroll: (y) => {
      if (scrollRef.current) scrollRef.current.scrollTop = y
    },
    collectChanges: async () => ({ kind: 'none' }),
    setAnnotations: (items) => {
      annotations.current = items
      drawAnnotations()
    },
    gotoAnnotation: (id) => {
      const mark = articleRef.current?.querySelector<HTMLElement>(`mark[data-sd-ann="${CSS.escape(id)}"]`)
      if (!mark) return
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      mark.animate([{ outline: '3px solid #b4531f' }, { outline: '3px solid transparent' }], { duration: 1400 })
    },
    clearSelection: () => articleRef.current?.ownerDocument.defaultView?.getSelection()?.removeAllRanges(),
    find: async (query) => {
      found.current = articleRef.current ? anchoring.findAll(articleRef.current, query) : []
      foundIndex.current = 0
      return showFound()
    },
    findStep: async (dir) => {
      const n = found.current.length
      if (n) foundIndex.current = (foundIndex.current + dir + n) % n
      return showFound()
    },
    clearFind: () => {
      found.current = []
      anchoring.showFind(findDoc(), [], 0)
    }
  }))

  const chooseView = (next: WordView): void => {
    saveLocal('word-view', next)
    setLayoutFailed(false)
    setWordView(next)
  }

  return (
    <div className="md-scroll" ref={scrollRef}>
      {content?.mode === 'html' && content.note && <div className="article-note">{content.note}</div>}
      {doc.kind === 'docx' && (
        <div className="article-note docx-note">
          <div className="segmented plain" role="group" aria-label={t('Cách hiện file Word')}>
            <button className={view === 'layout' ? 'active' : ''} onClick={() => chooseView('layout')}>
              {t('Bố cục Word')}
            </button>
            <button className={view === 'simple' ? 'active' : ''} onClick={() => chooseView('simple')}>
              {t('Xem đơn giản')}
            </button>
          </div>
          <span>
            {layoutFailed
              ? t('Không dựng được bố cục của file này, đang hiện bản đơn giản.')
              : view === 'layout'
                ? t('Gần giống Word: phông, màu, bảng, căn lề, đầu/chân trang. Một số thứ (hộp văn bản, hình vẽ) có thể lệch.')
                : t('Chỉ hiện chữ, tiêu đề, danh sách, bảng và ảnh. Bố cục, màu, khung và căn lề của Word không được giữ.')}
          </span>
          <button className="btn small" onClick={() => window.api.openPath(doc.path).catch(cb.current.onError)}>
            {t('Mở bằng Word')}
          </button>
        </div>
      )}
      {content?.mode === 'layout' ? (
        <iframe
          key="layout"
          ref={frameRef}
          className="docx-frame"
          title={doc.title}
          sandbox="allow-same-origin"
          srcDoc={FRAME_HTML}
          onLoad={(e) => setFrameDoc(e.currentTarget.contentDocument)}
        />
      ) : (
        <article
          key="html"
          ref={(node) => void (articleRef.current = node)}
          className={`markdown article-${doc.kind}`}
          dangerouslySetInnerHTML={{ __html: content?.mode === 'html' ? content.html : '' }}
        />
      )}
    </div>
  )
})

export default ArticleView
