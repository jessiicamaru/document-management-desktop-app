import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { DocEntry } from '../../../shared/types'
import { docUrl, parseDocUrl } from '../lib/docs'
import { loadMermaid } from '../lib/mermaid'
import { applyMarkdownEdits, lineStartsOf, MdEditError, sourceRangesPlugin } from '../lib/md-edit'
import type { ScrollTarget } from '../App'
import type { FindResult, ReaderCallbacks, ReaderHandle } from './reader'
import type { Annotation } from '../../../shared/types'
import { createAnchoring } from '../../../shared/anchor'

const anchoring = createAnchoring()

// html: true lets you mix raw HTML/SVG into Markdown. Everything is passed through
// DOMPurify afterwards, which removes <script> and on*="" handlers.
const md = new MarkdownIt({ html: true, linkify: true })
md.use(sourceRangesPlugin) // data-src="start:end" on editable blocks, for inline editing

// ```mermaid blocks become <pre class="mermaid"> and are drawn after rendering.
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'mermaid') return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`
  return defaultFence(tokens, idx, options, env, self)
}

// Give headings an id so links like [xem phần 2](#phan-2) work.
md.core.ruler.push('heading_ids', (state) => {
  const used = new Map<string, number>()
  state.tokens.forEach((token, i) => {
    if (token.type !== 'heading_open') return
    const text = state.tokens[i + 1]?.content ?? ''
    let slug = text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    const n = used.get(slug) ?? 0
    used.set(slug, n + 1)
    if (n) slug += `-${n}`
    token.attrSet('id', slug)
  })
})

/** Renders a whole .md file (front matter skipped) to safe HTML with source ranges. */
export function renderMarkdown(source: string): string {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const env = { lineStarts: lineStartsOf(body), offset: source.length - body.length, length: body.length, source: body }
  return DOMPurify.sanitize(md.render(body, env), { USE_PROFILES: { html: true, svg: true, svgFilters: true } })
}

const plainText = (el: Element): string => (el.textContent ?? '').replace(/ /g, ' ')

/** Text editing only: no new paragraphs, no formatting, no dropped content. */
const ALLOWED_INPUT = /^(insertText|insertReplacementText|insertFromPaste|insertCompositionText|deleteContent|deleteWord|deleteSoftLine|deleteHardLine|deleteByCut|historyUndo|historyRedo)/

interface Props extends ReaderCallbacks {
  doc: DocEntry
  allDocs: DocEntry[]
  scrollTarget: ScrollTarget
  editing: boolean
  /** Unsaved text from the raw editor, shown as a live preview. */
  sourceOverride: string | null
  onDirty: (dirty: boolean) => void
  onOpenDoc: (path: string, hash?: string) => void
  onError: (err: unknown) => void
}

interface EditBlock {
  el: HTMLElement
  start: number
  end: number
  oldText: string
}

const MarkdownView = forwardRef<ReaderHandle, Props>(function MarkdownView(props, ref) {
  const { doc, allDocs, scrollTarget, editing, sourceOverride, onDirty, onOpenDoc, onError } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const headings = useRef<HTMLElement[]>([])
  // Latest outline/reading callbacks, read from effects without re-running them.
  const cb = useRef(props)
  cb.current = props
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped when an edit session ends, so the article is rebuilt from the file (drops unsaved typing).
  const [renderKey, setRenderKey] = useState(0)
  const ref_ = useRef<HTMLDivElement>(null)
  const blocks = useRef<EditBlock[]>([])
  const onDirtyRef = useRef(onDirty)
  onDirtyRef.current = onDirty

  // Re-read whenever the file changes on disk (mtime changes), except in the middle of an edit.
  useEffect(() => {
    if (editing) return
    let alive = true
    window.api
      .readDoc(doc.path)
      .then((s) => {
        if (!alive) return
        setError(null) // the file may have been unreadable a moment ago
        setSource(s)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [doc.path, doc.mtime, editing])

  const shown = editing ? source : (sourceOverride ?? source)
  const html = useMemo(() => (shown === null ? '' : renderMarkdown(shown)), [shown])

  // After rendering: fix relative image paths and draw Mermaid diagrams.
  useEffect(() => {
    const el = ref_.current
    if (!el || !html) return
    const base = docUrl(doc.path)
    el.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src')!
      if (!/^(https?:|data:|doc:)/i.test(src)) img.src = new URL(src, base).href
    })

    let cancelled = false
    // Outline + "ready" once everything is drawn, so a saved reading position lands right.
    const finish = (): void => {
      if (cancelled) return
      headings.current = [...el.querySelectorAll<HTMLElement>('h1, h2, h3')]
      cb.current.onOutline(headings.current.map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').trim() })))
      cb.current.onReady()
      reportScroll()
      drawAnnotations()
    }

    const diagrams = el.querySelectorAll<HTMLElement>('pre.mermaid')
    if (!diagrams.length) finish()
    else {
      void loadMermaid().then(async (mermaid) => {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
        // The live raw preview can re-render while Mermaid is still drawing: skip stale nodes.
        const live = [...diagrams].filter((d) => d.isConnected)
        if (!live.length) return
        try {
          await mermaid.run({ nodes: live })
        } catch (e) {
          if (live.some((d) => d.isConnected)) console.error('Mermaid error', e)
        }
        finish()
      })
    }
    return () => {
      cancelled = true
    }
  }, [html, doc.path, renderKey])

  // ---------- find (Ctrl+F) ----------

  const found = useRef<Range[]>([])
  const foundIndex = useRef(0)
  /** Highlights the matches, scrolls the current one into view, returns where we are. */
  function showFound(): FindResult {
    anchoring.showFind(document, found.current, foundIndex.current)
    const current = found.current[foundIndex.current]
    const scroller = scrollRef.current
    if (current && scroller) {
      const r = current.getBoundingClientRect()
      const box = scroller.getBoundingClientRect()
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) scroller.scrollTop += r.top - box.top - scroller.clientHeight / 3
    }
    return { index: foundIndex.current, total: found.current.length }
  }

  // ---------- highlights ----------

  const annotations = useRef<Annotation[]>([])
  /** Draws the highlights over the rendered article (not while editing text). */
  function drawAnnotations(): void {
    const el = ref_.current
    if (!el || cb.current.editing) return
    cb.current.onAnchored(anchoring.apply(el, annotations.current))
  }
  // Selecting text shows the highlight toolbar; clicking a highlight opens its note.
  useEffect(() => {
    const el = ref_.current
    if (!el || editing) return
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
  }, [editing, renderKey])

  /** Tells DocView where you are: scroll position and the heading at the top of the view. */
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
  })

  // Edit mode: make every block with a known source range editable as plain text.
  useEffect(() => {
    const el = ref_.current
    if (!editing || !el) return
    anchoring.clear(el) // highlights come back when editing ends and the article is redrawn
    blocks.current = [...el.querySelectorAll<HTMLElement>('[data-src]')].map((block) => {
      const [start, end] = block.dataset.src!.split(':').map(Number)
      block.contentEditable = 'plaintext-only'
      block.spellcheck = false
      block.classList.add('editable')
      return { el: block, start, end, oldText: plainText(block) }
    })
    const changed = (): number => blocks.current.filter((b) => plainText(b.el) !== b.oldText).length
    const onBeforeInput = (e: InputEvent): void => {
      if (!ALLOWED_INPUT.test(e.inputType)) e.preventDefault()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') e.preventDefault()
    }
    const onInput = (e: Event): void => {
      const block = (e.target as HTMLElement).closest('[data-src]')
      const b = blocks.current.find((x) => x.el === block)
      if (b) b.el.classList.toggle('dirty', plainText(b.el) !== b.oldText)
      onDirtyRef.current(changed() > 0)
    }
    el.addEventListener('beforeinput', onBeforeInput)
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('input', onInput)
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('input', onInput)
      blocks.current = []
      setRenderKey((k) => k + 1)
    }
  }, [editing, html])

  /** The new file content with your edits, or null if nothing changed. Throws if it can't be saved safely. */
  const collectSource = (): string | null => {
    if (source === null) return null
    const edits = blocks.current
      .filter((b) => plainText(b.el) !== b.oldText)
      .map((b) => ({ start: b.start, end: b.end, oldText: b.oldText, newText: plainText(b.el) }))
    if (!edits.length) return null
    const next = applyMarkdownEdits(source, edits)

    // Safety check: the new file must render to exactly the text you see now.
    const check = document.createElement('div')
    check.innerHTML = renderMarkdown(next)
    const after = [...check.querySelectorAll('[data-src]')].map((e) => plainText(e).trim())
    const expected = blocks.current.map((b) => plainText(b.el).trim())
    if (after.length !== expected.length || after.some((t, i) => t !== expected[i])) {
      throw new MdEditError('Thay đổi này làm đổi định dạng Markdown nên chưa lưu. Hãy sửa đoạn đó trong Raw.')
    }
    return next
  }

  useImperativeHandle(ref, () => ({
    gotoHeading: (index) => headings.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    restoreScroll: (y) => {
      if (scrollRef.current) scrollRef.current.scrollTop = y
    },
    collectChanges: async () => ({ kind: 'md', source: collectSource() }),
    setAnnotations: (items) => {
      annotations.current = items
      drawAnnotations()
    },
    gotoAnnotation: (id) => {
      const mark = ref_.current?.querySelector<HTMLElement>(`mark[data-sd-ann="${CSS.escape(id)}"]`)
      if (!mark) return
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      mark.animate([{ outline: '3px solid var(--accent)' }, { outline: '3px solid transparent' }], { duration: 1400 })
    },
    clearSelection: () => getSelection()?.removeAllRanges(),
    find: async (query) => {
      found.current = ref_.current ? anchoring.findAll(ref_.current, query) : []
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

  const scrollTo = (id: string, smooth: boolean): void => {
    if (!id) return
    ref_.current
      ?.querySelector(`[id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  // Opened through a link such as other.md#part: jump to that section once rendered.
  useEffect(() => {
    if (html) scrollTo(scrollTarget.hash, false)
  }, [html, scrollTarget])

  // Links: #anchors scroll, links to other library docs open in the app, other library
  // files (pdf, images...) open in their default app, web links go to the browser
  // (handled by the main process). While editing, links do nothing.
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href) return
    if (editing) {
      e.preventDefault()
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return
    e.preventDefault()
    const target = parseDocUrl(new URL(href, docUrl(doc.path)).href)
    if (!target) return
    if (target.path === doc.path) scrollTo(target.hash, true)
    else if (allDocs.some((d) => d.path === target.path)) onOpenDoc(target.path, target.hash)
    else window.api.openPath(target.path).catch(onError)
  }

  if (error) return <div className="md-error">Không đọc được file: {error}</div>
  return (
    <div className="md-scroll" ref={scrollRef}>
      <article
        key={renderKey}
        ref={ref_}
        className={`markdown ${editing ? 'editing' : ''}`}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
})

export default MarkdownView
