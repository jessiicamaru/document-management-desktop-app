import { useCallback, useEffect, useRef, useState } from 'react'
import type { Annotation, DocEntry, DocMeta, HighlightColor } from '../../../shared/types'
import { loadLocal, saveLocal, STATUSES } from '../lib/docs'
import type { ScrollTarget } from '../App'
import HtmlView from './HtmlView'
import MarkdownView from './MarkdownView'
import RawEditor from './RawEditor'
import EpubView from './EpubView'
import PdfView from './PdfView'
import FindBar from './FindBar'
import { HighlightToolbar, NotePopover, NotesPanel } from './Annotations'
import { newAnnotationId, type OutlineItem, type ReaderHandle, type ScreenRect, type TextSelection } from './reader'

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
  onInfo: (text: string) => void
  /** Tells the app whether there are unsaved changes (to warn before leaving). */
  onDirtyChange: (dirty: boolean) => void
  /** App shortcuts typed while an HTML document has the keyboard focus. */
  onShortcut: (key: string) => void
  history: { canBack: boolean; canForward: boolean }
  onHistory: (direction: 'back' | 'forward') => void
  /** Name of the workspace folder this doc is in; null when the workspace has only one folder. */
  rootName: string | null
  /** Highlights and notes of this document. */
  annotations: Annotation[]
  onAnnotationsChange: (items: Annotation[]) => void
  /** Note about the whole document (Markdown). */
  docNote: string
  onDocNoteChange: (text: string) => void
}

const positionKey = (path: string): string => `pos:${path}`

export default function DocView(props: Props) {
  const { doc, meta, allDocs, scrollTarget, onUpdateMeta, onOpenDoc, onError, onInfo, onDirtyChange, rootName } = props
  const [mode, setMode] = useState<Mode>('view')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // File version the text edit started from; the save is refused if the file changed since.
  const [editMtime, setEditMtime] = useState<number | null>(null)
  const [rawDraft, setRawDraft] = useState<string | null>(null)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [activeHeading, setActiveHeading] = useState(-1)
  const [outlineOpen, setOutlineOpen] = useState(() => loadLocal('outline-open', true))
  const [exporting, setExporting] = useState(false)
  const readerRef = useRef<ReaderHandle>(null)
  const [selection, setSelection] = useState<TextSelection | null>(null)
  const [noteEditor, setNoteEditor] = useState<{ id: string; rect: ScreenRect } | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [panelTab, setPanelTab] = useState<'outline' | 'notes'>(() => loadLocal('panel-tab', 'outline'))
  const { annotations, onAnnotationsChange } = props
  /** md and html can be edited and exported; pdf and epub are read-only. */
  const canEdit = doc.kind === 'md' || doc.kind === 'html'

  const updateDirty = useCallback(
    (value: boolean) => {
      setDirty(value)
      onDirtyChange(value)
    },
    [onDirtyChange]
  )

  // ---------- text editing ----------

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
      const change = await readerRef.current?.collectChanges()
      if (change?.kind === 'html' && change.edits.length) await window.api.saveHtmlEdits(doc.path, change.edits, editMtime)
      if (change?.kind === 'md' && change.source !== null) await window.api.writeDoc(doc.path, change.source, editMtime)
      stopEdit()
    } catch (err) {
      onError(err)
      // If the file changed under us, there is nothing safe to retry: reload it.
      if (String(err).includes('thay đổi bên ngoài')) stopEdit()
    } finally {
      setSaving(false)
    }
  }, [mode, editMtime, saving, doc.path, stopEdit, onError])

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

  // ---------- find (Ctrl+F) ----------

  const [findOpen, setFindOpen] = useState(false)
  const [findFocus, setFindFocus] = useState(0)
  useEffect(() => {
    // App sends this for Ctrl+F (typed in the app, an HTML page or a book).
    const open = (): void => {
      if (mode !== 'view') return
      setFindOpen(true)
      setFindFocus((n) => n + 1)
    }
    window.addEventListener('studydocs:find', open)
    return () => window.removeEventListener('studydocs:find', open)
  }, [mode])

  // ---------- outline + reading position ----------

  // The document finished rendering: go back to where you stopped reading last time
  // (unless you followed a link to a specific #section).
  const onReady = useCallback(() => {
    if (scrollTarget.hash || mode !== 'view') return
    const y = loadLocal<number>(positionKey(doc.path), 0)
    if (y > 0) readerRef.current?.restoreScroll(y)
  }, [doc.path, scrollTarget.hash, mode])

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onReading = useCallback(
    (y: number, active: number) => {
      setActiveHeading(active)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => saveLocal(positionKey(doc.path), y), 300)
    },
    [doc.path]
  )

  const toggleOutline = (): void => {
    setOutlineOpen(!outlineOpen)
    saveLocal('outline-open', !outlineOpen)
  }

  // ---------- highlights + notes ----------

  // Draw the highlights whenever they change, and again after text editing ends.
  useEffect(() => {
    if (mode !== 'edit') readerRef.current?.setAnnotations(annotations)
  }, [annotations, mode])

  const saveAnnotation = useCallback(
    async (a: Annotation): Promise<boolean> => {
      try {
        onAnnotationsChange(await window.api.saveAnnotation(doc.path, a))
        return true
      } catch (err) {
        onError(err)
        return false
      }
    },
    [doc.path, onAnnotationsChange, onError]
  )

  /** Turns the current selection into a highlight; optionally opens its note right away. */
  const createHighlight = async (color: HighlightColor, openNote: boolean): Promise<void> => {
    if (!selection) return
    const now = Date.now()
    const a: Annotation = {
      id: newAnnotationId(),
      color,
      note: '',
      quote: selection.quote,
      prefix: selection.prefix,
      suffix: selection.suffix,
      ...(selection.cfi ? { cfi: selection.cfi } : {}),
      ...(selection.page ? { page: selection.page } : {}),
      created: now,
      updated: now
    }
    const rect = selection.rect
    setSelection(null)
    readerRef.current?.clearSelection()
    if ((await saveAnnotation(a)) && openNote) setNoteEditor({ id: a.id, rect })
  }

  const deleteAnnotation = async (id: string): Promise<void> => {
    setNoteEditor(null)
    try {
      onAnnotationsChange(await window.api.deleteAnnotation(doc.path, id))
    } catch (err) {
      onError(err)
    }
  }

  const showPanelTab = (tab: 'outline' | 'notes'): void => {
    setPanelTab(tab)
    saveLocal('panel-tab', tab)
  }
  const editedAnnotation = noteEditor ? annotations.find((a) => a.id === noteEditor.id) : undefined

  // ---------- export ----------

  const exportPdf = async (withNotes: boolean): Promise<void> => {
    if (dirty) return onError(new Error('Hãy lưu thay đổi trước khi xuất PDF.'))
    setExporting(true)
    try {
      const file = await window.api.exportPdf(doc.path, withNotes)
      if (file) onInfo(`Đã xuất PDF: ${file}`)
    } catch (err) {
      onError(err)
    } finally {
      setExporting(false)
    }
  }

  // ---------- layout ----------

  const readerProps = {
    ref: readerRef,
    onOutline: setOutline,
    onReading: (y: number, active: number) => {
      setSelection(null) // the toolbar would float away from the text while scrolling
      onReading(y, active)
    },
    onReady,
    onSelection: setSelection,
    onAnnotationClick: (id: string, rect: ScreenRect) => {
      setSelection(null)
      setNoteEditor({ id, rect })
    },
    onAnchored: setMissing
  }
  const preview =
    doc.kind === 'pdf' ? (
      <PdfView {...readerProps} doc={doc} onError={onError} />
    ) : doc.kind === 'epub' || doc.kind === 'mobi' ? (
      <EpubView {...readerProps} doc={doc} onError={onError} />
    ) : doc.kind === 'html' ? (
      <HtmlView
        {...readerProps}
        doc={doc}
        hash={scrollTarget.hash}
        editMtime={mode === 'edit' ? editMtime : null}
        onDirty={updateDirty}
        onSaveShortcut={() => void saveEdit()}
        onCancelShortcut={cancelEdit}
        onShortcut={props.onShortcut}
      />
    ) : (
      <MarkdownView
        {...readerProps}
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

  const showOutline = mode === 'view' && outlineOpen

  return (
    <div className="doc-view">
      <header className="doc-header">
        <div className="doc-title-row">
          <div className="history-buttons">
            <button className="icon-btn" title="Quay lại (Alt+←)" disabled={!props.history.canBack} onClick={() => props.onHistory('back')}>
              ‹
            </button>
            <button className="icon-btn" title="Tiến tới (Alt+→)" disabled={!props.history.canForward} onClick={() => props.onHistory('forward')}>
              ›
            </button>
          </div>
          <div className="doc-heading">
            <h1 title={doc.title}>{doc.title}</h1>
            <div className="doc-where">
              {rootName && (
                <span className="doc-root" title="Thư mục trong workspace">
                  {rootName}
                </span>
              )}
              <span className="doc-path">{doc.rel}</span>
            </div>
          </div>
        </div>

        {mode === 'edit' ? (
          <div className="doc-controls edit-bar">
            <span className="edit-hint">
              <b>Đang sửa chữ.</b> Bấm vào đoạn văn (hoặc chữ trong sơ đồ) để sửa; Enter và định dạng bị tắt. Muốn đổi bố cục thì dùng Raw.
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
            <button className={`btn ${showOutline ? 'active' : ''}`} onClick={toggleOutline} disabled={mode !== 'view'} title="Hiện/ẩn mục lục và ghi chú">
              Mục lục{annotations.length > 0 && ` · ${annotations.length} ghi chú`}
            </button>
            {canEdit && (
              <>
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
              </>
            )}
            <MoreMenu doc={doc} onError={onError} onExport={canEdit ? exportPdf : null} hasNotes={annotations.length > 0 || !!props.docNote} exporting={exporting} />
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
        <div className={`doc-body ${showOutline ? 'with-outline' : ''}`}>
          <div className="pane">{preview}</div>
          {showOutline && (
            <nav className="outline" aria-label="Mục lục và ghi chú">
              <div className="panel-tabs" role="tablist">
                <button role="tab" aria-selected={panelTab === 'outline'} className={panelTab === 'outline' ? 'active' : ''} onClick={() => showPanelTab('outline')}>
                  Mục lục
                </button>
                <button role="tab" aria-selected={panelTab === 'notes'} className={panelTab === 'notes' ? 'active' : ''} onClick={() => showPanelTab('notes')}>
                  Ghi chú{annotations.length > 0 && ` (${annotations.length})`}
                </button>
              </div>
              {panelTab === 'notes' && (
                <NotesPanel
                  annotations={annotations}
                  missing={missing}
                  onGoto={(a) => readerRef.current?.gotoAnnotation(a.id)}
                  onEdit={(a, rect) => setNoteEditor({ id: a.id, rect })}
                  docNote={props.docNote}
                  onSaveDocNote={async (text) => {
                    try {
                      props.onDocNoteChange(await window.api.saveDocNote(doc.path, text))
                    } catch (err) {
                      onError(err)
                      throw err
                    }
                  }}
                />
              )}
              {panelTab === 'outline' && outline.length === 0 && <div className="empty">Bài này không có tiêu đề nào.</div>}
              {panelTab === 'outline' && outline.map((item, i) => (
                <button
                  key={i}
                  className={`outline-item level-${item.level} ${i === activeHeading ? 'active' : ''}`}
                  onClick={() => readerRef.current?.gotoHeading(i)}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          )}
        </div>
      )}

      {findOpen && mode === 'view' && <FindBar reader={readerRef} focusKey={findFocus} onClose={() => setFindOpen(false)} />}
      {selection && mode === 'view' && (
        <HighlightToolbar rect={selection.rect} onPick={(c) => void createHighlight(c, false)} onNote={() => void createHighlight('yellow', true)} />
      )}
      {editedAnnotation && noteEditor && (
        <NotePopover
          key={editedAnnotation.id}
          annotation={editedAnnotation}
          rect={noteEditor.rect}
          missing={missing.includes(editedAnnotation.id)}
          onSave={(patch) => void saveAnnotation({ ...editedAnnotation, ...patch })}
          onDelete={() => void deleteAnnotation(editedAnnotation.id)}
          onClose={() => setNoteEditor(null)}
        />
      )}
    </div>
  )
}

interface MoreMenuProps {
  doc: DocEntry
  onError: (err: unknown) => void
  /** null when the document can't be exported (PDF, EPUB). */
  onExport: ((withNotes: boolean) => Promise<void>) | null
  hasNotes: boolean
  exporting: boolean
}

function MoreMenu({ doc, onError, onExport, hasNotes, exporting }: MoreMenuProps) {
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
        {exporting ? 'Đang xuất PDF…' : '⋯'}
      </button>
      {open && (
        <div className="popover menu">
          {onExport && (
            <button disabled={exporting} onClick={() => (setOpen(false), void onExport(false))}>
              Xuất PDF…
            </button>
          )}
          {onExport && hasNotes && (
            <button disabled={exporting} onClick={() => (setOpen(false), void onExport(true))}>
              Xuất PDF kèm highlight và ghi chú…
            </button>
          )}
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
