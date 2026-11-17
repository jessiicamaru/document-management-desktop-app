// Finding, drawing and picking text highlights in a page.
//
// A highlight is stored as the selected text plus a little text before and after it
// (TextQuote: quote + prefix + suffix). That survives edits to the document much better
// than character offsets: if the paragraph moves, the quote is simply found again; if the
// same words appear twice, the surrounding text decides which one.
//
// IMPORTANT: createAnchoring must stay self-contained (no imports, no variables from
// outside the function). Besides being imported by the app, its source text is injected
// into HTML documents (see src/main/view-helper.ts), which run in a sandboxed iframe.

import type { Annotation, HighlightColor, TextQuote } from './types'

export interface SelectionInfo extends TextQuote {
  start: number
  end: number
  /** Position of the selection in the page's viewport. */
  rect: { left: number; top: number; right: number; bottom: number }
}

export interface Anchoring {
  /** Readable text of `root` (no scripts, styles, SVG) and where each text node starts in it. */
  textIndex(root: Element): { text: string; nodes: { node: Text; start: number }[] }
  findQuote(text: string, quote: TextQuote): { start: number; end: number } | null
  describe(text: string, start: number, end: number): TextQuote
  /** Character range of a DOM Range inside root's readable text. */
  offsetsOf(root: Element, range: Range): { start: number; end: number; text: string } | null
  /** Wraps a character range in <mark> elements; returns them. */
  wrap(root: Element, start: number, end: number, id: string, color: HighlightColor): HTMLElement[]
  /** Removes every highlight mark from root. */
  clear(root: Element): void
  /** Draws all annotations; returns the ids that could not be found in the text. */
  apply(root: Element, annotations: Pick<Annotation, 'id' | 'color' | 'quote' | 'prefix' | 'suffix'>[]): string[]
  /** What is selected inside root, or null. */
  selectionInfo(root: Element, selection: Selection | null): SelectionInfo | null
  /** For export: numbers the notes (¹ ² ³) after their highlight and lists them at the end of root. */
  printNotes(root: Element, annotations: Annotation[], heading: string): void
  /** Ctrl+F: every place `query` occurs in root's text (accent- and case-insensitive). */
  findAll(root: Element, query: string): Range[]
  /** Shows find matches with the CSS Custom Highlight API (no change to the page's DOM). */
  showFind(doc: Document, ranges: Range[], current: number): void
}

export function createAnchoring(): Anchoring {
  const CONTEXT = 32
  const SKIP = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION']
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const COLORS: Record<string, string> = {
    yellow: 'rgba(250, 204, 21, 0.45)',
    green: 'rgba(74, 222, 128, 0.40)',
    blue: 'rgba(96, 165, 250, 0.40)',
    pink: 'rgba(244, 114, 182, 0.40)'
  }

  function skipped(node: Node, root: Element): boolean {
    for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
      if (SKIP.indexOf(el.tagName.toUpperCase()) !== -1) return true
      if (el.namespaceURI === SVG_NS || el.hasAttribute('data-studydocs')) return true
    }
    return false
  }

  function textIndex(root: Element) {
    const nodes: { node: Text; start: number }[] = []
    let text = ''
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (skipped(n, root)) continue
      nodes.push({ node: n as Text, start: text.length })
      text += (n as Text).data
    }
    return { text, nodes }
  }

  function sharedEnd(a: string, b: string): number {
    let n = 0
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
    return n
  }
  function sharedStart(a: string, b: string): number {
    let n = 0
    while (n < a.length && n < b.length && a[n] === b[n]) n++
    return n
  }

  function findQuote(text: string, q: TextQuote) {
    if (!q.quote) return null
    let best = -1
    let bestScore = -1
    for (let i = text.indexOf(q.quote); i !== -1; i = text.indexOf(q.quote, i + 1)) {
      const before = text.slice(Math.max(0, i - q.prefix.length), i)
      const after = text.slice(i + q.quote.length, i + q.quote.length + q.suffix.length)
      const score = sharedEnd(before, q.prefix) + sharedStart(after, q.suffix)
      if (score > bestScore) {
        best = i
        bestScore = score
      }
    }
    return best < 0 ? null : { start: best, end: best + q.quote.length }
  }

  function describe(text: string, start: number, end: number): TextQuote {
    return {
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT), start),
      suffix: text.slice(end, end + CONTEXT)
    }
  }

  function offsetsOf(root: Element, range: Range) {
    const { text, nodes } = textIndex(root)
    let start = -1
    let end = -1
    for (const { node, start: s } of nodes) {
      if (!range.intersectsNode(node)) continue
      const from = node === range.startContainer ? range.startOffset : 0
      const to = node === range.endContainer ? range.endOffset : node.data.length
      if (to <= from) continue
      if (start < 0) start = s + from
      end = s + to
    }
    return start < 0 || end <= start ? null : { start, end, text }
  }

  function wrap(root: Element, start: number, end: number, id: string, color: HighlightColor) {
    const marks: HTMLElement[] = []
    for (const { node, start: s } of textIndex(root).nodes) {
      const e = s + node.data.length
      if (e <= start || s >= end) continue
      let target = node
      const from = Math.max(start - s, 0)
      const to = Math.min(end - s, node.data.length)
      if (to < target.data.length) target.splitText(to)
      if (from > 0) target = target.splitText(from)
      // Whitespace between table cells or list items: wrapping it would break the layout.
      if (!target.data.trim()) continue
      const mark = root.ownerDocument.createElement('mark')
      mark.setAttribute('data-sd-ann', id)
      mark.className = 'sd-hl'
      mark.style.cssText = `background:${COLORS[color] || COLORS.yellow};color:inherit;border-radius:2px;padding:0;cursor:pointer`
      target.parentNode!.insertBefore(mark, target)
      mark.appendChild(target)
      marks.push(mark)
    }
    return marks
  }

  function clear(root: Element) {
    const marks = root.querySelectorAll('mark[data-sd-ann], sup[data-sd-ref], [data-sd-notes]')
    marks.forEach((m) => {
      if (m.tagName.toUpperCase() !== 'MARK') return m.remove()
      while (m.firstChild) m.parentNode!.insertBefore(m.firstChild, m)
      m.remove()
    })
    root.normalize()
  }

  function apply(root: Element, annotations: Pick<Annotation, 'id' | 'color' | 'quote' | 'prefix' | 'suffix'>[]) {
    clear(root)
    const missing: string[] = []
    for (const a of annotations) {
      const found = findQuote(textIndex(root).text, a)
      if (!found || !wrap(root, found.start, found.end, a.id, a.color).length) missing.push(a.id)
    }
    return missing
  }

  function selectionInfo(root: Element, selection: Selection | null): SelectionInfo | null {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return null
    const at = offsetsOf(root, range)
    if (!at) return null
    const q = describe(at.text, at.start, at.end)
    if (!q.quote.trim()) return null
    const r = range.getBoundingClientRect()
    return { ...q, start: at.start, end: at.end, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
  }

  function printNotes(root: Element, annotations: Annotation[], heading: string) {
    const doc = root.ownerDocument
    const missing = apply(root, annotations)
    const text = textIndex(root).text
    // Number the notes in reading order.
    const withNotes = annotations
      .filter((a) => a.note.trim())
      .map((a) => ({ a, at: missing.indexOf(a.id) === -1 ? (findQuote(text, a)?.start ?? Infinity) : Infinity }))
      .sort((x, y) => x.at - y.at)
    if (!withNotes.length) return

    const section = doc.createElement('section')
    section.setAttribute('data-sd-notes', '')
    section.style.cssText = 'margin-top:2.5em;padding-top:1em;border-top:2px solid #ddd;break-before:auto;font-size:0.92em'
    const h = doc.createElement('h2')
    h.textContent = heading
    const list = doc.createElement('ol')
    list.style.cssText = 'padding-left:1.6em'
    section.append(h, list)

    withNotes.forEach(({ a }, i) => {
      const n = String(i + 1)
      const marks = root.querySelectorAll(`mark[data-sd-ann="${a.id}"]`)
      const last = marks[marks.length - 1]
      if (last) {
        const sup = doc.createElement('sup')
        sup.setAttribute('data-sd-ref', '')
        const link = doc.createElement('a')
        link.href = `#sd-note-${n}`
        link.id = `sd-ref-${n}`
        link.textContent = n
        link.style.cssText = 'text-decoration:none;font-weight:700;color:#b4531f'
        sup.append(link)
        last.after(sup)
      }
      const li = doc.createElement('li')
      li.id = `sd-note-${n}`
      li.style.cssText = 'margin:0 0 0.9em'
      const quote = doc.createElement('div')
      quote.textContent = `“${a.quote.length > 220 ? a.quote.slice(0, 220) + '…' : a.quote}”`
      quote.style.cssText = `border-left:3px solid ${COLORS[a.color] || COLORS.yellow};padding-left:8px;color:#555;font-style:italic;margin-bottom:4px`
      const note = doc.createElement('div')
      note.textContent = a.note
      note.style.cssText = 'white-space:pre-wrap'
      li.append(quote, note)
      if (last) {
        const back = doc.createElement('a')
        back.href = `#sd-ref-${n}`
        back.textContent = ' ↩'
        back.style.cssText = 'text-decoration:none;color:#b4531f'
        note.append(back)
      } else {
        const gone = doc.createElement('div')
        gone.textContent = '(đoạn trích này không còn trong bài)'
        gone.style.cssText = 'color:#999;font-size:0.9em'
        li.append(gone)
      }
      list.append(li)
    })
    root.append(section)
  }

  /** Lowercase, accents removed, one character for one character (so positions still match). */
  function fold(text: string): string {
    let out = ''
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch.charCodeAt(0) < 0x80) {
        out += ch.toLowerCase()
        continue
      }
      const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase()
      out += f.length === 1 ? f : f.length === 0 ? ' ' : ch
    }
    return out
  }

  function findAll(root: Element, query: string) {
    const q = fold(query.trim())
    if (!q) return []
    const { text, nodes } = textIndex(root)
    const haystack = fold(text)
    const at = (offset: number, end: boolean): [Text, number] => {
      // The text node holding this offset (an end offset may sit at the very end of a node).
      let lo = 0
      let hi = nodes.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (nodes[mid].start < offset || (!end && nodes[mid].start === offset)) lo = mid
        else hi = mid - 1
      }
      return [nodes[lo].node, offset - nodes[lo].start]
    }
    const ranges: Range[] = []
    for (let i = haystack.indexOf(q); i >= 0 && ranges.length < 5000; i = haystack.indexOf(q, i + q.length)) {
      const range = root.ownerDocument.createRange()
      range.setStart(...at(i, false))
      range.setEnd(...at(i + q.length, true))
      ranges.push(range)
    }
    return ranges
  }

  function showFind(doc: Document, ranges: Range[], current: number) {
    const win = doc.defaultView as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (...r: Range[]) => unknown }
    const registry = win?.CSS?.highlights
    if (!registry || !win.Highlight) return
    if (!doc.getElementById('sd-find-style')) {
      const style = doc.createElement('style')
      style.id = 'sd-find-style'
      style.setAttribute('data-studydocs', '')
      style.textContent =
        '::highlight(sd-find){background-color:rgba(250,204,21,.45);color:inherit}' +
        '::highlight(sd-find-current){background-color:rgba(249,115,22,.85);color:#000}'
      ;(doc.head || doc.documentElement).appendChild(style)
    }
    registry.set('sd-find', new win.Highlight(...ranges))
    registry.set('sd-find-current', new win.Highlight(...(ranges[current] ? [ranges[current]] : [])))
  }

  return { textIndex, findQuote, describe, offsetsOf, wrap, clear, apply, selectionInfo, printNotes, findAll, showFind }
}
