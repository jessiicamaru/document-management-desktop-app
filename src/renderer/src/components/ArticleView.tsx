// Read-only documents shown as a page of text, like Markdown: plain text (.txt) and Word
// (.docx, turned into HTML by mammoth). Same reading features as the other views: outline
// (Word headings), reading position, Ctrl+F, highlights and notes. The file is never changed.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { Annotation, DocEntry } from '../../../shared/types'
import { createAnchoring } from '../../../shared/anchor'
import { decodeText } from '../../../shared/text'
import type { FindResult, ReaderCallbacks, ReaderHandle } from './reader'
import { t } from '../../../shared/i18n'

const anchoring = createAnchoring()

/** Text files bigger than this (logs...) are shown in part, so the window stays responsive. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024

interface Props extends ReaderCallbacks {
  doc: DocEntry
  onError: (err: unknown) => void
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The document as safe HTML for the article. */
async function loadHtml(doc: DocEntry): Promise<{ html: string; note?: string }> {
  const bytes = await window.api.readBinary(doc.path)
  if (doc.kind === 'txt') {
    const cut = bytes.length > MAX_TEXT_BYTES
    const text = decodeText(cut ? bytes.subarray(0, MAX_TEXT_BYTES) : bytes)
    return {
      html: `<pre class="plain-text">${escapeHtml(text)}</pre>`,
      note: cut ? t('File lớn: chỉ hiện {0} MB đầu. Mở bằng app mặc định để xem hết.', { 0: MAX_TEXT_BYTES / 1024 / 1024 }) : undefined
    }
  }
  // Word: headings, lists, tables, bold/italic, links and images (embedded as data: URLs).
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })
  return { html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }) }
}

const ArticleView = forwardRef<ReaderHandle, Props>(function ArticleView(props, ref) {
  const { doc } = props
  const cb = useRef(props)
  cb.current = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const headings = useRef<HTMLElement[]>([])
  const annotations = useRef<Annotation[]>([])
  const [content, setContent] = useState<{ html: string; note?: string } | null>(null)

  useEffect(() => {
    let alive = true
    setContent(null)
    loadHtml(doc)
      .then((c) => alive && setContent(c))
      .catch((err) => alive && cb.current.onError(err))
    return () => {
      alive = false
    }
  }, [doc.path, doc.mtime, doc.kind])

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

  // After drawing: links open in the browser, outline from the headings, highlights.
  useEffect(() => {
    const el = articleRef.current
    if (!el || !content) return
    el.querySelectorAll('a[href]').forEach((a) => {
      if (!/^https?:/i.test(a.getAttribute('href') ?? '')) a.removeAttribute('href') // Word bookmarks etc.
    })
    headings.current = [...el.querySelectorAll<HTMLElement>('h1, h2, h3')]
    cb.current.onOutline(headings.current.map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').trim() })))
    cb.current.onReady()
    reportScroll()
    drawAnnotations()
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
  }, [])

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
      // Long lines in plain text scroll sideways too.
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

  return (
    <div className="md-scroll" ref={scrollRef}>
      {content?.note && <div className="article-note">{content.note}</div>}
      {doc.kind === 'docx' && content && (
        // Only the text and its structure come through (mammoth); say so, and offer Word.
        <div className="article-note docx-note">
          <span className="beta-badge">{t('Xem đơn giản')}</span>
          <span>{t('Chỉ hiện chữ, tiêu đề, danh sách, bảng và ảnh. Bố cục, màu, khung và căn lề của Word không được giữ.')}</span>
          <button className="btn small" onClick={() => window.api.openPath(doc.path).catch(cb.current.onError)}>
            {t('Mở bằng Word')}
          </button>
        </div>
      )}
      <article ref={articleRef} className={`markdown article-${doc.kind}`} dangerouslySetInnerHTML={{ __html: content?.html ?? '' }} />
    </div>
  )
})

export default ArticleView
