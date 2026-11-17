import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocEntry, DocMeta } from '../../../shared/types'
import { STATUSES } from '../lib/docs'
import type { ScrollTarget } from '../App'
import HtmlView, { type HtmlViewHandle } from './HtmlView'
import MarkdownView, { type MarkdownViewHandle } from './MarkdownView'
import RawEditor from './RawEditor'

/** view = read; edit = change text in place; raw = source editor next to a preview. */
type Mode = 'view' | 'edit' | 'raw'

interface Props {
  doc: DocEntry
  meta: DocMeta
  allDocs: DocEntry[]
  scrollTarget: ScrollTarget
  onUpdateMeta: (patch: Partial<Pick<DocMeta, 'tags' | 'status'>>) => void
  onOpenDoc: (path: string, hash?: string) => void
  onError: (err: unknown) => void
  /** Tells the app whether there are unsaved changes (to warn before leaving). */
  onDirtyChange: (dirty: boolean) => void
}

export default function DocView({ doc, meta, allDocs, scrollTarget, onUpdateMeta, onOpenDoc, onError, onDirtyChange }: Props) {
  const [mode, setMode] = useState<Mode>('view')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // File version the text edit started from; the save is refused if the file changed since.
  const [editMtime, setEditMtime] = useState<number | null>(null)
  const [rawDraft, setRawDraft] = useState<string | null>(null)
  const htmlRef = useRef<HtmlViewHandle>(null)
  const mdRef = useRef<MarkdownViewHandle>(null)

  const updateDirty = useCallback(
    (value: boolean) => {
      setDirty(value)
      onDirtyChange(value)
    },
    [onDirtyChange]
  )

  const startEdit = (): void => {
    setEditMtime(doc.mtime)
    setMode('edit')
  }
  const stopEdit = useCallback((): void => {
    setMode('view')
    setEditMtime(null)
    updateDirty(false)
  }, [updateDirty])

  const cancelEdit = useCallback((): void => {
    if (dirty && !window.confirm('Bỏ các thay đổi chưa lưu?')) return
    stopEdit()
  }, [dirty, stopEdit])

  const saveEdit = useCallback(async (): Promise<void> => {
    if (mode !== 'edit' || editMtime === null || saving) return
    setSaving(true)
    try {
      if (doc.kind === 'html') {
        const edits = (await htmlRef.current?.collectEdits()) ?? []
        if (edits.length) await window.api.saveHtmlEdits(doc.path, edits, editMtime)
      } else {
        const next = mdRef.current?.collectSource()
        if (next !== null && next !== undefined) await window.api.writeDoc(doc.path, next, editMtime)
      }
      stopEdit()
    } catch (err) {
      onError(err)
      // If the file changed under us, there is nothing safe to retry: reload it.
      if (String(err).includes('thay đổi bên ngoài')) stopEdit()
    } finally {
      setSaving(false)
    }
  }, [mode, editMtime, saving, doc.kind, doc.path, stopEdit, onError])

  // Ctrl+S saves and Esc cancels while editing text (the HTML page sends these itself).
  useEffect(() => {
    if (mode !== 'edit') return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveEdit()
      }
      if (e.key === 'Escape') cancelEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, saveEdit, cancelEdit])

  const preview =
    doc.kind === 'html' ? (
      <HtmlView
        ref={htmlRef}
        doc={doc}
        hash={scrollTarget.hash}
        editMtime={mode === 'edit' ? editMtime : null}
        onDirty={updateDirty}
        onSaveShortcut={() => void saveEdit()}
        onCancelShortcut={cancelEdit}
      />
    ) : (
      <MarkdownView
        ref={mdRef}
        doc={doc}
        allDocs={allDocs}
        scrollTarget={scrollTarget}
        editing={mode === 'edit'}
        sourceOverride={mode === 'raw' ? rawDraft : null}
        onDirty={updateDirty}
        onOpenDoc={onOpenDoc}
        onError={onError}
      />
    )

  return (
    <div className="doc-view">
      <header className="doc-header">
        <div className="doc-heading">
          <h1 title={doc.title}>{doc.title}</h1>
          <div className="doc-path">{doc.path}</div>
        </div>

        {mode === 'edit' ? (
          <div className="doc-controls edit-bar">
            <span className="edit-hint">
              <b>Đang sửa chữ.</b> Bấm vào đoạn văn để sửa; Enter và định dạng bị tắt. Muốn đổi bố cục thì dùng Raw.
            </span>
            <div className="spacer" />
            {dirty && <span className="dirty-dot" title="Chưa lưu" />}
            <button className="btn small" onClick={cancelEdit}>
              Huỷ (Esc)
            </button>
            <button className="btn primary small" disabled={saving} onClick={() => void saveEdit()}>
              {saving ? 'Đang lưu…' : 'Lưu (Ctrl+S)'}
            </button>
          </div>
        ) : (
          <div className="doc-controls">
            <div className="segmented" role="group" aria-label="Trạng thái học">
              {STATUSES.map((s) => (
                <button
                  key={s.id}
                  className={`status-${s.id} ${meta.status === s.id ? 'active' : ''}`}
                  onClick={() => onUpdateMeta({ status: s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <TagEditor tags={meta.tags} onChange={(tags) => onUpdateMeta({ tags })} />
            <div className="spacer" />
            <button className="btn" onClick={startEdit} disabled={mode === 'raw'} title="Sửa chữ ngay trên bài">
              Sửa chữ
            </button>
            <button
              className={`btn ${mode === 'raw' ? 'active' : ''}`}
              onClick={() => (mode === 'raw' ? setMode('view') : setMode('raw'))}
              title="Mở mã nguồn để sửa bố cục, sơ đồ..."
            >
              Raw
            </button>
            <MoreMenu doc={doc} onError={onError} />
          </div>
        )}
      </header>

      {mode === 'raw' ? (
        <div className="doc-body split">
          <div className="pane">{preview}</div>
          <div className="pane">
            <RawEditor doc={doc} onClose={() => setMode('view')} onDirty={updateDirty} onDraft={setRawDraft} onError={onError} />
          </div>
        </div>
      ) : (
        <div className="doc-body">{preview}</div>
      )}
    </div>
  )
}

function MoreMenu({ doc, onError }: { doc: DocEntry; onError: (err: unknown) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="more" ref={ref}>
      <button className="btn" aria-label="Thêm" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="popover menu">
          <button onClick={() => (setOpen(false), window.api.openPath(doc.path).catch(onError))}>Mở bằng app mặc định</button>
          <button onClick={() => (setOpen(false), window.api.revealInFolder(doc.path).catch(onError))}>Hiện trong thư mục</button>
        </div>
      )}
    </div>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const t = draft.trim().replace(/^#/, '')
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="tag">
          #{t}
          <button aria-label={`Xoá tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder="+ tag"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
          if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
        }}
        onBlur={add}
      />
    </div>
  )
}
