// Writing a Markdown note: CodeMirror with a live preview (see lib/md-live.ts). What you type is
// exactly what is saved; nothing else in the file is rewritten. Images can be pasted (embedded or
// saved in assets/, see lib/cm-images.ts) or picked with the toolbar.
// Saved by itself a moment after you stop typing; Ctrl+S saves right away; Ctrl+F finds.

import { useEffect, useRef, useState } from 'react'
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import type { DocEntry } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectEol, fromLf, toLf, type Eol } from '../lib/eol'
import { confirmDialog } from '../lib/ask'
import { imageExtensions } from '../lib/cm-images'
import { imageMarkup, imageSource } from '../lib/paste-image'
import { insertLink, livePreview, toggleLinePrefix, wrap } from '../lib/md-live'
import { richBlocks } from '../lib/md-blocks'
import { slashMenu } from '../lib/md-slash'
import { currentUi } from '../lib/settings'

interface Props {
  doc: DocEntry
  onClose: () => void
  onDirty: (dirty: boolean) => void
  onError: (err: unknown) => void
}

export default function MarkdownEditor({ doc, onClose, onDirty, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The file as last loaded/saved (with "\n" line endings), for "unsaved?" and conflict checks.
  const base = useRef({ content: '', mtime: doc.mtime })
  const eol = useRef<Eol>('\n')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Saving by itself stops after a failed save (the file changed elsewhere…) until you save by hand.
  const autoOff = useRef(false)
  const autoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cb = useRef({ onDirty, onError })
  cb.current = { onDirty, onError }

  const markDirty = (value: boolean): void => {
    setDirty(value)
    cb.current.onDirty(value)
  }

  const save = async (auto = false): Promise<boolean> => {
    const view = viewRef.current
    if (!view) return false
    if (auto && autoOff.current) return false
    if (!auto) autoOff.current = false
    clearTimeout(autoTimer.current)
    const content = view.state.doc.toString()
    if (content === base.current.content) return true
    setSaving(true)
    try {
      const mtime = await window.api.writeDoc(doc.path, fromLf(content, eol.current), base.current.mtime)
      base.current = { content, mtime }
      // Typed more while saving: still unsaved.
      markDirty(view.state.doc.toString() !== content)
      setSavedAt(Date.now())
      return true
    } catch (err) {
      if (auto) autoOff.current = true
      cb.current.onError(err)
      return false
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  /** "Done" saves first; only when that fails does it ask whether to drop the changes. */
  const close = async (): Promise<void> => {
    if (dirty && !(await save())) {
      const yes = await confirmDialog({ message: t('Chưa lưu được. Đóng và bỏ các thay đổi chưa lưu?'), ok: t('Bỏ thay đổi'), cancel: t('Tiếp tục viết'), danger: true })
      if (!yes) return
    }
    onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const run = (f: (v: EditorView) => boolean) => (v: EditorView) => f(v)
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          placeholder(t('Viết ở đây… Gõ / để chèn tiêu đề, danh sách, bảng, công thức, sơ đồ, ảnh…')),
          markdown({ base: markdownLanguage }),
          livePreview(() => doc.path),
          // Tables, formulas and Mermaid drawn in place; the / menu inserts blocks.
          richBlocks(() => doc.path),
          slashMenu(() => fileRef.current?.click()),
          imageExtensions(() => doc.path, 'md', (err) => cb.current.onError(err)),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(), true) },
            { key: 'Escape', run: () => (void closeRef.current(), true) },
            { key: 'Mod-b', run: run((v) => wrap(v, '**')) },
            { key: 'Mod-i', run: run((v) => wrap(v, '*')) },
            { key: 'Mod-Shift-x', run: run((v) => wrap(v, '~~')) },
            { key: 'Mod-e', run: run((v) => wrap(v, '`')) },
            { key: 'Mod-k', preventDefault: true, run: run(insertLink) },
            // Enter continues lists and quotes ("- " on the next line); Tab indents a list item.
            ...markdownKeymap,
            indentWithTab,
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            markDirty(u.state.doc.toString() !== base.current.content)
            clearTimeout(autoTimer.current)
            autoTimer.current = setTimeout(() => void saveRef.current(true), 1200)
          })
        ]
      })
    })
    viewRef.current = view
    window.api
      .readDoc(doc.path)
      .then((raw) => {
        eol.current = detectEol(raw)
        const content = toLf(raw)
        base.current = { content, mtime: doc.mtime }
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, selection: { anchor: content.length } })
        markDirty(false)
        view.focus()
      })
      .catch((err) => cb.current.onError(err))
    return () => {
      clearTimeout(autoTimer.current)
      view.destroy()
      cb.current.onDirty(false)
    }
  }, [doc.path]) // only doc.path: callbacks are read through refs

  // The file changed on disk (not by us): reload it if nothing is unsaved.
  useEffect(() => {
    const view = viewRef.current
    if (!view || doc.mtime === base.current.mtime || dirty) return
    window.api
      .readDoc(doc.path)
      .then((raw) => {
        const content = toLf(raw)
        base.current = { content, mtime: doc.mtime }
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
        markDirty(false)
      })
      .catch((err) => cb.current.onError(err))
  }, [doc.mtime]) // only react to the file changing on disk

  const act = (f: (v: EditorView) => boolean) => () => {
    const view = viewRef.current
    if (!view) return
    f(view)
    view.focus()
  }

  const insertImage = async (file: File): Promise<void> => {
    const view = viewRef.current
    if (!view) return
    const src = await imageSource(doc.path, file, currentUi().pasteImages)
    if (!src) return
    const { from, to } = view.state.selection.main
    const insert = imageMarkup('md', src)
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true })
    view.focus()
  }

  const Tool = ({ label, title, onClick }: { label: string; title: string; onClick: () => void }) => (
    <button className="md-tool" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  )

  return (
    <div className="md-editor">
      <div className="md-toolbar" role="toolbar" aria-label={t('Định dạng')}>
        <Tool label="H1" title={t('Tiêu đề lớn')} onClick={act((v) => toggleLinePrefix(v, '# '))} />
        <Tool label="H2" title={t('Tiêu đề mục')} onClick={act((v) => toggleLinePrefix(v, '## '))} />
        <Tool label="H3" title={t('Tiêu đề nhỏ')} onClick={act((v) => toggleLinePrefix(v, '### '))} />
        <span className="md-tool-sep" />
        <Tool label="B" title={t('Đậm (Ctrl+B)')} onClick={act((v) => wrap(v, '**'))} />
        <Tool label="I" title={t('Nghiêng (Ctrl+I)')} onClick={act((v) => wrap(v, '*'))} />
        <Tool label="S" title={t('Gạch ngang (Ctrl+Shift+X)')} onClick={act((v) => wrap(v, '~~'))} />
        <Tool label="</>" title={t('Mã (Ctrl+E)')} onClick={act((v) => wrap(v, '`'))} />
        <span className="md-tool-sep" />
        <Tool label="•" title={t('Danh sách')} onClick={act((v) => toggleLinePrefix(v, '- '))} />
        <Tool label="☐" title={t('Việc cần làm')} onClick={act((v) => toggleLinePrefix(v, '- [ ] '))} />
        <Tool label="❝" title={t('Trích dẫn')} onClick={act((v) => toggleLinePrefix(v, '> '))} />
        <Tool label={t('Link')} title={t('Link (Ctrl+K)')} onClick={act(insertLink)} />
        <Tool label={t('Ảnh')} title={t('Chèn ảnh (hoặc dán ảnh bằng Ctrl+V)')} onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) insertImage(file).catch(onError)
          }}
        />
        <div className="spacer" />
        {dirty ? <span className="dirty-dot" title={t('Chưa lưu')} /> : savedAt && <span className="saved-note">{t('Đã lưu')}</span>}
        <button className="btn primary small" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? t('Đang lưu…') : t('Lưu (Ctrl+S)')}
        </button>
        <button className="btn small" onClick={() => void close()}>
          {t('Xong')}
        </button>
      </div>
      <div ref={hostRef} className="md-editor-host" />
    </div>
  )
}
