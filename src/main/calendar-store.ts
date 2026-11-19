// The calendar, stored the standard way: an iCalendar file (RFC 5545) that any calendar app can
// read, next to a small JSON file with what is only the app's own (documents linked to classes,
// where class notes go):
//
//   %APPDATA%\Study Docs\data\calendar.ics    VCALENDAR with one VEVENT per event
//   %APPDATA%\Study Docs\data\calendar.json   { links, notesFolders }
//
// Repeating events use RRULE / EXDATE; a single changed class is its own VEVENT with the same
// UID and a RECURRENCE-ID, as the RFC does it. ical.js reads, writes and expands them.
//
// Same safety rules as the tag/note stores: one write at a time, the state kept in memory,
// and a file that can't be read is copied aside before anything is written.
//
// No Electron imports here, so this file is unit tested directly.

import ICAL from 'ical.js'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  isLocalTime,
  minutesBetween,
  pad,
  parseLocal,
  shiftLocal,
  ymd,
  ymdhm,
  type CalEventData,
  type CalOccurrence,
  type EditScope
} from '../shared/calendar'
import { t } from '../shared/i18n'

/** A document linked to an event. The path is absolute; hash and name find it after a move. */
export interface StoredLink {
  path: string
  name: string
  hash?: string
  /** A folder of the workspace: every document inside it (also ones added later). */
  kind?: 'folder'
}

interface LinkEntry {
  /** Linked to every class (course material). */
  series?: StoredLink[]
  /** Linked to one class, keyed by its RECURRENCE-ID ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"). */
  occ?: Record<string, StoredLink[]>
}

interface LinkFile {
  version: 1
  links: Record<string, LinkEntry>
  notesFolders: Record<string, string>
}

/** What a backup holds of the calendar. */
export interface CalendarBackup {
  ics: string
  links: Record<string, LinkEntry>
  notesFolders: Record<string, string>
}

const PRODID = '-//Study Docs//Calendar//EN'
/** Never expand more occurrences than this for one event and one range (an endless daily rule over years). */
const MAX_EXPAND = 5000

// ---------- time conversion ----------

/** A local time string as an ICAL.Time: a DATE, or a floating DATE-TIME. */
export function toTime(s: string): ICAL.Time {
  const d = parseLocal(s)
  const isDate = s.length === 10
  return ICAL.Time.fromData({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: isDate ? 0 : d.getHours(),
    minute: isDate ? 0 : d.getMinutes(),
    second: 0,
    isDate
  })
}

/** An ICAL.Time as a local time string. Times in UTC or a time zone are shown in this PC's zone. */
export function fromTime(time: ICAL.Time): string {
  if (time.isDate) return `${time.year}-${pad(time.month)}-${pad(time.day)}`
  const tzid = (time.zone as { tzid?: string } | null)?.tzid
  if (tzid && tzid !== 'floating') return ymdhm(time.toJSDate())
  return `${time.year}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}`
}

const nowUtc = (): ICAL.Time => ICAL.Time.fromJSDate(new Date(), true)
const text = (comp: ICAL.Component, name: string): string => {
  const v = comp.getFirstPropertyValue(name)
  return typeof v === 'string' ? v : ''
}
const timeProp = (comp: ICAL.Component, name: string): ICAL.Time | null => {
  const v = comp.getFirstPropertyValue(name)
  return v instanceof ICAL.Time ? v : null
}
const ridOf = (comp: ICAL.Component): string | null => {
  const v = timeProp(comp, 'recurrence-id')
  return v ? fromTime(v) : null
}

/** Start and end of a VEVENT as local strings (a missing end: same day for dates, the start for times). */
function spanOf(comp: ICAL.Component): { start: string; end: string; allDay: boolean } | null {
  const s = timeProp(comp, 'dtstart')
  if (!s) return null
  const start = fromTime(s)
  const e = timeProp(comp, 'dtend')
  let end: string
  if (e) end = fromTime(e)
  else {
    const dur = comp.getFirstPropertyValue('duration')
    if (dur instanceof ICAL.Duration) {
      const x = s.clone()
      x.addDuration(dur)
      end = fromTime(x)
    } else end = s.isDate ? shiftLocal(start, 1440) : start
  }
  return { start, end: end < start ? start : end, allDay: s.isDate }
}

/** Writes the fields of a VEVENT. `rule`: also RRULE and EXDATE (the series, not one class). */
function fillEvent(comp: ICAL.Component, data: CalEventData, rule: boolean): void {
  const start = toTime(data.start)
  const end = toTime(data.end)
  comp.updatePropertyWithValue('dtstart', start)
  comp.removeAllProperties('duration')
  comp.updatePropertyWithValue('dtend', end)
  comp.updatePropertyWithValue('summary', data.summary)
  for (const [name, value] of [
    ['location', data.location],
    ['description', data.description],
    ['color', data.color]
  ] as const) {
    if (value) comp.updatePropertyWithValue(name, value)
    else comp.removeAllProperties(name)
  }
  if (rule) {
    comp.removeAllProperties('rrule')
    if (data.rrule) comp.addPropertyWithValue('rrule', ICAL.Recur.fromString(data.rrule.replace(/^RRULE:/i, '')))
    comp.removeAllProperties('exdate')
    if (data.rrule) {
      for (const day of [...new Set(data.exdates)].sort()) {
        comp.addPropertyWithValue('exdate', toTime(data.allDay ? day : `${day}${data.start.slice(10)}`))
      }
    }
  }
}

/** The first starts of an event as the dialog has it, to preview a repeat rule. */
export function previewStarts(input: Partial<CalEventData>, count = 6): string[] {
  const data = cleanData(input)
  if (!data.rrule) return [data.start]
  const comp = new ICAL.Component('vevent')
  comp.addPropertyWithValue('uid', 'preview')
  fillEvent(comp, data, true)
  const event = new ICAL.Event(comp)
  const it = event.iterator()
  const out: string[] = []
  for (let i = 0, next = it.next(); next && out.length < count && i < MAX_EXPAND; next = it.next(), i++) out.push(fromTime(next))
  return out
}

/**
 * Lets ical.js convert times in the time zones a calendar defines (its VTIMEZONE parts). Without
 * this, 09:00 New York time would be read as 09:00 on this PC. Called before any time is read.
 */
function registerZones(cal: ICAL.Component): void {
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    const id = text(tz, 'tzid')
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz)
  }
}

// ---------- repeats ----------

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * A copy of a daily/weekly series that starts shortly before `from` instead of years earlier,
 * so showing a week of a long series doesn't walk through every earlier class. The classes are
 * the same: the start moves by whole repeat periods, and only for simple rules (no COUNT, which
 * counts from the real start; the start itself is one of the repeated days). Null otherwise.
 */
function fastForward(master: ICAL.Component, from: string): ICAL.Component | null {
  const rule = master.getFirstPropertyValue('rrule')
  const span = spanOf(master)
  if (!(rule instanceof ICAL.Recur) || !span || master.hasProperty('rdate')) return null
  if ((rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY') || rule.count) return null
  const parts = rule.toString().split(';').map((p) => p.split('=')[0].toUpperCase())
  if (parts.some((p) => !['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'WKST'].includes(p))) return null
  const byDay = rule.getComponent('byday') as string[]
  const start = span.start
  // The weekday in the event's own time zone (1 = Sunday in ical.js).
  const first = timeProp(master, 'dtstart')!
  if (byDay.length && !byDay.includes(DAY_CODES[first.dayOfWeek() - 1])) return null
  const period = (rule.interval || 1) * (rule.freq === 'WEEKLY' ? 7 : 1)
  // Whole periods to skip, keeping one period of margin before `from` (events lasting several days).
  const days = Math.floor(minutesBetween(start.slice(0, 10), from) / 1440)
  const skip = Math.floor(days / period) - 1
  if (skip < 1) return null
  // A deep copy: toJSON() hands out the stored data itself, and the original must not move.
  const clone = new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())))
  for (const name of ['dtstart', 'dtend']) {
    const prop = clone.getFirstProperty(name)
    const value = prop?.getFirstValue()
    if (!(value instanceof ICAL.Time)) continue
    const moved = value.clone()
    moved.adjust(skip * period, 0, 0, 0)
    prop!.setValue(moved)
  }
  return clone
}

// ---------- the store ----------

export class CalendarStore {
  readonly icsFile: string
  readonly linksFile: string
  private cal: ICAL.Component = CalendarStore.emptyCalendar()
  private links: Record<string, LinkEntry> = {}
  private notesFolders: Record<string, string> = {}
  private queue: Promise<unknown> = Promise.resolve()
  /** Human-readable problem to show in the UI, if any. */
  warning: string | null = null

  private constructor(readonly dir: string) {
    this.icsFile = path.join(dir, 'calendar.ics')
    this.linksFile = path.join(dir, 'calendar.json')
  }

  static async open(dir: string): Promise<CalendarStore> {
    const store = new CalendarStore(dir)
    await fs.mkdir(dir, { recursive: true })
    await store.load()
    return store
  }

  private static emptyCalendar(): ICAL.Component {
    const cal = new ICAL.Component('vcalendar')
    cal.addPropertyWithValue('prodid', PRODID)
    cal.addPropertyWithValue('version', '2.0')
    cal.addPropertyWithValue('calscale', 'GREGORIAN')
    return cal
  }

  private async load(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let raw: string | null = null
    try {
      raw = await fs.readFile(this.icsFile, 'utf8')
    } catch {
      // no calendar yet
    }
    if (raw !== null && raw.trim()) {
      try {
        const comp = new ICAL.Component(ICAL.parse(raw))
        if (comp.name !== 'vcalendar') throw new Error('not a calendar')
        registerZones(comp)
        this.cal = comp
      } catch {
        await fs.copyFile(this.icsFile, path.join(this.dir, `calendar.corrupt-${stamp}.ics`)).catch(() => {})
        this.warning = t('Không đọc được file lịch. Đã lưu một bản sao (calendar.corrupt-…) trong thư mục dữ liệu và bắt đầu lịch trống.')
      }
    }
    try {
      const parsed = JSON.parse(await fs.readFile(this.linksFile, 'utf8')) as Partial<LinkFile>
      this.links = parsed.links && typeof parsed.links === 'object' ? parsed.links : {}
      this.notesFolders = parsed.notesFolders && typeof parsed.notesFolders === 'object' ? parsed.notesFolders : {}
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        await fs.copyFile(this.linksFile, path.join(this.dir, `calendar.corrupt-${stamp}.json`)).catch(() => {})
        this.warning = t('Không đọc được tài liệu gắn với lịch. Đã lưu một bản sao (calendar.corrupt-…) trong thư mục dữ liệu.')
      }
    }
  }

  /** Writes both files (after the previous write finished). */
  private save(): Promise<void> {
    const ics = this.toIcs()
    const json = JSON.stringify({ version: 1, links: this.links, notesFolders: this.notesFolders } satisfies LinkFile, null, 2)
    const run = this.queue.then(async () => {
      for (const [file, content] of [
        [this.icsFile, ics],
        [this.linksFile, json]
      ]) {
        await fs.writeFile(`${file}.tmp`, content, 'utf8')
        await fs.rename(`${file}.tmp`, file)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  /** The whole calendar as an .ics file (also what is stored). */
  toIcs(): string {
    return this.cal.toString().replace(/\r?\n/g, '\r\n') + '\r\n'
  }

  private events(): ICAL.Component[] {
    return this.cal.getAllSubcomponents('vevent')
  }

  private group(uid: string): { master: ICAL.Component | null; exceptions: ICAL.Component[] } {
    const all = this.events().filter((c) => text(c, 'uid') === uid)
    return { master: all.find((c) => !c.hasProperty('recurrence-id')) ?? null, exceptions: all.filter((c) => c.hasProperty('recurrence-id')) }
  }

  private uids(): string[] {
    return [...new Set(this.events().map((c) => text(c, 'uid')).filter(Boolean))]
  }

  private linkCount(uid: string, rid: string): number {
    const e = this.links[uid]
    return (e?.series?.length ?? 0) + (e?.occ?.[rid]?.length ?? 0)
  }

  /** The fields of one VEVENT. */
  private dataOf(comp: ICAL.Component): CalEventData | null {
    const span = spanOf(comp)
    if (!span) return null
    const rule = comp.getFirstPropertyValue('rrule')
    return {
      summary: text(comp, 'summary'),
      ...span,
      location: text(comp, 'location'),
      description: text(comp, 'description'),
      color: text(comp, 'color'),
      rrule: rule instanceof ICAL.Recur ? rule.toString() : '',
      exdates: comp
        .getAllProperties('exdate')
        .flatMap((p) => p.getValues())
        .filter((v): v is ICAL.Time => v instanceof ICAL.Time)
        .map((v) => fromTime(v).slice(0, 10))
        .sort()
    }
  }

  /** Every occurrence that overlaps [from, to) (local date strings). */
  occurrences(from: string, to: string): CalOccurrence[] {
    const out: CalOccurrence[] = []
    for (const uid of this.uids()) {
      const { master, exceptions } = this.group(uid)
      if (!master) {
        // Changed classes whose series is gone (an imported file): show them as they are.
        for (const ex of exceptions) this.pushSingle(out, ex, uid, from, to, true)
        continue
      }
      if (!master.hasProperty('rrule') && !master.hasProperty('rdate')) {
        this.pushSingle(out, master, uid, from, to, false)
        continue
      }
      const base = fastForward(master, from) ?? master
      const event = new ICAL.Event(base, { exceptions })
      const it = event.iterator()
      for (let i = 0, next = it.next(); next && i < MAX_EXPAND; next = it.next(), i++) {
        const details = event.getOccurrenceDetails(next)
        const start = fromTime(details.startDate)
        const rid = fromTime(details.recurrenceId)
        if (rid >= to && start >= to) break
        const comp = details.item.component
        if (text(comp, 'status').toUpperCase() === 'CANCELLED') continue
        const end = fromTime(details.endDate)
        if (start >= to || (end <= from && !(end === start && start >= from))) continue
        const data = this.dataOf(comp)!
        out.push({
          uid,
          rid,
          summary: data.summary,
          allDay: details.startDate.isDate,
          start,
          end: end < start ? start : end,
          location: data.location,
          description: data.description,
          color: data.color || text(master, 'color'),
          rrule: this.dataOf(master)!.rrule,
          recurring: true,
          overridden: comp !== base,
          links: this.linkCount(uid, rid)
        })
      }
    }
    return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  }

  private pushSingle(out: CalOccurrence[], comp: ICAL.Component, uid: string, from: string, to: string, overridden: boolean): void {
    const data = this.dataOf(comp)
    if (!data || text(comp, 'status').toUpperCase() === 'CANCELLED') return
    if (data.start >= to || (data.end <= from && !(data.end === data.start && data.start >= from))) return
    const rid = ridOf(comp) ?? data.start
    const { exdates: _ex, ...rest } = data
    out.push({ uid, rid, ...rest, rrule: '', recurring: false, overridden, links: this.linkCount(uid, rid) })
  }

  /** One occurrence of an event (its RECURRENCE-ID), or null when it doesn't exist. */
  occurrence(uid: string, rid: string): CalOccurrence | null {
    const { master, exceptions } = this.group(uid)
    if (!master && !exceptions.length) return null
    const from = shiftLocal(rid.slice(0, 10), -1440 * 400)
    const to = shiftLocal(rid.slice(0, 10), 1440 * 400)
    const ex = exceptions.find((c) => ridOf(c) === rid)
    const exStart = ex ? spanOf(ex)?.start : undefined
    const lo = exStart && exStart < from ? exStart.slice(0, 10) : from
    const hi = exStart && exStart >= to ? shiftLocal(exStart.slice(0, 10), 1440) : to
    return this.occurrencesOf(uid, lo, hi).find((o) => o.rid === rid) ?? null
  }

  /** Occurrences of one event in a range. */
  occurrencesOf(uid: string, from: string, to: string): CalOccurrence[] {
    return this.occurrences(from, to).filter((o) => o.uid === uid)
  }

  /** The series as stored (what "all events" edits). */
  series(uid: string): CalEventData | null {
    const { master, exceptions } = this.group(uid)
    const comp = master ?? exceptions[0]
    return comp ? this.dataOf(comp) : null
  }

  isRecurring(uid: string): boolean {
    const m = this.group(uid).master
    return !!m && (m.hasProperty('rrule') || m.hasProperty('rdate'))
  }

  // ---------- changes ----------

  /** Sets the fields of a VEVENT. `rule`: also RRULE and EXDATE (the series, not one class). */
  private writeFields(comp: ICAL.Component, data: CalEventData, rule: boolean): void {
    fillEvent(comp, data, rule)
    this.touch(comp)
  }

  private touch(comp: ICAL.Component): void {
    comp.updatePropertyWithValue('dtstamp', nowUtc())
    comp.updatePropertyWithValue('last-modified', nowUtc())
    comp.updatePropertyWithValue('sequence', Number(comp.getFirstPropertyValue('sequence') ?? 0) + 1)
  }

  /** Creates an event. Resolves with its UID. */
  async create(input: CalEventData): Promise<string> {
    const data = cleanData(input)
    const uid = `${randomUUID()}@studydocs`
    const comp = new ICAL.Component('vevent')
    comp.addPropertyWithValue('uid', uid)
    comp.addPropertyWithValue('created', nowUtc())
    comp.addPropertyWithValue('sequence', -1) // touch() makes it 0
    this.writeFields(comp, data, true)
    this.cal.addSubcomponent(comp)
    await this.save()
    return uid
  }

  /**
   * Changes an event. For a repeating one, `scope` says which classes: only the one starting
   * at `rid`, that one and the following ones (the series is split in two), or all of them.
   * `shownStart` is the start the change was made from, so moving one class by an hour moves
   * every class by an hour when "all" is chosen. Resolves with the UID the changed class has now.
   */
  async update(uid: string, rid: string, scope: EditScope, shownStart: string, input: CalEventData): Promise<string> {
    const data = cleanData(input)
    const { master, exceptions } = this.group(uid)
    if (!master && !exceptions.length) throw new Error(t('Sự kiện này không còn trong lịch.'))
    if (!master || !this.isRecurring(uid)) {
      const comp = master ?? exceptions.find((c) => ridOf(c) === rid) ?? exceptions[0]
      this.writeFields(comp, data, !!master)
      await this.save()
      return uid
    }
    const delta = minutesBetween(shownStart, data.start)
    const first = this.dataOf(master)!.start

    if (scope === 'this') {
      let ex = exceptions.find((c) => ridOf(c) === rid)
      if (!ex) {
        ex = new ICAL.Component('vevent')
        ex.addPropertyWithValue('uid', uid)
        ex.addPropertyWithValue('recurrence-id', toTime(rid))
        ex.addPropertyWithValue('created', nowUtc())
        ex.addPropertyWithValue('sequence', Number(master.getFirstPropertyValue('sequence') ?? 0) - 1)
        this.cal.addSubcomponent(ex)
      }
      this.writeFields(ex, data, false)
      await this.save()
      return uid
    }

    if (scope === 'all' || rid <= first) {
      const old = this.dataOf(master)!
      const duration = minutesBetween(data.start, data.end)
      const start = shiftLocal(old.start, delta)
      const allDayChanged = old.allDay !== data.allDay
      const next: CalEventData = {
        ...data,
        start: allDayChanged ? data.start : start,
        end: allDayChanged ? data.end : shiftLocal(start, duration),
        exdates: data.exdates
      }
      this.writeFields(master, next, true)
      if (delta) this.moveOccurrenceLinks(uid, uid, () => true, delta)
      await this.save()
      return uid
    }

    // This and following: the old series ends before this class, a new series starts here.
    const oldData = this.dataOf(master)!
    const remaining = this.endSeriesBefore(master, uid, rid)
    const newUid = `${randomUUID()}@studydocs`
    let rrule = data.rrule
    if (rrule && rrule === oldData.rrule && /COUNT=\d+/i.test(rrule)) rrule = rrule.replace(/COUNT=\d+/i, `COUNT=${Math.max(1, remaining)}`)
    const comp = new ICAL.Component('vevent')
    comp.addPropertyWithValue('uid', newUid)
    comp.addPropertyWithValue('created', nowUtc())
    comp.addPropertyWithValue('sequence', -1)
    const day = rid.slice(0, 10)
    this.writeFields(comp, { ...data, rrule, exdates: data.exdates.filter((d) => d >= day) }, true)
    this.cal.addSubcomponent(comp)
    const entry = this.links[uid]
    if (entry?.series?.length) this.links[newUid] = { series: [...entry.series] }
    this.moveOccurrenceLinks(uid, newUid, (r) => r >= rid, delta)
    if (this.notesFolders[uid]) this.notesFolders[newUid] = this.notesFolders[uid]
    await this.save()
    return newUid
  }

  /**
   * Ends a series right before the class at `rid`: UNTIL just before it (a COUNT becomes the
   * number of classes left before it), and drops changed classes and skipped dates from there on.
   * Returns how many classes the old COUNT had left from `rid` on (0 without COUNT).
   */
  private endSeriesBefore(master: ICAL.Component, uid: string, rid: string): number {
    const rule = master.getFirstPropertyValue('rrule')
    let remaining = 0
    if (rule instanceof ICAL.Recur) {
      const recur = rule.clone()
      if (recur.count) {
        const before = this.occurrencesOf(uid, '0000-01-01', rid).filter((o) => o.rid < rid).length
        remaining = recur.count - before
      }
      recur.count = null
      const allDay = rid.length === 10
      recur.until = toTime(allDay ? shiftLocal(rid, -1440) : rid)
      if (!allDay) recur.until.adjust(0, 0, 0, -1)
      master.updatePropertyWithValue('rrule', recur)
    }
    for (const ex of this.group(uid).exceptions) if ((ridOf(ex) ?? '') >= rid) this.cal.removeSubcomponent(ex)
    const day = rid.slice(0, 10)
    const keep = master
      .getAllProperties('exdate')
      .flatMap((p) => p.getValues())
      .filter((v): v is ICAL.Time => v instanceof ICAL.Time && fromTime(v).slice(0, 10) < day)
    master.removeAllProperties('exdate')
    for (const v of keep) master.addPropertyWithValue('exdate', v)
    this.touch(master)
    return remaining
  }

  /** Moves links of single classes from one series to another, shifting their keys by `delta` minutes. */
  private moveOccurrenceLinks(fromUid: string, toUid: string, which: (rid: string) => boolean, delta: number): void {
    const occ = this.links[fromUid]?.occ
    if (!occ) return
    const moved: Record<string, StoredLink[]> = {}
    for (const [rid, list] of Object.entries(occ)) {
      if (!which(rid)) continue
      moved[delta ? shiftLocal(rid, delta) : rid] = list
      delete occ[rid]
    }
    const target = (this.links[toUid] ??= {})
    target.occ = { ...(target.occ ?? {}), ...moved }
  }

  /** Deletes an event, one class of it, or that class and the following ones. */
  async delete(uid: string, rid: string, scope: EditScope): Promise<void> {
    const { master, exceptions } = this.group(uid)
    if (!master && !exceptions.length) return
    const first = master ? this.dataOf(master)!.start : ''
    if (scope === 'all' || !master || !this.isRecurring(uid) || (scope === 'following' && rid <= first)) {
      for (const c of [master, ...exceptions]) if (c) this.cal.removeSubcomponent(c)
      delete this.links[uid]
      delete this.notesFolders[uid]
    } else if (scope === 'this') {
      master.addPropertyWithValue('exdate', toTime(rid))
      for (const ex of exceptions) if (ridOf(ex) === rid) this.cal.removeSubcomponent(ex)
      this.touch(master)
      if (this.links[uid]?.occ) delete this.links[uid].occ![rid]
    } else {
      this.endSeriesBefore(master, uid, rid)
      const occ = this.links[uid]?.occ
      for (const r of Object.keys(occ ?? {})) if (r >= rid) delete occ![r]
    }
    await this.save()
  }

  // ---------- documents linked to events ----------

  /** Links of a class: the course's and this class's own. */
  linksOf(uid: string, rid: string): { scope: 'series' | 'this'; link: StoredLink }[] {
    const e = this.links[uid]
    return [
      ...(e?.series ?? []).map((link) => ({ scope: 'series' as const, link })),
      ...(e?.occ?.[rid] ?? []).map((link) => ({ scope: 'this' as const, link }))
    ]
  }

  /** Links a document to the whole course (rid null) or to one class. */
  async link(uid: string, rid: string | null, link: StoredLink, same: (a: string, b: string) => boolean): Promise<void> {
    const e = (this.links[uid] ??= {})
    const list = rid ? ((e.occ ??= {})[rid] ??= []) : (e.series ??= [])
    if (!list.some((l) => same(l.path, link.path))) list.push(link)
    await this.save()
  }

  async unlink(uid: string, rid: string | null, filePath: string, same: (a: string, b: string) => boolean): Promise<void> {
    const e = this.links[uid]
    if (!e) return
    if (rid) {
      if (e.occ?.[rid]) e.occ[rid] = e.occ[rid].filter((l) => !same(l.path, filePath))
      if (e.occ?.[rid]?.length === 0) delete e.occ[rid]
    } else if (e.series) e.series = e.series.filter((l) => !same(l.path, filePath))
    await this.save()
  }

  /** Every place a document is linked: [uid, rid or null for the course]. */
  refsTo(match: (l: StoredLink) => boolean): { uid: string; rid: string | null }[] {
    const out: { uid: string; rid: string | null }[] = []
    for (const [uid, e] of Object.entries(this.links)) {
      if (e.series?.some(match)) out.push({ uid, rid: null })
      for (const [rid, list] of Object.entries(e.occ ?? {})) if (list.some(match)) out.push({ uid, rid })
    }
    return out
  }

  /** A linked file was found at another path (renamed or moved): remember the new one. */
  async updateLinkPath(oldPath: string, next: StoredLink): Promise<void> {
    let changed = false
    for (const e of Object.values(this.links)) {
      for (const list of [e.series ?? [], ...Object.values(e.occ ?? {})]) {
        for (const l of list) {
          if (l.path === oldPath && l.kind !== 'folder') {
            Object.assign(l, next)
            changed = true
          }
        }
      }
    }
    if (changed) await this.save()
  }

  notesFolder(uid: string): string | null {
    return this.notesFolders[uid] ?? null
  }

  async setNotesFolder(uid: string, folder: string): Promise<void> {
    this.notesFolders[uid] = folder
    await this.save()
  }

  // ---------- backup ----------

  backup(): CalendarBackup {
    return { ics: this.toIcs(), links: this.links, notesFolders: this.notesFolders }
  }

  /**
   * Merges a backup or an .ics file in. An event that exists on both sides keeps the version
   * changed last; links are added to the ones here. Resolves with how many events it had.
   */
  async merge(backup: Partial<CalendarBackup>): Promise<number> {
    let incoming: ICAL.Component
    try {
      incoming = new ICAL.Component(ICAL.parse(String(backup.ics ?? '')))
    } catch {
      throw new Error(t('File lịch không đọc được.'))
    }
    if (incoming.name !== 'vcalendar') throw new Error(t('File lịch không đọc được.'))
    // Time zones first: events in them are only read right with their definition, and the
    // calendar written back (and exported) must carry it too.
    registerZones(incoming)
    const known = new Set(this.cal.getAllSubcomponents('vtimezone').map((tz) => text(tz, 'tzid')))
    for (const tz of incoming.getAllSubcomponents('vtimezone')) {
      const id = text(tz, 'tzid')
      if (!id || known.has(id)) continue
      known.add(id)
      this.cal.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(tz.toJSON()))))
    }
    const groups = new Map<string, ICAL.Component[]>()
    for (const c of incoming.getAllSubcomponents('vevent')) {
      const uid = text(c, 'uid')
      if (!uid || !c.hasProperty('dtstart')) continue
      groups.set(uid, [...(groups.get(uid) ?? []), c])
    }
    const changedAt = (comps: ICAL.Component[]): number =>
      Math.max(0, ...comps.map((c) => (timeProp(c, 'last-modified') ?? timeProp(c, 'dtstamp'))?.toUnixTime() ?? 0))
    for (const [uid, comps] of groups) {
      const mine = this.events().filter((c) => text(c, 'uid') === uid)
      if (mine.length && changedAt(mine) >= changedAt(comps)) continue
      for (const c of mine) this.cal.removeSubcomponent(c)
      for (const c of comps) this.cal.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(c.toJSON()))))
    }
    for (const [uid, e] of Object.entries(backup.links ?? {})) {
      if (!e || typeof e !== 'object') continue
      const target = (this.links[uid] ??= {})
      const add = (list: StoredLink[], extra: unknown): StoredLink[] => {
        for (const l of Array.isArray(extra) ? extra : []) {
          if (l && typeof l.path === 'string' && !list.some((x) => x.path === l.path))
            list.push({
              path: l.path,
              name: String(l.name ?? path.basename(l.path)),
              ...(typeof l.hash === 'string' ? { hash: l.hash } : {}),
              ...(l.kind === 'folder' ? { kind: 'folder' as const } : {})
            })
        }
        return list
      }
      if (Array.isArray(e.series)) target.series = add(target.series ?? [], e.series)
      for (const [rid, list] of Object.entries(e.occ ?? {})) {
        target.occ ??= {}
        target.occ[rid] = add(target.occ[rid] ?? [], list)
      }
    }
    for (const [uid, folder] of Object.entries(backup.notesFolders ?? {})) {
      if (typeof folder === 'string' && !this.notesFolders[uid]) this.notesFolders[uid] = folder
    }
    await this.save()
    return groups.size
  }
}

/** Checks and tidies what the dialog sent. */
export function cleanData(input: Partial<CalEventData>): CalEventData {
  const allDay = !!input.allDay
  if (!isLocalTime(input.start, allDay)) throw new Error(t('Thời gian bắt đầu không hợp lệ.'))
  let end = isLocalTime(input.end, allDay) ? input.end : allDay ? shiftLocal(input.start, 1440) : shiftLocal(input.start, 60)
  if (allDay ? end <= input.start : end < input.start) end = allDay ? shiftLocal(input.start, 1440) : input.start
  let rrule = typeof input.rrule === 'string' ? input.rrule.trim().replace(/^RRULE:/i, '') : ''
  if (rrule) {
    if (!/(^|;)FREQ=/i.test(rrule)) throw new Error(t('Quy tắc lặp lại không hợp lệ.'))
    try {
      rrule = ICAL.Recur.fromString(rrule).toString() // written the way it is stored, so rules compare
    } catch {
      throw new Error(t('Quy tắc lặp lại không hợp lệ.'))
    }
  }
  return {
    summary: String(input.summary ?? '').trim().slice(0, 500) || t('(Không có tiêu đề)'),
    allDay,
    start: input.start,
    end,
    location: String(input.location ?? '').trim().slice(0, 500),
    description: String(input.description ?? '').slice(0, 20000),
    color: /^[a-z]{3,20}$|^#[0-9a-f]{6}$/i.test(String(input.color ?? '')) ? String(input.color) : '',
    rrule,
    exdates: Array.isArray(input.exdates) ? input.exdates.filter((d): d is string => isLocalTime(d, true)) : []
  }
}

/** The next start of an event after `now` (else its last one), for "linked to Network Programming, Tue 25/11". */
export function nextStart(store: CalendarStore, uid: string, now = new Date()): CalOccurrence | null {
  const today = ymd(now)
  const ahead = store.occurrencesOf(uid, today, shiftLocal(today, 1440 * 366))
  const upcoming = ahead.find((o) => o.end >= ymdhm(now) || (o.allDay && o.end > today))
  if (upcoming) return upcoming
  const past = store.occurrencesOf(uid, '0000-01-01', today)
  return past[past.length - 1] ?? null
}
