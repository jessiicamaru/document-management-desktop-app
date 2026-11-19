// Pick a document of the library to link to a class (search as you type, accents optional).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocEntry } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { kindLabel, normalize } from '../lib/docs'

interface Props {
  docs: DocEntry[]
  /** Offer "this class / whole course" (repeating events only). */
  recurring: boolean
  onPick: (docId: string, scope: 'this' | 'series') => void
  onClose: () => void
}

export default function DocPicker({ docs, recurring, onPick, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'this' | 'series'>('this')
  useEffect(() => ref.current?.showModal(), [])

  const shown = useMemo(() => {
    const q = normalize(query.trim())
    const list = q ? docs.filter((d) => normalize(`${d.title} ${d.rel}`).includes(q)) : docs
    return list.slice(0, 200)
  }, [docs, query])

  return (
    <dialog
      ref={ref}
      className="settings doc-picker"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.nativeEvent.stopPropagation()}
    >
      <header>
        <h2>{t('Gắn tài liệu')}</h2>
        <button className="icon-btn" aria-label={t('Đóng')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="doc-picker-top">
        <input autoFocus placeholder={t('Tìm tài liệu…')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && shown[0] && onPick(shown[0].path, recurring ? scope : 'series')} />
        {recurring && (
          <div className="segmented plain" role="group" aria-label={t('Gắn vào')}>
            <button className={scope === 'this' ? 'active' : ''} onClick={() => setScope('this')}>
              {t('Buổi này')}
            </button>
            <button className={scope === 'series' ? 'active' : ''} onClick={() => setScope('series')}>
              {t('Cả môn')}
            </button>
          </div>
        )}
      </div>
      <div className="settings-body doc-picker-list">
        {shown.length === 0 && <p className="hint">{t('Không có tài liệu nào khớp.')}</p>}
        {shown.map((d) => (
          <button key={d.path} className="row doc" title={d.rel} onClick={() => onPick(d.path, recurring ? scope : 'series')}>
            <span className={`kind kind-${d.kind}`}>{kindLabel(d.kind)}</span>
            <span className="row-title">{d.title}</span>
            <span className="row-time">{d.rel}</span>
          </button>
        ))}
      </div>
    </dialog>
  )
}
