// Calendars followed by link: Google Calendar's "secret address in iCal format", a school
// timetable published online… They are downloaded again every 30 minutes and shown read-only;
// documents can still be linked to their classes. Links stay on this PC (not in backups).

import { useEffect, useRef, useState } from 'react'
import { EVENT_COLORS, type CalSubscription } from '../../../shared/calendar'
import { t } from '../../../shared/i18n'
import { errorMessage } from '../lib/docs'
import { timeAgo } from '../lib/ui'

interface Props {
  onClose: () => void
  /** Something changed: the calendar reloads its events. */
  onChanged: () => void
}

export default function SubscriptionsDialog({ onClose, onChanged }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [subs, setSubs] = useState<CalSubscription[] | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [color, setColor] = useState('teal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ref.current?.showModal()
    window.api.calendarSubscriptions().then(setSubs, (e) => setError(errorMessage(e)))
  }, [])

  const run = async (work: () => Promise<CalSubscription[]>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setSubs(await work())
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="settings subs-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.nativeEvent.stopPropagation()}
    >
      <header>
        <h2>{t('Lịch theo dõi')}</h2>
        <button className="icon-btn" aria-label={t('Đóng')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="settings-body subs-body">
        <p className="hint">
          {t('Dán link lịch dạng iCal để xem các sự kiện ở đây (chỉ xem, vẫn gắn được tài liệu). Google Calendar: Cài đặt lịch → "Địa chỉ bí mật ở định dạng iCal". App tải lại mỗi 30 phút; link chỉ lưu trên máy này, không có trong bản sao lưu.')}
        </p>
        {subs === null ? (
          <p className="hint">…</p>
        ) : subs.length === 0 ? (
          <p className="hint">{t('Chưa theo dõi lịch nào.')}</p>
        ) : (
          <ul className="subs-list">
            {subs.map((s) => (
              <li key={s.id}>
                <span className="event-dot" style={{ background: EVENT_COLORS.find((c) => c.name === s.color)?.hex ?? 'var(--accent)' }} />
                <div className="subs-info">
                  <b>{s.name}</b>
                  <span className={s.error ? 'subs-error' : 'hint'}>
                    {s.error
                      ? s.error
                      : s.fetchedAt
                        ? t('{0} sự kiện · cập nhật {1}', { 0: s.events, 1: timeAgo(s.fetchedAt) })
                        : t('Chưa tải được')}
                  </span>
                </div>
                <button className="btn small danger" disabled={busy} onClick={() => void run(() => window.api.calendarRemoveSubscription(s.id))}>
                  {t('Bỏ theo dõi')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="subs-add"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const list = await window.api.calendarAddSubscription(name, url, color)
              setName('')
              setUrl('')
              return list
            })
          }}
        >
          <h3>{t('Thêm lịch')}</h3>
          <input placeholder={t('Tên, ví dụ: Thời khoá biểu')} aria-label={t('Tên lịch')} value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="https://… / webcal://…" aria-label={t('Link lịch (iCal)')} value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="swatches" role="radiogroup" aria-label={t('Màu')}>
            {EVENT_COLORS.map((c) => (
              <button type="button" role="radio" aria-checked={color === c.name} key={c.name} className={`swatch ${color === c.name ? 'active' : ''}`} style={{ background: c.hex }} title={c.name} onClick={() => setColor(c.name)} />
            ))}
          </div>
          {error && (
            <p className="name-error" role="alert">
              {error}
            </p>
          )}
          <div className="subs-buttons">
            <button type="button" className="btn small" disabled={busy || !subs?.length} onClick={() => void run(() => window.api.calendarRefreshSubscriptions())}>
              {t('Tải lại tất cả')}
            </button>
            <button className="btn primary small" disabled={busy || !url.trim()}>
              {busy ? t('Đang tải…') : t('Theo dõi')}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
