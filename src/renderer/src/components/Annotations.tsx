// Highlight UI shared by every document type:
//  - HighlightToolbar: appears above selected text (colours + "Ghi chú")
//  - NotePopover: edit a highlight's note / colour, or delete it
//  - NotesPanel: list of a document's highlights in the side panel

import { useEffect, useRef, useState } from 'react'
import type { Annotation, HighlightColor } from '../../../shared/types'
import type { ScreenRect } from './reader'
import { renderNote } from '../lib/note-md'
import { t } from '../../../shared/i18n'

/** A note shown as Markdown. */
function NoteText({ text, className }: { text: string; className: string }) {
  return <div className={`${className} note-md`} dangerouslySetInnerHTML={{ __html: renderNote(text) }} />
}

export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string; css: string }[] = [
  { id: 'yellow', label: 'Vàng', css: '#facc15' },
  { id: 'green', label: 'Xanh lá', css: '#4ade80' },
  { id: 'blue', label: 'Xanh dương', css: '#60a5fa' },
  { id: 'pink', label: 'Hồng', css: '#f472b6' }
]
const colorCss = (c: HighlightColor): string => HIGHLIGHT_COLORS.find((x) => x.id === c)?.css ?? '#facc15'

/** Keeps a floating box inside the window, above (or below) `rect`. */
function placeNear(rect: ScreenRect, width: number, height: number): { left: number; top: number } {
  const left = Math.min(Math.max(8, (rect.left + rect.right) / 2 - width / 2), window.innerWidth - width - 8)
  const above = rect.top - height - 8
  const top = above > 8 ? above : rect.bottom + 8
  // Never outside the window, even if the text is partly scrolled out of view.
  return { left, top: Math.min(Math.max(8, top), window.innerHeight - height - 8) }
}

export function HighlightToolbar({
  rect,
  onPick,
  onNote
}: {
  rect: ScreenRect
  onPick: (color: HighlightColor) => void
  onNote: () => void
}) {
  const pos = placeNear(rect, 230, 40)
  return (
    <div className="hl-toolbar" style={pos} role="toolbar" aria-label="Highlight" onMouseDown={(e) => e.preventDefault()}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c.id} className="hl-swatch" style={{ background: c.css }} title={t('Highlight {0}', { 0: t(c.label).toLowerCase() })} onClick={() => onPick(c.id)} />
      ))}
      <span className="hl-sep" />
      <button className="hl-note-btn" onClick={onNote}>{t('✎ Ghi chú')}</button>
    </div>
  )
}

export function NotePopover({
  annotation,
  rect,
  missing,
  onSave,
  onDelete,
  onClose
}: {
  annotation: Annotation
  rect: ScreenRect
  missing: boolean
  onSave: (patch: Pick<Annotation, 'note' | 'color'>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [note, setNote] = useState(annotation.note)
  const [color, setColor] = useState(annotation.color)
  const ref = useRef<HTMLDivElement>(null)
  const pos = placeNear(rect, 340, 260)

  // Close on outside click or Escape; unsaved typing is kept by saving on close.
  const latest = useRef({ note, color })
  latest.current = { note, color }
  useEffect(() => {
    const finish = (): void => {
      const { note: n, color: c } = latest.current
      if (n !== annotation.note || c !== annotation.color) onSave({ note: n, color: c })
      onClose()
    }
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) finish()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [annotation, onSave, onClose])

  return (
    <div ref={ref} className="note-popover" style={pos} role="dialog" aria-label={t('Ghi chú')}>
      <div className="note-quote" style={{ borderColor: colorCss(color) }}>
        {annotation.quote}
      </div>
      {missing && <div className="note-missing">{t('Đoạn này không còn trong bài (có thể đã bị sửa).')}</div>}
      <textarea
        autoFocus
        value={note}
        placeholder={t('Viết ghi chú… Hỗ trợ Markdown: **đậm**, - danh sách, `code`. (Ctrl+Enter để lưu)')}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            onSave({ note, color })
            onClose()
          }
        }}
      />
      <div className="note-actions">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.id}
            className={`hl-swatch small ${color === c.id ? 'active' : ''}`}
            style={{ background: c.css }}
            title={t(c.label)}
            onClick={() => setColor(c.id)}
          />
        ))}
        <div className="spacer" />
        <button
          className="btn small danger"
          onClick={() => {
            if (!annotation.note.trim() || window.confirm(t('Xoá highlight và ghi chú này?'))) onDelete()
          }}
        >{t('Xoá')}</button>
        <button
          className="btn primary small"
          onClick={() => {
            onSave({ note, color })
            onClose()
          }}
        >{t('Lưu')}</button>
      </div>
    </div>
  )
}

/** The note about the whole document, at the top of the notes panel (issue #21). */
function DocNoteCard({ text, onSave }: { text: string; onSave: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [saving, setSaving] = useState(false)
  const save = async (): Promise<void> => {
    if (draft === text) return setEditing(false)
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch {
      // onSave already showed the error; keep the text so nothing is lost.
    } finally {
      setSaving(false)
    }
  }
  if (editing) {
    return (
      <div className="doc-note editing">
        <textarea
          autoFocus
          value={draft}
          placeholder={t('Ghi chú chung cho cả bài: tóm tắt, câu hỏi, việc cần ôn… Hỗ trợ Markdown.')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
            if (e.key === 'Escape') {
              setDraft(text)
              setEditing(false)
            }
          }}
        />
        <div className="note-actions">
          <span className="hint">{t('Ctrl+Enter để lưu')}</span>
          <div className="spacer" />
          <button
            className="btn small"
            onClick={() => {
              setDraft(text)
              setEditing(false)
            }}
          >{t('Huỷ')}</button>
          <button className="btn primary small" disabled={saving} onClick={() => void save()}>{t('Lưu')}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="doc-note">
      <div className="doc-note-head">
        <span>{t('Ghi chú chung')}</span>
        <button
          className="note-card-edit"
          onClick={() => {
            setDraft(text)
            setEditing(true)
          }}
        >
          {text ? t('Sửa') : t('+ Viết')}
        </button>
      </div>
      {text && <NoteText text={text} className="doc-note-text" />}
    </div>
  )
}

export function NotesPanel({
  annotations,
  missing,
  onGoto,
  onEdit,
  docNote,
  onSaveDocNote
}: {
  annotations: Annotation[]
  missing: string[]
  onGoto: (a: Annotation) => void
  onEdit: (a: Annotation, rect: ScreenRect) => void
  docNote: string
  onSaveDocNote: (text: string) => Promise<void>
}) {
  return (
    <>
      <DocNoteCard key={docNote} text={docNote} onSave={onSaveDocNote} />
      {!annotations.length && <div className="empty">{t('Bôi đen một đoạn trong bài để highlight hoặc ghi chú.')}</div>}
      {annotations.map((a) => (
        <div key={a.id} className={`note-card ${missing.includes(a.id) ? 'missing' : ''}`} style={{ borderLeftColor: colorCss(a.color) }}>
          <button className="note-card-quote" onClick={() => onGoto(a)} title={t('Đi tới đoạn này')}>
            {a.quote}
          </button>
          {a.note && <NoteText text={a.note} className="note-card-text" />}
          {missing.includes(a.id) && <div className="note-missing">{t('Không còn tìm thấy đoạn này trong bài.')}</div>}
          <button
            className="note-card-edit"
            onClick={(e) => onEdit(a, (e.currentTarget as HTMLElement).closest('.note-card')!.getBoundingClientRect())}
          >
            {a.note ? t('Sửa') : t('+ Ghi chú')}
          </button>
        </div>
      ))}
    </>
  )
}
