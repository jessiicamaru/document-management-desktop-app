// Calendar events follow iCalendar (RFC 5545). This file holds what both sides need:
//  - the event fields the app edits (CalEventData),
//  - the repeat editor's model (Repeat) and its conversion to and from a standard RRULE,
//  - a plain-words summary of a rule ("Every 2 weeks on Tue, Thu, until 31/12/2026").
//
// Times are local wall-clock times ("floating" times in iCalendar terms), written as
//   "YYYY-MM-DD"        an all-day event
//   "YYYY-MM-DDTHH:mm"  a timed event
// so they sort and compare as plain strings. All-day events end on the day after their last day
// (DTEND is exclusive, as in the RFC).

import { getLanguage, t } from './i18n'

/** What the event dialog edits. Stored as a VEVENT (see src/main/calendar-store.ts). */
export interface CalEventData {
  summary: string
  allDay: boolean
  start: string
  end: string
  location: string
  description: string
  /** A CSS colour name (RFC 7986 COLOR), or '' for the accent colour. */
  color: string
  /** A standard RRULE value without the "RRULE:" prefix, or '' when the event does not repeat. */
  rrule: string
  /** Skipped dates of a repeating event (EXDATE), as "YYYY-MM-DD". */
  exdates: string[]
}

/** One occurrence of an event in a date range (a single event has exactly one). */
export interface CalOccurrence extends Omit<CalEventData, 'exdates'> {
  uid: string
  /** Original start of this occurrence (its RECURRENCE-ID); equals `start` unless it was moved. */
  rid: string
  recurring: boolean
  /** This one occurrence was changed on its own. */
  overridden: boolean
  /** How many documents are linked to the course and to this class. */
  links: number
}

/** Which occurrences a change to a repeating event applies to. */
export type EditScope = 'this' | 'following' | 'all'

/** A document linked to an event, as shown in the app. */
export interface CalLinkView {
  /** Document id, or null when the file can't be found right now. */
  id: string | null
  /** Absolute path, as stored. */
  path: string
  title: string
  /** 'series': linked to every class (course material); 'this': to this class only. */
  scope: 'series' | 'this'
}

/** An event with everything the event panel shows. */
export interface CalEventDetail {
  occurrence: CalOccurrence
  /** The whole series as stored (for the dialog's "all events"). */
  series: CalEventData
  links: CalLinkView[]
  /** Where "Notes for this class" puts its files, if chosen. */
  notesFolder: string | null
}

/** A class a document is linked to (shown on the document). */
export interface CalDocRef {
  uid: string
  /** The class it is linked to; null when linked to the whole course. */
  rid: string | null
  summary: string
  color: string
  /** The class shown: the linked one, or for a course the next class (else the last one). */
  at: string
  /** Its start. */
  start: string
  allDay: boolean
}

// ---------- colours ----------

/** Event colours: CSS colour names (what RFC 7986 COLOR holds) with the shade the app draws. */
export const EVENT_COLORS: { name: string; hex: string }[] = [
  { name: 'tomato', hex: '#d9534f' },
  { name: 'darkorange', hex: '#e07b1a' },
  { name: 'goldenrod', hex: '#c9a227' },
  { name: 'seagreen', hex: '#2e8b57' },
  { name: 'teal', hex: '#0f8b8d' },
  { name: 'royalblue', hex: '#4169e1' },
  { name: 'mediumpurple', hex: '#8a6fd1' },
  { name: 'hotpink', hex: '#d6589f' },
  { name: 'slategray', hex: '#6b7b8c' }
]

/** The colour to draw an event in ('' or an unknown name: the accent colour). */
export function colorHex(name: string): string | null {
  const c = EVENT_COLORS.find((x) => x.name === name.toLowerCase())
  if (c) return c.hex
  return /^#[0-9a-f]{6}$/i.test(name) ? name : null
}

// ---------- dates ----------

export const pad = (n: number): string => String(n).padStart(2, '0')

/** "YYYY-MM-DD" of a local date. */
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "YYYY-MM-DDTHH:mm" of a local date and time. */
export const ymdhm = (d: Date): string => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`

/** A local time string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm") as a Date. */
export function parseLocal(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s)
  if (!m) return new Date(NaN)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
}

export const isLocalTime = (s: unknown, allDay: boolean): s is string =>
  typeof s === 'string' && (allDay ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).test(s) && !isNaN(parseLocal(s).getTime())

/** Adds minutes (timed) or days (all-day) to a local time string. */
export function shiftLocal(s: string, minutes: number): string {
  const d = parseLocal(s)
  if (s.length === 10) {
    d.setDate(d.getDate() + Math.round(minutes / 1440))
    return ymd(d)
  }
  d.setMinutes(d.getMinutes() + minutes)
  return ymdhm(d)
}

/** Minutes from a to b (whole days count 1440 each, ignoring daylight saving). */
export function minutesBetween(a: string, b: string): number {
  const da = parseLocal(a)
  const db = parseLocal(b)
  const days = Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000)
  return days * 1440 + (db.getHours() * 60 + db.getMinutes()) - (da.getHours() * 60 + da.getMinutes())
}

const locale = (): string => (getLanguage() === 'vi' ? 'vi-VN' : 'en-GB')

/** "25/11/2026" (vi) or "25 Nov 2026" (en). */
export function formatDate(s: string): string {
  const d = parseLocal(s)
  return getLanguage() === 'vi' ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "T3, 25/11" (vi) or "Tue 25 Nov" (en): a short date with its weekday. */
export function formatShortDate(s: string): string {
  const d = parseLocal(s)
  const day = WEEKDAYS[(d.getDay() + 6) % 7]
  return getLanguage() === 'vi' ? `${shortDay(day)}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : `${shortDay(day)} ${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`
}

/** "07:00–09:30", "Cả ngày", or with dates when it spans days. */
export function formatTimeRange(start: string, end: string, allDay: boolean): string {
  if (allDay) {
    const last = shiftLocal(end, -1440)
    return last > start ? `${formatShortDate(start)} – ${formatShortDate(last)}` : t('Cả ngày')
  }
  const sameDay = start.slice(0, 10) === end.slice(0, 10)
  return sameDay ? `${start.slice(11)}–${end.slice(11)}` : `${formatShortDate(start)} ${start.slice(11)} – ${formatShortDate(end)} ${end.slice(11)}`
}

// ---------- repeat rules ----------

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
/** Monday first, the way school timetables are written. */
export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** What the custom repeat editor can show. Anything else stays as written ("Custom (from calendar)"). */
export interface Repeat {
  freq: Freq
  /** Every N days/weeks/months/years. */
  interval: number
  /** WEEKLY: the days of the week. */
  byDay: Weekday[]
  /** MONTHLY: on day N of the month, or on the Nth (or last) weekday. */
  monthly: 'day' | 'weekday'
  /** MONTHLY by weekday: 1..5, or -1 for the last one. */
  nth: number
  end: 'never' | 'until' | 'count'
  /** "YYYY-MM-DD", the last day an occurrence may start on. */
  until: string
  count: number
}

/** Weekday of a local time string. */
export const weekdayOf = (s: string): Weekday => WEEKDAYS[(parseLocal(s).getDay() + 6) % 7]

/** Which week of the month a date is in (1..5), and whether it is that weekday's last one. */
export function nthOfMonth(s: string): { nth: number; last: boolean } {
  const d = parseLocal(s)
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { nth: Math.ceil(d.getDate() / 7), last: d.getDate() + 7 > daysInMonth }
}

/** A sensible starting point for the custom editor. */
export function defaultRepeat(start: string): Repeat {
  return { freq: 'WEEKLY', interval: 1, byDay: [weekdayOf(start)], monthly: 'day', nth: nthOfMonth(start).nth, end: 'never', until: '', count: 10 }
}

/**
 * Reads an RRULE into the editor's model. Returns null for rules the editor can't show
 * (BYSETPOS, BYWEEKNO, several month days...): those are kept unchanged.
 */
export function parseRrule(rule: string, start: string): Repeat | null {
  if (!rule) return null
  const parts = new Map<string, string>()
  for (const part of rule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = part.split('=')
    if (!k || v === undefined) return null
    parts.set(k.toUpperCase(), v.toUpperCase())
  }
  const freq = parts.get('FREQ') as Freq
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'UNTIL', 'COUNT', 'WKST'])
  if ([...parts.keys()].some((k) => !known.has(k))) return null
  const r = defaultRepeat(start)
  r.freq = freq
  r.byDay = []
  const interval = Number(parts.get('INTERVAL') ?? 1)
  if (!Number.isInteger(interval) || interval < 1) return null
  r.interval = interval

  const byDay = parts.get('BYDAY')?.split(',') ?? []
  const byMonthDay = parts.get('BYMONTHDAY')
  const startDay = parseLocal(start)
  if (freq === 'WEEKLY') {
    if (byMonthDay || parts.has('BYMONTH')) return null
    if (byDay.some((d) => !WEEKDAYS.includes(d as Weekday))) return null
    r.byDay = byDay.length ? WEEKDAYS.filter((d) => byDay.includes(d)) : [weekdayOf(start)]
  } else if (freq === 'MONTHLY') {
    if (parts.has('BYMONTH')) return null
    if (byDay.length) {
      if (byDay.length !== 1 || byMonthDay) return null
      const m = /^(-1|[1-5])(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay[0])
      if (!m || m[2] !== weekdayOf(start)) return null
      r.monthly = 'weekday'
      r.nth = Number(m[1])
    } else if (byMonthDay && Number(byMonthDay) !== startDay.getDate()) return null
  } else if (freq === 'YEARLY') {
    if (byDay.length) return null
    if (byMonthDay && Number(byMonthDay) !== startDay.getDate()) return null
    if (parts.has('BYMONTH') && Number(parts.get('BYMONTH')) !== startDay.getMonth() + 1) return null
  } else if (byDay.length || byMonthDay || parts.has('BYMONTH')) return null

  const until = parts.get('UNTIL')
  const count = parts.get('COUNT')
  if (until && count) return null
  if (until) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(until)
    if (!m) return null
    r.end = 'until'
    r.until = `${m[1]}-${m[2]}-${m[3]}`
  } else if (count) {
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1) return null
    r.end = 'count'
    r.count = n
  }
  return r
}

/** Writes the editor's model as a standard RRULE (for an event starting at `start`). */
export function buildRrule(r: Repeat, start: string, allDay: boolean): string {
  const parts = [`FREQ=${r.freq}`]
  const interval = Math.max(1, Math.floor(r.interval) || 1)
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (r.freq === 'WEEKLY') {
    const days = WEEKDAYS.filter((d) => r.byDay.includes(d))
    parts.push(`BYDAY=${(days.length ? days : [weekdayOf(start)]).join(',')}`)
  } else if (r.freq === 'MONTHLY') {
    parts.push(r.monthly === 'weekday' ? `BYDAY=${r.nth === -1 ? -1 : nthOfMonth(start).nth}${weekdayOf(start)}` : `BYMONTHDAY=${parseLocal(start).getDate()}`)
  }
  if (r.end === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) {
    // UNTIL has the same type as DTSTART: a date, or a local (floating) date-time.
    const day = r.until.replace(/-/g, '')
    parts.push(`UNTIL=${allDay ? day : `${day}T235959`}`)
  } else if (r.end === 'count') {
    parts.push(`COUNT=${Math.max(1, Math.floor(r.count) || 1)}`)
  }
  return parts.join(';')
}

/** The quick choices of the repeat menu, for an event starting at `start`. */
export function repeatPresets(start: string, allDay: boolean): { rrule: string; label: string }[] {
  const day = weekdayOf(start)
  const { nth, last } = nthOfMonth(start)
  const base = { ...defaultRepeat(start) }
  const presets: Repeat[] = [
    { ...base, freq: 'DAILY' },
    { ...base, freq: 'WEEKLY', byDay: [day] },
    { ...base, freq: 'WEEKLY', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] },
    { ...base, freq: 'MONTHLY', monthly: 'day' },
    { ...base, freq: 'MONTHLY', monthly: 'weekday', nth },
    ...(last ? [{ ...base, freq: 'MONTHLY' as const, monthly: 'weekday' as const, nth: -1 }] : []),
    { ...base, freq: 'YEARLY' }
  ]
  return presets.map((r) => {
    const rrule = buildRrule(r, start, allDay)
    return { rrule, label: describeRrule(rrule, start) }
  })
}

const SHORT_DAYS: Record<Weekday, string> = { MO: 'T2', TU: 'T3', WE: 'T4', TH: 'T5', FR: 'T6', SA: 'T7', SU: 'CN' }
const LONG_DAYS: Record<Weekday, string> = { MO: 'thứ Hai', TU: 'thứ Ba', WE: 'thứ Tư', TH: 'thứ Năm', FR: 'thứ Sáu', SA: 'thứ Bảy', SU: 'Chủ nhật' }
const ORDINALS = ['thứ nhất', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm']

/** "T3" / "Tue". */
export const shortDay = (d: Weekday): string => t(SHORT_DAYS[d])
/** "thứ Ba" / "Tuesday". */
export const longDay = (d: Weekday): string => t(LONG_DAYS[d])

/** "ngày 25", "thứ Ba tuần thứ hai", "thứ Sáu cuối cùng của tháng" (the "on ..." of a monthly rule). */
export function monthlyOn(start: string, monthly: Repeat['monthly'], nth: number): string {
  if (monthly === 'day') return t('ngày {0}', { 0: parseLocal(start).getDate() })
  const day = longDay(weekdayOf(start))
  return nth === -1 ? t('{0} cuối cùng của tháng', { 0: day }) : t('{0} tuần {1}', { 0: day, 1: t(ORDINALS[Math.min(5, Math.max(1, nth)) - 1]) })
}

/** A rule in plain words, e.g. "Mỗi 2 tuần vào T3, T5, đến 31/12/2026". */
export function describeRrule(rule: string, start: string): string {
  if (!rule) return t('Không lặp lại')
  const r = parseRrule(rule, start)
  if (!r) return t('Tuỳ chỉnh (từ lịch gốc)')
  const n = r.interval
  let text: string
  if (r.freq === 'DAILY') text = n === 1 ? t('Hằng ngày') : t('Mỗi {0} ngày', { 0: n })
  else if (r.freq === 'WEEKLY') {
    const weekdays = r.byDay.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => r.byDay.includes(d as Weekday))
    if (weekdays && n === 1) text = t('Các ngày trong tuần (T2–T6)')
    else {
      const days = r.byDay.map(shortDay).join(', ')
      text = n === 1 ? t('Hằng tuần vào {0}', { 0: days }) : t('Mỗi {0} tuần vào {1}', { 0: n, 1: days })
    }
  } else if (r.freq === 'MONTHLY') {
    const on = monthlyOn(start, r.monthly, r.nth)
    text = n === 1 ? t('Hằng tháng vào {0}', { 0: on }) : t('Mỗi {0} tháng vào {1}', { 0: n, 1: on })
  } else {
    const d = parseLocal(start)
    const on = getLanguage() === 'vi' ? `${d.getDate()}/${d.getMonth() + 1}` : d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' })
    text = n === 1 ? t('Hằng năm vào {0}', { 0: on }) : t('Mỗi {0} năm vào {1}', { 0: n, 1: on })
  }
  if (r.end === 'until') text += t(', đến {0}', { 0: formatDate(r.until) })
  else if (r.end === 'count') text += t(', {0} lần', { 0: r.count })
  return text
}

/**
 * A rule for an event that moved from `oldStart` to `newStart`: "weekly on Tue" becomes
 * "weekly on Wed" when the class moves a day later, "monthly on day 3" follows the new date.
 * Rules the editor can't show are kept as they are.
 */
export function shiftRule(rule: string, oldStart: string, newStart: string, allDay: boolean): string {
  const r = rule ? parseRrule(rule, oldStart) : null
  if (!r) return rule
  const days = Math.round(minutesBetween(oldStart.slice(0, 10), newStart.slice(0, 10)) / 1440)
  if (r.freq === 'WEEKLY') r.byDay = r.byDay.map((d) => WEEKDAYS[(((WEEKDAYS.indexOf(d) + days) % 7) + 7) % 7])
  if (r.freq === 'MONTHLY' && r.monthly === 'weekday' && r.nth !== -1) r.nth = nthOfMonth(newStart).nth
  if (r.freq === 'MONTHLY' && r.monthly === 'weekday' && r.nth === -1 && !nthOfMonth(newStart).last) r.nth = nthOfMonth(newStart).nth
  return buildRrule(r, newStart, allDay)
}
