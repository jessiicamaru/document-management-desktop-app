import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { DocEntry } from '../../../shared/types'
import { docUrl, parseDocUrl } from '../lib/docs'
import type { ScrollTarget } from '../App'

// html: true lets you mix raw HTML/SVG into Markdown. Everything is passed through
// DOMPurify afterwards, which removes <script> and on*="" handlers.
const md = new MarkdownIt({ html: true, linkify: true })

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

function stripFrontMatter(src: string): string {
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

interface Props {
  doc: DocEntry
  allDocs: DocEntry[]
  scrollTarget: ScrollTarget
  onOpenDoc: (path: string, hash?: string) => void
  onError: (err: unknown) => void
}

export default function MarkdownView({ doc, allDocs, scrollTarget, onOpenDoc, onError }: Props) {
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

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

  const html = useMemo(() => {
    if (source === null) return ''
    return DOMPurify.sanitize(md.render(stripFrontMatter(source)), {
      USE_PROFILES: { html: true, svg: true, svgFilters: true }
    })
  }, [source])

  // After rendering: fix relative image paths and draw Mermaid diagrams.
  useEffect(() => {
    const el = ref.current
    if (!el || !html) return
    const base = docUrl(doc.path)
    el.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src')!
      if (!/^(https?:|data:|doc:)/i.test(src)) img.src = new URL(src, base).href
    })

    const diagrams = el.querySelectorAll<HTMLElement>('pre.mermaid')
    if (diagrams.length) {
      void import('mermaid').then(async ({ default: mermaid }) => {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
        try {
          await mermaid.run({ nodes: diagrams })
        } catch (e) {
          console.error('Mermaid error', e)
        }
      })
    }
  }, [html, doc.path])

  const scrollTo = (id: string, smooth: boolean): void => {
    if (!id) return
    ref.current
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
    if (!a || !href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return
    e.preventDefault()
    const target = parseDocUrl(new URL(href, docUrl(doc.path)).href)
    if (!target) return
    if (target.path === doc.path) scrollTo(target.hash, true)
    else if (allDocs.some((d) => d.path === target.path)) onOpenDoc(target.path, target.hash)
    else window.api.openPath(target.path).catch(onError)
  }

  if (error) return <div className="md-error">Không đọc được file: {error}</div>
  return (
    <div className="md-scroll">
      <article ref={ref} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
