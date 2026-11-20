// "Live preview" for the Markdown editor (like Obsidian): the text in the file is exactly what
// you typed, but it is drawn formatted. Headings are big, **bold** is bold, links look like links,
// images and checkboxes are drawn in place. The Markdown signs (#, **, [](…)…) are hidden, except
// on the line(s) with the cursor, where you edit them.

import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { docUrl } from './docs'

// ---------- widgets ----------

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.title = this.alt
    wrap.appendChild(img)
    return wrap
  }
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-md-bullet'
    el.textContent = '•'
    return el
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    // Ticking writes "[x]" / "[ ]" into the text.
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-md-hr'
    return el
  }
}

// ---------- decorations ----------

const hide = Decoration.replace({})
const mark = (cls: string): Decoration => Decoration.mark({ class: cls })
const line = (cls: string): Decoration => Decoration.line({ class: cls })

/** Lines that hold a cursor or selection: their Markdown signs stay visible. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    const last = state.doc.lineAt(r.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

function build(view: EditorView, docId: string): DecorationSet {
  const { state } = view
  const active = activeLines(state)
  const isActive = (from: number, to: number = from): boolean => {
    const a = state.doc.lineAt(from).number
    const b = state.doc.lineAt(to).number
    for (let n = a; n <= b; n++) if (active.has(n)) return true
    return false
  }
  const base = docUrl(docId)
  const out: Range<Decoration>[] = []
  const lineDeco = (from: number, to: number, deco: Decoration): void => {
    for (let pos = from; pos <= to; ) {
      const l = state.doc.lineAt(pos)
      out.push(deco.range(l.from))
      pos = l.to + 1
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const heading = /^ATXHeading(\d)$/.exec(name)
        if (heading) {
          lineDeco(node.from, node.from, line(`cm-md-h cm-md-h${heading[1]}`))
          return
        }
        switch (name) {
          case 'HeaderMark': {
            if (isActive(node.from)) return
            // "## " -> hide the signs and the space after them.
            const next = state.doc.sliceString(node.to, node.to + 1)
            out.push(hide.range(node.from, next === ' ' ? node.to + 1 : node.to))
            return
          }
          case 'StrongEmphasis':
            out.push(mark('cm-md-strong').range(node.from, node.to))
            return
          case 'Emphasis':
            out.push(mark('cm-md-em').range(node.from, node.to))
            return
          case 'Strikethrough':
            out.push(mark('cm-md-strike').range(node.from, node.to))
            return
          case 'InlineCode':
            out.push(mark('cm-md-code').range(node.from, node.to))
            return
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) out.push(hide.range(node.from, node.to))
            return
          case 'CodeMark':
            // Backticks of inline code; the fences of code blocks stay.
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) out.push(hide.range(node.from, node.to))
            return
          case 'FencedCode':
            lineDeco(node.from, node.to, line('cm-md-codeblock'))
            return false
          case 'Blockquote':
            lineDeco(node.from, node.to, line('cm-md-quote'))
            return
          case 'QuoteMark':
            if (!isActive(node.from)) out.push(hide.range(node.from, state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to))
            return
          case 'Link': {
            out.push(mark('cm-md-link').range(node.from, node.to))
            if (isActive(node.from, node.to)) return
            // [text](url): only "text" stays.
            const marks = node.node.getChildren('LinkMark')
            if (marks.length >= 2) {
              out.push(hide.range(marks[0].from, marks[0].to))
              out.push(hide.range(marks[1].from, node.to))
            }
            return false
          }
          case 'Image': {
            if (isActive(node.from, node.to)) return false
            const url = node.node.getChild('URL')
            if (!url) return false
            let src = state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
            if (!/^(https?:|data:|doc:)/i.test(src)) {
              try {
                src = new URL(src, base).href
              } catch {
                return false
              }
            }
            const marks = node.node.getChildren('LinkMark')
            const alt = marks.length >= 2 ? state.doc.sliceString(marks[0].to, marks[1].from) : ''
            out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to))
            return false
          }
          case 'ListMark': {
            if (isActive(node.from)) return
            const text = state.doc.sliceString(node.from, node.to)
            const task = node.node.parent?.getChild('Task')
            // "- [ ] item": the checkbox stands for the bullet.
            if (/^[-*+]$/.test(text) && !task) out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
            else if (task) out.push(hide.range(node.from, Math.min(node.to + 1, task.from)))
            return
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to))
            if (checked) out.push(line('cm-md-done').range(state.doc.lineAt(node.from).from))
            if (!isActive(node.from)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(node.from, node.to))
            return
          }
          case 'HorizontalRule':
            if (!isActive(node.from)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            return
        }
      }
    })
  }
  return Decoration.set(out, true) // true: sort them
}

/** The live preview of a Markdown note (the id resolves relative image paths). */
export function livePreview(docId: () => string): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = build(view, docId())
        }
        update(u: ViewUpdate): void {
          if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view, docId())
        }
      },
      { decorations: (v) => v.decorations }
    ),
    EditorView.lineWrapping
  ]
}

// ---------- formatting commands ----------

/** Wraps the selection in `before`/`after` (or removes them when already there): Ctrl+B, Ctrl+I. */
export function wrap(view: EditorView, before: string, after = before): boolean {
  const { state } = view
  const tr = state.changeByRange((range) => {
    const outerFrom = range.from - before.length
    const outerTo = range.to + after.length
    const already = outerFrom >= 0 && state.sliceDoc(outerFrom, range.from) === before && state.sliceDoc(range.to, outerTo) === after
    if (already) {
      return {
        changes: [
          { from: outerFrom, to: range.from },
          { from: range.to, to: outerTo }
        ],
        range: EditorSelection.range(outerFrom, range.to - before.length)
      }
    }
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after }
      ],
      range: EditorSelection.range(range.from + before.length, range.to + before.length)
    }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/** [text](url) around the selection, with "url" selected to type over. */
export function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to) || 'link'
  const insert = `[${text}](url)`
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + text.length + 3, head: from + text.length + 6 }, scrollIntoView: true })
  return true
}

/** Puts `prefix` at the start of every selected line ("## ", "- ", "- [ ] ", "> "), or takes it away. */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) lines.add(n)
  }
  const all = [...lines].map((n) => state.doc.line(n))
  const has = all.every((l) => l.text.startsWith(prefix))
  // A heading of another level is replaced, not stacked ("## " on "# Title").
  const strip = /^#{1,6} /
  view.dispatch({
    changes: all.map((l) => {
      if (has) return { from: l.from, to: l.from + prefix.length }
      const old = prefix.startsWith('#') ? (strip.exec(l.text)?.[0].length ?? 0) : 0
      return { from: l.from, to: l.from + old, insert: prefix }
    }),
    scrollIntoView: true
  })
  return true
}

