// CodeMirror pieces shared by Raw and the Markdown editor:
//  - pasting an image inserts it (embedded as base64, or saved in assets/; see paste-image.ts);
//  - the long base64 text of embedded images is folded into a small label ("[ảnh 240 KB]").
//    The label is one unit for the cursor: Backspace removes the whole image.

import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { t } from '../../../shared/i18n'
import { imageFrom, imageMarkup, imageSource, sizeLabel } from './paste-image'
import { currentUi } from './settings'

/** base64 of an embedded image, long enough to be worth folding. */
const DATA_URL = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]{120,}/g

class DataUrlWidget extends WidgetType {
  constructor(readonly bytes: number) {
    super()
  }
  eq(other: DataUrlWidget): boolean {
    return other.bytes === this.bytes
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-data-url'
    el.textContent = t('[ảnh {0}]', { 0: sizeLabel(this.bytes) })
    el.title = t('Ảnh nhúng trong file (base64). Xoá nhãn này là xoá ảnh.')
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}

function fold(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = state.doc.toString()
  DATA_URL.lastIndex = 0
  for (let m = DATA_URL.exec(text); m; m = DATA_URL.exec(text)) {
    const bytes = Math.round(((m[0].length - m[0].indexOf(',') - 1) * 3) / 4)
    builder.add(m.index, m.index + m[0].length, Decoration.replace({ widget: new DataUrlWidget(bytes) }))
  }
  return builder.finish()
}

const folded = StateField.define<DecorationSet>({
  create: fold,
  update: (value, tr) => (tr.docChanged ? fold(tr.state) : value),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))]
})

/** Folding of embedded images + pasting images, for a note of this kind. */
export function imageExtensions(docId: () => string, kind: 'md' | 'html', onError: (err: unknown) => void): Extension {
  return [
    folded,
    EditorView.domEventHandlers({
      paste(e, view) {
        const file = imageFrom(e.clipboardData)
        if (!file) return false
        e.preventDefault()
        const { from, to } = view.state.selection.main
        imageSource(docId(), file, currentUi().pasteImages)
          .then((src) => {
            if (!src) return
            const insert = imageMarkup(kind, src)
            view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true })
            view.focus()
          })
          .catch(onError)
        return true
      }
    })
  ]
}
