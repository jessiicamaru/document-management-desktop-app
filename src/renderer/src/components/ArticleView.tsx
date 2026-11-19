// Read-only documents shown as a page of text: plain text (.txt) and Word (.docx). Same reading
// features as the other views: outline (Word headings), reading position, Ctrl+F, highlights
// and notes. The file is never changed.
//
// Word has two views:
//  - "Bố cục Word" (default): docx-preview lays the document out in pages, with its fonts,
//    colours, table borders, alignment, headers and footers.
//  - "Xem đơn giản": mammoth keeps only the text and its structure, as a reading page.
// If docx-preview can't draw a file, the simple view is used instead.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Annotation, DocEntry } from '../../../shared/types'
import { createAnchoring } from '../../../shared/anchor'
import { decodeText } from '../../../shared/text'
import { loadLocal, saveLocal } from '../lib/docs'
import type { FindResult, ReaderCallbacks, ReaderHandle } from './reader'
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
  const articleRef = useRef<HTMLElement>(null)
  const stylesRef = useRef<HTMLDivElement>(null)
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
    load(doc, view)
      .then((c) => alive && setContent(c))
      .catch((err) => alive && cb.current.onError(err))
    return () => {
      alive = false
    }
  }, [doc.path, doc.mtime, doc.kind, view])
  useEffect(() => setLayoutFailed(false), [doc.path, doc.mtime])

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
      if (headings.current[i].getBoundingClientRect().top - top <= 90) active = i
      else break
    }
    cb.current.onReading(Math.round(scroller.scrollTop), active)
  }

  // Draw (Word layout), then: links open in the browser, outline from the headings, highlights.
  useEffect(() => {
    const el = articleRef.current
    if (!el || !content) return
    let alive = true
    void (async () => {
      if (content.mode !== 'layout' && stylesRef.current) stylesRef.current.textContent = '' // styles of a Word layout shown before
      if (content.mode === 'layout') {
        try {
          await drawWordLayout(content.bytes, el, stylesRef.current!)
        } catch (err) {
          console.warn('Word layout failed, using the simple view', err)
          if (alive) setLayoutFailed(true)
          return
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
    }
  }, [content])

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

  // Selecting text shows the highlight toolbar; clicking a highlight opens its note.
  useEffect(() => {
    const el = articleRef.current
    if (!el) return
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0) return
      const mark = (e.target as HTMLElement).closest('mark[data-sd-ann]')
      const sel = getSelection()
      if (mark && (!sel || sel.isCollapsed)) {
        cb.current.onAnnotationClick(mark.getAttribute('data-sd-ann')!, mark.getBoundingClientRect())
        return
      }
      setTimeout(() => cb.current.onSelection(anchoring.selectionInfo(el, getSelection())), 0)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.shiftKey) cb.current.onSelection(anchoring.selectionInfo(el, getSelection()))
    }
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('keyup', onKeyUp)
    }
  }, [content?.mode])

  // ---------- find (Ctrl+F) ----------
  const found = useRef<Range[]>([])
  const foundIndex = useRef(0)
  function showFound(): FindResult {
    anchoring.showFind(document, found.current, foundIndex.current)
    const current = found.current[foundIndex.current]
    const scroller = scrollRef.current
    if (current && scroller) {
      const r = current.getBoundingClientRect()
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
      mark.animate([{ outline: '3px solid var(--accent)' }, { outline: '3px solid transparent' }], { duration: 1400 })
    },
    clearSelection: () => getSelection()?.removeAllRanges(),
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
      anchoring.showFind(document, [], 0)
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
      <div ref={stylesRef} className="docx-styles" />
      {content?.mode === 'layout' ? (
        <div key="layout" ref={articleRef as React.RefObject<HTMLDivElement>} className="docx-layout" />
      ) : (
        <article key="html" ref={articleRef} className={`markdown article-${doc.kind}`} dangerouslySetInnerHTML={{ __html: content?.mode === 'html' ? content.html : '' }} />
      )}
    </div>
  )
})

export default ArticleView
