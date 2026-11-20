// Bigger pieces of a Markdown note drawn in place in the editor, like the reading view does:
//  - tables (GFM),
//  - formulas: $$…$$ blocks and $…$ inside a line (KaTeX),
//  - ```mermaid diagrams.
// Click one (or move the cursor into it) and its Markdown shows again for editing; the text in
// the file is never changed by drawing it.

import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import katex from 'katex'
import { renderMarkdown } from '../components/MarkdownView'
import { loadMermaid } from './mermaid'
import { docUrl } from './docs'

/** Lines with a cursor or selection: shown as Markdown. */
function touchesSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}

/** Puts the cursor at the start of a drawn block, so it opens for editing. */
function openOnClick(dom: HTMLElement, view: EditorView): void {
  dom.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const pos = view.posAtDOM(dom)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
  })
}

// ---------- widgets ----------

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly base: string
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source && other.base === this.base
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-md-block cm-md-table markdown'
    el.innerHTML = renderMarkdown(this.source, this.base)
    openOnClick(el, view)
    return el
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-md-block cm-md-math' : 'cm-md-math-inline'
    el.innerHTML = katex.renderToString(this.tex, { throwOnError: false, displayMode: this.display })
    openOnClick(el, view)
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** Diagrams already drawn, by their code: drawing again only when the code changes. */
const mermaidCache = new Map<string, string>()
let mermaidId = 0

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-md-block cm-md-mermaid'
    const cached = mermaidCache.get(this.code)
    if (cached) el.innerHTML = cached
    else {
      el.textContent = '…'
      void loadMermaid()
        .then(async (mermaid) => {
          const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
          const { svg } = await mermaid.render(`sd-editor-mermaid-${++mermaidId}`, this.code)
          mermaidCache.set(this.code, svg)
          el.innerHTML = svg
          view.requestMeasure()
        })
        .catch(() => {
          el.classList.add('error')
          el.textContent = this.code
        })
    }
    openOnClick(el, view)
    return el
  }
}

// ---------- blocks (whole lines: must come from a state field) ----------

/** $$ … $$ blocks: [from, to, tex], by lines. */
function mathBlocks(state: EditorState): { from: number; to: number; tex: string }[] {
  const out: { from: number; to: number; tex: string }[] = []
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const text = line.text.trim()
    if (!text.startsWith('$$')) continue
    // One line: $$ a + b $$
    if (text.length > 4 && text.endsWith('$$')) {
      out.push({ from: line.from, to: line.to, tex: text.slice(2, -2) })
      continue
    }
    if (text !== '$$') continue
    for (let m = n + 1; m <= doc.lines; m++) {
      if (doc.line(m).text.trim() === '$$') {
        out.push({ from: line.from, to: doc.line(m).to, tex: doc.sliceString(line.to + 1, doc.line(m).from - 1) })
        n = m
        break
      }
    }
  }
  return out
}

function buildBlocks(state: EditorState, base: string): DecorationSet {
  const out: Range<Decoration>[] = []
  const inCode: { from: number; to: number }[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'FencedCode') {
        inCode.push({ from: node.from, to: node.to })
        const info = node.node.getChild('CodeInfo')
        const lang = info ? state.doc.sliceString(info.from, info.to).trim() : ''
        if (lang === 'mermaid' && !touchesSelection(state, node.from, node.to)) {
          const text = node.node.getChild('CodeText')
          const code = text ? state.doc.sliceString(text.from, text.to) : ''
          if (code.trim()) out.push(Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(node.from, node.to))
        }
        return false
      }
      if (node.name === 'Table') {
        if (!touchesSelection(state, node.from, node.to)) {
          out.push(Decoration.replace({ widget: new TableWidget(state.doc.sliceString(node.from, node.to), base), block: true }).range(node.from, node.to))
        }
        return false
      }
    }
  })
  for (const b of mathBlocks(state)) {
    if (inCode.some((c) => b.from >= c.from && b.to <= c.to)) continue
    if (!touchesSelection(state, b.from, b.to) && b.tex.trim()) out.push(Decoration.replace({ widget: new MathWidget(b.tex, true), block: true }).range(b.from, b.to))
  }
  return Decoration.set(out, true)
}

// ---------- $…$ inside a line (a view plugin is enough) ----------

const INLINE_MATH = /(^|[^\\$])\$(?=\S)([^$\n]*?\S)\$(?!\$|\d)/g

function buildInline(view: EditorView, blocks: DecorationSet): DecorationSet {
  const { state } = view
  const out: Range<Decoration>[] = []
  const tree = syntaxTree(state)
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      pos = line.to + 1
      if (line.text.trimStart().startsWith('$$')) continue
      let covered = false
      blocks.between(line.from, line.to, () => {
        covered = true
        return false
      })
      if (covered || touchesSelection(state, line.from, line.to)) continue
      INLINE_MATH.lastIndex = 0
      for (let m = INLINE_MATH.exec(line.text); m; m = INLINE_MATH.exec(line.text)) {
        const start = line.from + m.index + m[1].length
        const end = start + m[2].length + 2
        const at = tree.resolveInner(start + 1, 1)
        if (/Code|URL|Link/.test(at.name) || /Code/.test(at.parent?.name ?? '')) continue
        out.push(Decoration.replace({ widget: new MathWidget(m[2], false) }).range(start, end))
      }
    }
  }
  return Decoration.set(out, true)
}

/** Tables, formulas and Mermaid diagrams drawn in the editor (the id resolves relative paths). */
export function richBlocks(docId: () => string): Extension {
  const blocks = StateField.define<DecorationSet>({
    create: (state) => buildBlocks(state, docUrl(docId())),
    update: (value, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? buildBlocks(tr.state, docUrl(docId())) : value),
    provide: (f) => EditorView.decorations.from(f)
  })
  const inline = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildInline(view, view.state.field(blocks))
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = buildInline(u.view, u.state.field(blocks))
        }
      }
    },
    { decorations: (v) => v.decorations }
  )
  return [blocks, inline]
}

