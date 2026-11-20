import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import markdownItKatex from '@vscode/markdown-it-katex'
import 'katex/dist/katex.min.css'
import type { DocEntry } from '../../../shared/types'
import { docUrl, parseDocUrl } from '../lib/docs'
import { loadMermaid } from '../lib/mermaid'
import type { ScrollTarget } from '../App'
import type { FindResult, ReaderCallbacks, ReaderHandle } from './reader'
import type { Annotation } from '../../../shared/types'
import { createAnchoring } from '../../../shared/anchor'
import { t } from '../../../shared/i18n'

const anchoring = createAnchoring()

// html: true lets you mix raw HTML/SVG into Markdown. Everything is passed through
// DOMPurify afterwards, which removes <script> and on*="" handlers.
const md = new MarkdownIt({
  html: true,
  linkify: true,
  // Code blocks are coloured by language (issue #18). Unknown languages stay plain.
  highlight: (code, lang) => {
    const name = lang.trim().split(/\s+/)[0]
    if (!name || !hljs.getLanguage(name)) return ''
    try {
      return hljs.highlight(code, { language: name, ignoreIllegals: true }).value
    } catch {
      return ''
    }
  }
})
// $...$ and $$...$$ are drawn with KaTeX. Bad formulas are shown in red instead of failing.
md.use(markdownItKatex, { throwOnError: false })

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

/**
 * Renders a whole .md file (front matter skipped) to safe HTML with source ranges.
 * `base` (the note's doc:// URL) makes relative picture paths ("assets/a.webp") absolute right
 * away: the browser starts loading pictures as soon as the HTML is inserted, and would otherwise
 * look for them next to the app.
 */
export function renderMarkdown(source: string, base?: string): string {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const html = DOMPurify.sanitize(md.render(body), { USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true } })
  if (!base || !/<img\b/i.test(html)) return html
  // A <template> is inert: nothing in it loads while the paths are fixed.
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    const src = img.getAttribute('src')!
    if (/^(https?:|data:|doc:|blob:)/i.test(src)) return
    try {
      img.setAttribute('src', new URL(src, base).href)
    } catch {
      img.removeAttribute('src')
    }
  })
  return tpl.innerHTML
}

interface Props extends ReaderCallbacks {
  doc: DocEntry
  allDocs: DocEntry[]
  scrollTarget: ScrollTarget
  /** Unsaved text from the raw editor, shown as a live preview. */
  sourceOverride: string | null
  onOpenDoc: (path: string, hash?: string) => void
  onError: (err: unknown) => void
}

const MarkdownView = forwardRef<ReaderHandle, Props>(function MarkdownView(props, ref) {
  const { doc, allDocs, scrollTarget, sourceOverride, onOpenDoc, onError } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const headings = useRef<HTMLElement[]>([])
  // Latest outline/reading callbacks, read from effects without re-running them.
  const cb = useRef(props)
  cb.current = props
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref_ = useRef<HTMLDivElement>(null)

  // Re-read whenever the file changes on disk (mtime changes).
  useEffect(() => {
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
  }, [doc.path, doc.mtime])

  const shown = sourceOverride ?? source
  const html = useMemo(() => (shown === null ? '' : renderMarkdown(shown, docUrl(doc.path))), [shown, doc.path])

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
  }, [html, doc.path])

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
  /** Draws the highlights over the rendered article. */
  function drawAnnotations(): void {
    const el = ref_.current
    if (!el) return
    cb.current.onAnchored(anchoring.apply(el, annotations.current))
  }
  // Selecting text shows the highlight toolbar; clicking a highlight opens its note.
  useEffect(() => {
    const el = ref_.current
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
  }, [html])

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

  useImperativeHandle(ref, () => ({
    gotoHeading: (index) => headings.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    restoreScroll: (y) => {
      if (scrollRef.current) scrollRef.current.scrollTop = y
    },
    collectChanges: async () => ({ kind: 'none' }), // Markdown is written in MarkdownEditor
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
  // (handled by the main process).
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href) return
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return
    e.preventDefault()
    const target = parseDocUrl(new URL(href, docUrl(doc.path)).href)
    if (!target) return
    if (target.path === doc.path) scrollTo(target.hash, true)
    else if (allDocs.some((d) => d.path === target.path)) onOpenDoc(target.path, target.hash)
    else window.api.openPath(target.path).catch(onError)
  }

  if (error) return <div className="md-error">{t('Không đọc được file:')}{' '}{error}</div>
  return (
    <div className="md-scroll" ref={scrollRef}>
      <article
        ref={ref_}
        className="markdown"
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
})

export default MarkdownView
