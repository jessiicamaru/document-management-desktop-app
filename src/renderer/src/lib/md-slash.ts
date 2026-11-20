// The "/" menu of the Markdown editor: type "/" at the start of a line (then a few letters to
// narrow it down, accents optional) and pick a heading, list, table, formula, diagram, picture…
// It only inserts ordinary Markdown text.

import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { t } from '../../../shared/i18n'
import { normalize } from './docs'

interface Item {
  label: string
  detail: string
  /** A CodeMirror snippet: \${} marks where the cursor goes. */
  insert?: string
  run?: (view: EditorView) => void
}

function items(onImage: () => void): Item[] {
  return [
    { label: t('Tiêu đề lớn'), detail: '#', insert: '# ${}' },
    { label: t('Tiêu đề mục'), detail: '##', insert: '## ${}' },
    { label: t('Tiêu đề nhỏ'), detail: '###', insert: '### ${}' },
    { label: t('Danh sách'), detail: '-', insert: '- ${}' },
    { label: t('Danh sách đánh số'), detail: '1.', insert: '1. ${}' },
    { label: t('Việc cần làm'), detail: '- [ ]', insert: '- [ ] ${}' },
    { label: t('Trích dẫn'), detail: '>', insert: '> ${}' },
    { label: t('Bảng'), detail: '| |', insert: `| \${${t('Cột 1')}} | ${t('Cột 2')} |\n| --- | --- |\n|  |  |\n` },
    { label: t('Đoạn code'), detail: '```', insert: '```${lang}\n${}\n```\n' },
    { label: t('Công thức'), detail: '$$', insert: '$$\n${x^2 + y^2 = z^2}\n$$\n' },
    { label: t('Sơ đồ Mermaid'), detail: 'mermaid', insert: '```mermaid\nflowchart LR\n  ${A} --> B\n```\n' },
    { label: t('Đường kẻ ngang'), detail: '---', insert: '---\n${}' },
    { label: t('Ảnh'), detail: '![]()', run: () => onImage() }
  ]
}

/** "/" menu; `onImage` opens the picture picker. */
export function slashMenu(onImage: () => void): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos)
    const before = context.state.sliceDoc(line.from, context.pos)
    // "/" at the start of a line (after spaces), followed by letters only.
    const m = /^(\s*)\/([\p{L}\p{N} ]{0,20})$/u.exec(before)
    if (!m) return null
    const from = line.from + m[1].length
    const query = normalize(m[2].trim())
    const options: Completion[] = items(onImage)
      .filter((it) => !query || normalize(it.label).includes(query))
      .map((it, i) => ({
        label: it.label,
        detail: it.detail,
        boost: -i,
        apply: (view, completion, applyFrom, applyTo) => {
          if (it.run) {
            view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: '' } })
            it.run(view)
          } else snippet(it.insert!)(view, completion, applyFrom, applyTo)
        }
      }))
    if (!options.length) return null
    // Our own filtering (accents optional): CodeMirror must not filter again.
    return { from, options, filter: false }
  }
  return autocompletion({ override: [source], icons: false, activateOnTyping: true, closeOnBlur: true })
}
