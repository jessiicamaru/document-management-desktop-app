// Create or change a calendar event: title, time, place, colour, notes, and how it repeats.
// Repeats are the quick choices Google Calendar has, plus "Custom…": every N days / weeks /
// months / years, on chosen weekdays, monthly by date or by "the 2nd Tuesday", ending never,
// on a date or after N times. Whatever is picked is saved as a standard RRULE.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildRrule,
  defaultRepeat,
  describeRrule,
  EVENT_COLORS,
  formatShortDate,
  longDay,
  monthlyOn,
  nthOfMonth,
  pad,
  parseLocal,
  REMINDERS,
  reminderLabel,
  parseRrule,
  repeatPresets,
  shiftLocal,
  shiftRule,
  shortDay,
  weekdayOf,
  WEEKDAYS,
  type CalEventData,
  type EditScope,
  type Freq,
  type Repeat
} from '../../../shared/calendar'
import { t } from '../../../shared/i18n'
import { ask } from '../lib/ask'

export interface EditTarget {
  uid: string
  rid: string
  recurring: boolean
  /** The start shown when editing began (moving it moves every class when "all" is chosen). */
  shownStart: string
}

interface Props {
  initial: CalEventData
  /** Null for a new event. */
  editing: EditTarget | null
  onClose: () => void
  /** After saving: the event's UID and the class to show. */
  onSaved: (uid: string, rid: string) => void
  onError: (err: unknown) => void
}

/** Asks which classes a change applies to. Resolves null when cancelled. */
export async function askScope(message: string, allowThis = true): Promise<EditScope | null> {
  const options: { scope: EditScope; label: string }[] = [
    ...(allowThis ? [{ scope: 'this' as const, label: t('Chỉ sự kiện này') }] : []),
    { scope: 'following', label: t('Sự kiện này và các sự kiện sau') },
    { scope: 'all', label: t('Tất cả sự kiện') }
  ]
  const answer = await ask({ message, buttons: [...options.map((o) => o.label), t('Huỷ')], cancelId: options.length, defaultId: 0 })
  return options[answer]?.scope ?? null
}

const FREQ_UNITS: { freq: Freq; label: string }[] = [
  { freq: 'DAILY', label: 'ngày' },
  { freq: 'WEEKLY', label: 'tuần' },
  { freq: 'MONTHLY', label: 'tháng' },
  { freq: 'YEARLY', label: 'năm' }
]

export default function EventDialog({ initial, editing, onClose, onSaved, onError }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [data, setData] = useState<CalEventData>(initial)
  const [custom, setCustom] = useState(() => !!initial.rrule && !repeatPresets(initial.start, initial.allDay).some((p) => sameRule(p.rrule, initial.rrule)) && !!parseRrule(initial.rrule, initial.start))
  const [skipDay, setSkipDay] = useState('')
  const [preview, setPreview] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector<HTMLInputElement>('input[name="summary"]')?.focus()
  }, [])

  const set = (patch: Partial<CalEventData>): void => setData((d) => ({ ...d, ...patch }))

  /** Moves the start, keeping the length, and lets the repeat rule follow the new day. */
  const moveStart = (start: string): void =>
    setData((d) => {
      if (isNaN(parseLocal(start).getTime())) return d
      const length = Math.max(0, minutes(d.start, d.end))
      const end = d.allDay ? shiftLocal(start, Math.max(1440, length)) : shiftLocal(start, length)
      return { ...d, start, end, rrule: shiftRule(d.rrule, d.start, start, d.allDay), exdates: d.exdates }
    })

  const setAllDay = (allDay: boolean): void =>
    setData((d) => {
      if (allDay === d.allDay) return d
      const day = d.start.slice(0, 10)
      const start = allDay ? day : `${day}T${defaultTime()}`
      const end = allDay ? shiftLocal(day, 1440) : shiftLocal(start, 60)
      return { ...d, allDay, start, end, rrule: shiftRule(d.rrule, d.start, start, allDay) }
    })

  const presets = useMemo(() => repeatPresets(data.start, data.allDay), [data.start, data.allDay])
  const presetIndex = presets.findIndex((p) => sameRule(p.rrule, data.rrule))
  const repeat: Repeat | null = data.rrule ? parseRrule(data.rrule, data.start) : null
  const unreadable = !!data.rrule && !repeat
  const setRepeat = (r: Repeat): void => set({ rrule: buildRrule(r, data.start, data.allDay) })

  // The next classes, so you can see the rule does what you meant.
  useEffect(() => {
    if (!data.rrule) {
      setPreview([])
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      window.api
        .calendarPreview(data)
        .then((list) => alive && setPreview(list))
        .catch(() => alive && setPreview([]))
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [data])

  const save = async (): Promise<void> => {
    if (saving) return
    const ruleChanged = editing?.recurring ? !sameRule(initial.rrule, data.rrule) || initial.exdates.join() !== data.exdates.join() : false
    let scope: EditScope = 'all'
    if (editing?.recurring) {
      const chosen = await askScope(t('Lưu thay đổi cho sự kiện lặp lại'), !ruleChanged)
      if (!chosen) return
      scope = chosen
    }
    setSaving(true)
    try {
      if (editing) {
        const uid = await window.api.calendarUpdate(editing.uid, editing.rid, scope, editing.shownStart, data)
        onSaved(uid, scope === 'this' ? editing.rid : data.start)
      } else {
        const uid = await window.api.calendarCreate(data)
        onSaved(uid, data.start)
      }
    } catch (err) {
      onError(err)
      setSaving(false)
    }
  }

  const startDay = data.start.slice(0, 10)
  const startTime = data.start.slice(11, 16)
  // All-day events end the day after their last day; the dialog shows the last day.
  const endDay = data.allDay ? shiftLocal(data.end, -1440) : data.end.slice(0, 10)
  const endTime = data.end.slice(11, 16)
  const { last } = nthOfMonth(data.start)

  return (
    <dialog
      ref={ref}
      className="settings event-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => {
        e.nativeEvent.stopPropagation()
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
      }}
    >
      <header>
        <h2>{editing ? t('Sửa sự kiện') : t('Sự kiện mới')}</h2>
        <button className="icon-btn" aria-label={t('Đóng')} onClick={onClose}>
          ×
        </button>
      </header>
      <form
        className="settings-body event-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <input name="summary" className="event-title" placeholder={t('Tên sự kiện, ví dụ: Lập trình mạng')} value={data.summary} onChange={(e) => set({ summary: e.target.value })} />

        <div className="event-when">
          <input type="date" aria-label={t('Ngày bắt đầu')} value={startDay} onChange={(e) => e.target.value && moveStart(data.allDay ? e.target.value : `${e.target.value}T${startTime}`)} />
          {!data.allDay && <TimeField label={t('Giờ bắt đầu')} value={startTime} onChange={(v) => moveStart(`${startDay}T${v}`)} />}
          <span className="event-dash">–</span>
          {!data.allDay && <TimeField label={t('Giờ kết thúc')} value={endTime} onChange={(v) => set({ end: laterOrSame(data.start, `${data.end.slice(0, 10)}T${v}`) })} />}
          <input
            type="date"
            aria-label={t('Ngày kết thúc')}
            value={endDay}
            min={startDay}
            onChange={(e) => e.target.value && set({ end: data.allDay ? shiftLocal(laterOrSame(startDay, e.target.value), 1440) : laterOrSame(data.start, `${e.target.value}T${endTime}`) })}
          />
          <label className="check">
            <input type="checkbox" checked={data.allDay} onChange={(e) => setAllDay(e.target.checked)} />
            {t('Cả ngày')}
          </label>
        </div>

        <div className="event-row">
          <select
            aria-label={t('Lặp lại')}
            value={!data.rrule ? 'none' : custom || unreadable || presetIndex < 0 ? 'custom' : String(presetIndex)}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'none') {
                setCustom(false)
                set({ rrule: '', exdates: [] })
              } else if (v === 'custom') {
                setCustom(true)
                if (!repeat) setRepeat(defaultRepeat(data.start))
              } else {
                setCustom(false)
                set({ rrule: presets[Number(v)].rrule })
              }
            }}
          >
            <option value="none">{t('Không lặp lại')}</option>
            {presets.map((p, i) => (
              <option key={p.rrule} value={String(i)}>
                {p.label}
              </option>
            ))}
            <option value="custom">{data.rrule && (custom || presetIndex < 0) ? describeRrule(data.rrule, data.start) : t('Tuỳ chỉnh…')}</option>
          </select>
        </div>

        {(custom || (presetIndex < 0 && !!repeat)) && repeat && <CustomRepeat repeat={repeat} start={data.start} last={last} onChange={setRepeat} />}
        {unreadable && <p className="hint">{t('Quy tắc lặp này đến từ lịch khác và được giữ nguyên: {0}', { 0: data.rrule })}</p>}

        {data.rrule && (
          <div className="event-skip">
            <div className="event-skip-head">
              <span>{t('Bỏ qua ngày (nghỉ lễ, tuần thi…)')}</span>
              <input type="date" aria-label={t('Ngày bỏ qua')} value={skipDay} min={startDay} onChange={(e) => setSkipDay(e.target.value)} />
              <button
                type="button"
                className="btn small"
                disabled={!skipDay}
                onClick={() => {
                  set({ exdates: [...new Set([...data.exdates, skipDay])].sort() })
                  setSkipDay('')
                }}
              >
                {t('Bỏ qua')}
              </button>
            </div>
            {data.exdates.length > 0 && (
              <div className="chips">
                {data.exdates.map((d) => (
                  <span key={d} className="chip">
                    {formatShortDate(d)}
                    <button type="button" aria-label={t('Không bỏ qua ngày này nữa')} onClick={() => set({ exdates: data.exdates.filter((x) => x !== d) })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {preview.length > 0 && (
              <p className="hint event-preview">
                {t('Các buổi đầu tiên:')} {preview.map((p) => formatShortDate(p)).join(' · ')}
              </p>
            )}
          </div>
        )}

        <input placeholder={t('Địa điểm, ví dụ: phòng B2')} aria-label={t('Địa điểm')} value={data.location} onChange={(e) => set({ location: e.target.value })} />

        <label className="event-row reminder-row">
          <span>{t('Nhắc')}</span>
          <select aria-label={t('Nhắc trước')} value={String(data.reminder)} onChange={(e) => set({ reminder: Number(e.target.value) })}>
            {REMINDERS.map((m) => (
              <option key={m} value={m}>
                {reminderLabel(m)}
              </option>
            ))}
          </select>
          {data.reminder >= 0 && <span className="hint">{t('Thông báo của Windows, khi app đang mở.')}</span>}
        </label>

        <div className="swatches event-colors" role="radiogroup" aria-label={t('Màu')}>
          <button type="button" role="radio" aria-checked={!data.color} className={`swatch ${!data.color ? 'active' : ''}`} style={{ background: 'var(--accent)' }} title={t('Màu chủ đạo')} onClick={() => set({ color: '' })} />
          {EVENT_COLORS.map((c) => (
            <button type="button" role="radio" aria-checked={data.color === c.name} key={c.name} className={`swatch ${data.color === c.name ? 'active' : ''}`} style={{ background: c.hex }} title={c.name} onClick={() => set({ color: c.name })} />
          ))}
        </div>

        <textarea rows={4} placeholder={t('Ghi chú (giảng viên, link lớp online…)')} aria-label={t('Ghi chú')} value={data.description} onChange={(e) => set({ description: e.target.value })} />
      </form>
      <footer>
        <span className="hint">{t('Ctrl+Enter để lưu')}</span>
        <div className="footer-buttons">
          <button className="btn small" onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button className="btn primary small" disabled={saving} onClick={() => void save()}>
            {saving ? t('Đang lưu…') : t('Lưu')}
          </button>
        </div>
      </footer>
    </dialog>
  )
}

function CustomRepeat({ repeat, start, last, onChange }: { repeat: Repeat; start: string; last: boolean; onChange: (r: Repeat) => void }) {
  const set = (patch: Partial<Repeat>): void => onChange({ ...repeat, ...patch })
  const day = weekdayOf(start)
  const { nth } = nthOfMonth(start)
  return (
    <div className="custom-repeat">
      <div className="event-row">
        <span>{t('Lặp lại mỗi')}</span>
        <input type="number" min={1} max={99} aria-label={t('Khoảng cách')} value={repeat.interval} onChange={(e) => set({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
        <select aria-label={t('Đơn vị')} value={repeat.freq} onChange={(e) => set({ freq: e.target.value as Freq, byDay: repeat.byDay.length ? repeat.byDay : [day] })}>
          {FREQ_UNITS.map((u) => (
            <option key={u.freq} value={u.freq}>
              {t(u.label)}
            </option>
          ))}
        </select>
      </div>

      {repeat.freq === 'WEEKLY' && (
        <div className="weekday-picker" role="group" aria-label={t('Vào các ngày')}>
          {WEEKDAYS.map((d) => {
            const on = repeat.byDay.includes(d)
            return (
              <button
                type="button"
                key={d}
                aria-pressed={on}
                className={on ? 'active' : ''}
                title={longDay(d)}
                onClick={() => {
                  const next = on ? repeat.byDay.filter((x) => x !== d) : [...repeat.byDay, d]
                  set({ byDay: next.length ? next : [day] })
                }}
              >
                {shortDay(d)}
              </button>
            )
          })}
        </div>
      )}

      {repeat.freq === 'MONTHLY' && (
        <div className="radio-list">
          <label>
            <input type="radio" checked={repeat.monthly === 'day'} onChange={() => set({ monthly: 'day' })} />
            {t('Vào {0}', { 0: monthlyOn(start, 'day', 0) })}
          </label>
          <label>
            <input type="radio" checked={repeat.monthly === 'weekday' && repeat.nth !== -1} onChange={() => set({ monthly: 'weekday', nth })} />
            {t('Vào {0}', { 0: monthlyOn(start, 'weekday', nth) })}
          </label>
          {last && (
            <label>
              <input type="radio" checked={repeat.monthly === 'weekday' && repeat.nth === -1} onChange={() => set({ monthly: 'weekday', nth: -1 })} />
              {t('Vào {0}', { 0: monthlyOn(start, 'weekday', -1) })}
            </label>
          )}
        </div>
      )}

      <div className="radio-list">
        <span className="radio-title">{t('Kết thúc')}</span>
        <label>
          <input type="radio" checked={repeat.end === 'never'} onChange={() => set({ end: 'never' })} />
          {t('Không bao giờ')}
        </label>
        <label>
          <input type="radio" checked={repeat.end === 'until'} onChange={() => set({ end: 'until', until: repeat.until || shiftLocal(start.slice(0, 10), 1440 * 7 * 15) })} />
          {t('Vào ngày')}
          <input
            type="date"
            aria-label={t('Ngày kết thúc lặp lại')}
            value={repeat.until}
            min={start.slice(0, 10)}
            disabled={repeat.end !== 'until'}
            onChange={(e) => e.target.value && set({ end: 'until', until: e.target.value })}
          />
        </label>
        <label>
          <input type="radio" checked={repeat.end === 'count'} onChange={() => set({ end: 'count' })} />
          {t('Sau')}
          <input type="number" min={1} max={999} aria-label={t('Số lần')} value={repeat.count} disabled={repeat.end !== 'count'} onChange={(e) => set({ end: 'count', count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} />
          {t('lần')}
        </label>
      </div>
      <p className="hint repeat-summary">{describeRrule(buildRrule(repeat, start, start.length === 10), start)}</p>
    </div>
  )
}

/**
 * A time as hh:mm on a 24-hour clock, whatever the language of Windows (the browser's own time
 * box would show 07:00 SA / 07:00 AM). "7", "7h30", "0730" are understood; ↑/↓ move by 15 minutes.
 */
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  const typing = useRef(false)
  // The time changed elsewhere (moving the start moves the end): show it, unless being typed here.
  useEffect(() => {
    if (!typing.current) setText(value)
  }, [value])
  /** "7" -> 07:00, "7h30" / "7:30" / "0730" -> 07:30; null when it isn't a time. */
  const parse = (input: string): string | null => {
    const digits = input.replace(/[^0-9]/g, '')
    const m = /^(\d{1,2})[^0-9]?(\d{2})?$/.exec(input.trim()) ?? (digits.length >= 3 ? [digits, digits.slice(0, -2), digits.slice(-2)] : null)
    return m ? `${pad(Math.min(23, Number(m[1])))}:${pad(Math.min(59, Number(m[2] ?? 0)))}` : null
  }
  const commit = (input: string): void => {
    typing.current = false
    const v = parse(input)
    setText(v ?? value)
    if (v && v !== value) onChange(v)
  }
  /** While typing, a complete time ("19:30", "1930", "21h") counts at once: saving right away keeps it. */
  const type = (input: string): void => {
    typing.current = true
    setText(input)
    const v = /^\d{1,2}[:h.]\d{0,2}$|^\d{4}$/i.test(input.trim()) ? parse(input) : null
    if (v && v !== value) onChange(v)
  }
  const step = (by: number): void => {
    const [h, mi] = value.split(':').map(Number)
    const total = (((h * 60 + mi + by) % 1440) + 1440) % 1440
    const v = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
    setText(v)
    onChange(v)
  }
  return (
    <input
      className="time-field"
      aria-label={label}
      inputMode="numeric"
      placeholder="hh:mm"
      value={text}
      onChange={(e) => type(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(text)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          step(e.key === 'ArrowUp' ? 15 : -15)
        }
      }}
    />
  )
}

const minutes = (a: string, b: string): number => (parseLocal(b).getTime() - parseLocal(a).getTime()) / 60000
const laterOrSame = (start: string, end: string): string => (end < start ? start : end)
const defaultTime = (): string => '07:00'

/** Two rules mean the same (part order differs between writers). */
export function sameRule(a: string, b: string): boolean {
  const norm = (r: string): string =>
    r
      .replace(/^RRULE:/i, '')
      .toUpperCase()
      .split(';')
      .filter(Boolean)
      .sort()
      .join(';')
  return norm(a) === norm(b)
}
