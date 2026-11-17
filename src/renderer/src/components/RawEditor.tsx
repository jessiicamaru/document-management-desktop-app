import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import type { DocEntry } from '../../../shared/types'
import { detectEol, fromLf, toLf, type Eol } from '../lib/eol'

interface Props {
  doc: DocEntry
  onClose: () => void
  onDirty: (dirty: boolean) => void
  /** Called on every change (debounced), used for the live Markdown preview. */
  onDraft: (content: string | null) => void
  onError: (err: unknown) => void
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** Source code editor (CodeMirror) for changing layout, tags, diagrams... anything. */
export default function RawEditor({ doc, onClose, onDirty, onDraft, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Content (with "\n" line endings, like the editor) and modified time of the file as last
  // loaded/saved: the base for "unsaved?" and conflict checks.
  const base = useRef({ content: '', mtime: doc.mtime })
  // The file's own line endings, put back when saving.
  const eol = useRef<Eol>('\n')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const cb = useRef({ onDirty, onDraft, onError })
  cb.current = { onDirty, onDraft, onError }

  const markDirty = (value: boolean): void => {
    setDirty(value)
    cb.current.onDirty(value)
  }

  const save = async (): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    const content = view.state.doc.toString()
    if (content === base.current.content) return
    setSaving(true)
    try {
      const mtime = await window.api.writeDoc(doc.path, fromLf(content, eol.current), base.current.mtime)
      base.current = { content, mtime }
      markDirty(false)
    } catch (err) {
      cb.current.onError(err)
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // Create the editor once per document.
  useEffect(() => {
    let draftTimer: ReturnType<typeof setTimeout> | undefined
    const theme = new Compartment()
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          doc.kind === 'html' ? html() : markdown(),
          EditorView.lineWrapping,
          theme.of(darkQuery.matches ? oneDark : []),
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(), true) }]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            const content = u.state.doc.toString()
            markDirty(content !== base.current.content)
            clearTimeout(draftTimer)
            draftTimer = setTimeout(() => cb.current.onDraft(content), 250)
          })
        ]
      })
    })
    viewRef.current = view
    const onScheme = (): void => view.dispatch({ effects: theme.reconfigure(darkQuery.matches ? oneDark : []) })
    darkQuery.addEventListener('change', onScheme)

    window.api
      .readDoc(doc.path)
      .then((raw) => {
        eol.current = detectEol(raw)
        const content = toLf(raw)
        base.current = { content, mtime: doc.mtime }
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
        markDirty(false)
        view.focus()
      })
      .catch((err) => cb.current.onError(err))

    return () => {
      clearTimeout(draftTimer)
      darkQuery.removeEventListener('change', onScheme)
      view.destroy()
      cb.current.onDraft(null)
      cb.current.onDirty(false)
    }
  }, [doc.path]) // only doc.path: callbacks are read through refs

  // The file changed on disk (not by us): reload it if you have nothing unsaved.
  useEffect(() => {
    const view = viewRef.current
    if (!view || doc.mtime === base.current.mtime || dirty) return
    window.api
      .readDoc(doc.path)
      .then((raw) => {
        eol.current = detectEol(raw)
        const content = toLf(raw)
        base.current = { content, mtime: doc.mtime }
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
        markDirty(false)
      })
      .catch((err) => cb.current.onError(err))
  }, [doc.mtime]) // only react to the file changing on disk

  return (
    <div className="raw-editor">
      <div className="raw-toolbar">
        <span className="raw-title">
          Raw · {doc.name}
          {dirty && <span className="dirty-dot" title="Chưa lưu" />}
        </span>
        <button className="btn primary small" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu (Ctrl+S)'}
        </button>
        <button
          className="btn small"
          onClick={() => {
            if (dirty && !window.confirm('Đóng raw và bỏ các thay đổi chưa lưu?')) return
            onClose()
          }}
        >
          Đóng raw
        </button>
      </div>
      <div ref={hostRef} className="raw-host" />
    </div>
  )
}
