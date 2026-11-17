import { useState } from 'react'
import type { DocEntry, DocMeta } from '../../../shared/types'
import { docUrl, STATUSES } from '../lib/docs'
import MarkdownView from './MarkdownView'

interface Props {
  doc: DocEntry
  meta: DocMeta
  allDocs: DocEntry[]
  onUpdateMeta: (patch: Partial<DocMeta>) => void
  onOpenDoc: (path: string) => void
}

export default function DocView({ doc, meta, allDocs, onUpdateMeta, onOpenDoc }: Props) {
  return (
    <div className="doc-view">
      <header className="doc-header">
        <div className="doc-heading">
          <h1 title={doc.title}>{doc.title}</h1>
          <div className="doc-path">{doc.path}</div>
        </div>

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
          <button className="btn" onClick={() => window.api.openExternal(doc.path)} title="Mở bằng app mặc định của Windows">
            Mở ngoài
          </button>
          <button className="btn" onClick={() => window.api.revealInFolder(doc.path)} title="Hiện file trong File Explorer">
            Hiện trong thư mục
          </button>
        </div>
      </header>

      <div className="doc-body">
        {doc.kind === 'html' ? (
          // sandbox without "allow-same-origin": the page runs its own CSS/JS
          // but cannot touch the app or your files. ?v= reloads it when the file changes.
          <iframe
            className="html-frame"
            src={`${docUrl(doc.path)}?v=${doc.mtime}`}
            sandbox="allow-scripts allow-popups"
            title={doc.title}
          />
        ) : (
          <MarkdownView doc={doc} allDocs={allDocs} onOpenDoc={onOpenDoc} />
        )}
      </div>
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
