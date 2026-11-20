import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ICAL from 'ical.js'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRrule, describeRrule, parseRrule, repeatPresets, type CalEventData } from '../src/shared/calendar'
import { CalendarStore, nextStart } from '../src/main/calendar-store'
import { ymdhm } from '../src/shared/calendar'
import { setLanguage } from '../src/shared/i18n'
import { folderChoices } from '../src/renderer/src/lib/docs'
import type { DocEntry } from '../src/shared/types'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'cal-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  setLanguage('vi')
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Tuesday 3 Nov 2026, 07:00–09:30, weekly. */
const lesson = (extra: Partial<CalEventData> = {}): CalEventData => ({
  summary: 'Lập trình mạng',
  allDay: false,
  start: '2026-11-03T07:00',
  end: '2026-11-03T09:30',
  location: 'B2',
  description: '',
  color: 'royalblue',
  rrule: 'FREQ=WEEKLY;BYDAY=TU',
  exdates: [],
  reminder: -1,
  ...extra
})
const starts = (store: CalendarStore, from = '2026-11-01', to = '2026-12-31'): string[] => store.occurrences(from, to).map((o) => o.start)
const same = (a: string, b: string): boolean => a === b

describe('repeat rules', () => {
  it('reads and writes what the custom editor shows', () => {
    const start = '2026-11-10T07:00' // a Tuesday, 2nd of the month
    const r = parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T235959', start)!
    expect(r).toMatchObject({ freq: 'WEEKLY', interval: 2, byDay: ['TU', 'TH'], end: 'until', until: '2026-12-31' })
    expect(buildRrule(r, start, false)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T235959')
    expect(buildRrule({ ...r, freq: 'MONTHLY', monthly: 'weekday', end: 'count', count: 5 }, start, false)).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU;COUNT=5')
    expect(buildRrule({ ...r, freq: 'MONTHLY', monthly: 'weekday', nth: -1, end: 'never' }, '2026-11-24', true)).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=-1TU')
    expect(buildRrule({ ...r, freq: 'DAILY', interval: 1, end: 'until' }, '2026-11-10', true)).toBe('FREQ=DAILY;UNTIL=20261231')
  })

  it('keeps rules it cannot show as they are', () => {
    expect(parseRrule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '2026-11-30')).toBeNull()
    expect(parseRrule('FREQ=WEEKLY;BYDAY=2TU', '2026-11-10')).toBeNull()
    expect(describeRrule('FREQ=YEARLY;BYWEEKNO=20', '2026-11-10')).toBe('Tuỳ chỉnh (từ lịch gốc)')
  })

  it('describes rules in words, in both languages', () => {
    expect(describeRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T235959', '2026-11-10T07:00')).toBe('Mỗi 2 tuần vào T3, T5, đến 31/12/2026')
    expect(describeRrule('FREQ=MONTHLY;BYDAY=-1FR', '2026-11-27')).toBe('Hằng tháng vào thứ Sáu cuối cùng của tháng')
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-11-10')).toBe('Các ngày trong tuần (T2–T6)')
    expect(describeRrule('FREQ=DAILY;COUNT=10', '2026-11-10')).toBe('Hằng ngày, 10 lần')
    setLanguage('en')
    expect(describeRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', '2026-11-10T07:00')).toBe('Every 2 weeks on Tue, Thu')
    expect(describeRrule('FREQ=MONTHLY;BYDAY=2TU', '2026-11-10')).toBe('Monthly on the second Tuesday')
  })

  it('offers the last weekday of the month only when the date is in the last week', () => {
    expect(repeatPresets('2026-11-24', true).some((p) => p.rrule.includes('-1TU'))).toBe(true)
    expect(repeatPresets('2026-11-10', true).some((p) => p.rrule.includes('-1TU'))).toBe(false)
  })
})

describe('CalendarStore', () => {
  it('stores events as a standard iCalendar file and expands repeats', async () => {
    const dir = tmp()
    const store = await CalendarStore.open(dir)
    const uid = await store.create(lesson({ rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261119T235959', exdates: ['2026-11-12'] }))
    expect(starts(store)).toEqual(['2026-11-03T07:00', '2026-11-05T07:00', '2026-11-10T07:00', '2026-11-17T07:00', '2026-11-19T07:00'])

    const ics = readFileSync(path.join(dir, 'calendar.ics'), 'utf8')
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
    for (const line of ['VERSION:2.0', 'PRODID:-//Study Docs//Calendar//EN', `UID:${uid}`, 'DTSTART:20261103T070000', 'DTEND:20261103T093000', 'SUMMARY:Lập trình mạng', 'LOCATION:B2', 'COLOR:royalblue', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261119T235959', 'EXDATE:20261112T070000'])
      expect(ics).toContain(`${line}\r\n`)
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/)
    // Another iCalendar reader sees the same events.
    const parsed = new ICAL.Component(ICAL.parse(ics))
    expect(parsed.getAllSubcomponents('vevent')).toHaveLength(1)

    const again = await CalendarStore.open(dir)
    expect(starts(again)).toEqual(starts(store))
  })

  it('all-day events use DATE values and an exclusive end', async () => {
    const dir = tmp()
    const store = await CalendarStore.open(dir)
    await store.create(lesson({ summary: 'Tuần thi', allDay: true, start: '2026-12-14', end: '2026-12-19', rrule: '' }))
    const ics = readFileSync(path.join(dir, 'calendar.ics'), 'utf8')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261214\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20261219\r\n')
    expect(store.occurrences('2026-12-18', '2026-12-19').map((o) => o.summary)).toEqual(['Tuần thi'])
    expect(store.occurrences('2026-12-19', '2026-12-20')).toEqual([])
  })

  it('changes one class: a RECURRENCE-ID override, the others stay', async () => {
    const store = await CalendarStore.open(tmp())
    const uid = await store.create(lesson())
    await store.update(uid, '2026-11-10T07:00', 'this', '2026-11-10T07:00', lesson({ start: '2026-11-11T13:00', end: '2026-11-11T15:30', location: 'C5', rrule: '' }))
    const occ = store.occurrences('2026-11-01', '2026-11-20')
    expect(occ.map((o) => `${o.start} ${o.location}`)).toEqual(['2026-11-03T07:00 B2', '2026-11-11T13:00 C5', '2026-11-17T07:00 B2'])
    expect(occ[1]).toMatchObject({ rid: '2026-11-10T07:00', overridden: true })
    expect(store.toIcs()).toContain('RECURRENCE-ID:20261110T070000\r\n')
  })

  it('changes all classes: moving one class by an hour moves every class', async () => {
    const store = await CalendarStore.open(tmp())
    const uid = await store.create(lesson())
    await store.link(uid, '2026-11-10T07:00', { path: 'D:/notes/b2.md', name: 'b2.md' }, same)
    await store.update(uid, '2026-11-10T07:00', 'all', '2026-11-10T07:00', lesson({ start: '2026-11-10T08:00', end: '2026-11-10T10:00', summary: 'LT mạng' }))
    const occ = store.occurrences('2026-11-01', '2026-11-20')
    expect(occ.map((o) => `${o.start}-${o.end.slice(11)} ${o.summary}`)).toEqual(['2026-11-03T08:00-10:00 LT mạng', '2026-11-10T08:00-10:00 LT mạng', '2026-11-17T08:00-10:00 LT mạng'])
    // The class's own links follow it.
    expect(store.linksOf(uid, '2026-11-10T08:00')).toHaveLength(1)
  })

  it('changes this and following classes: the series is split in two', async () => {
    const store = await CalendarStore.open(tmp())
    const uid = await store.create(lesson({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=6' }))
    await store.link(uid, null, { path: 'D:/notes/syllabus.pdf', name: 'syllabus.pdf' }, same)
    await store.link(uid, '2026-11-24T07:00', { path: 'D:/notes/b4.md', name: 'b4.md' }, same)
    await store.setNotesFolder(uid, 'D:/notes')
    const newUid = await store.update(uid, '2026-11-17T07:00', 'following', '2026-11-17T07:00', lesson({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=6', start: '2026-11-17T13:00', end: '2026-11-17T15:00' }))
    expect(newUid).not.toBe(uid)
    const occ = store.occurrences('2026-11-01', '2027-01-31')
    expect(occ.map((o) => o.start)).toEqual(['2026-11-03T07:00', '2026-11-10T07:00', '2026-11-17T13:00', '2026-11-24T13:00', '2026-12-01T13:00', '2026-12-08T13:00'])
    expect(store.series(uid)!.rrule).toBe('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117T065959')
    expect(store.series(newUid)!.rrule).toBe('FREQ=WEEKLY;COUNT=4;BYDAY=TU')
    expect(store.linksOf(newUid, '2026-11-24T13:00').map((l) => `${l.scope} ${l.link.name}`)).toEqual(['series syllabus.pdf', 'this b4.md'])
    expect(store.notesFolder(newUid)).toBe('D:/notes')
  })

  it('deletes one class (EXDATE), the following ones (UNTIL), or all', async () => {
    const store = await CalendarStore.open(tmp())
    const uid = await store.create(lesson())
    await store.delete(uid, '2026-11-10T07:00', 'this')
    expect(starts(store, '2026-11-01', '2026-11-20')).toEqual(['2026-11-03T07:00', '2026-11-17T07:00'])
    expect(store.series(uid)!.exdates).toEqual(['2026-11-10'])
    await store.delete(uid, '2026-11-24T07:00', 'following')
    expect(starts(store, '2026-11-01', '2027-03-01')).toEqual(['2026-11-03T07:00', '2026-11-17T07:00'])
    await store.delete(uid, '2026-11-03T07:00', 'all')
    expect(starts(store)).toEqual([])
    expect(store.toIcs()).not.toContain('VEVENT')
  })

  it('finds where a document is linked and follows it when it moves', async () => {
    const store = await CalendarStore.open(tmp())
    const uid = await store.create(lesson())
    await store.link(uid, '2026-11-10T07:00', { path: 'D:/notes/b2.md', name: 'b2.md', hash: 'abc' }, same)
    await store.link(uid, '2026-11-10T07:00', { path: 'D:/notes/b2.md', name: 'b2.md', hash: 'abc' }, same)
    expect(store.linksOf(uid, '2026-11-10T07:00')).toHaveLength(1)
    expect(store.occurrences('2026-11-10', '2026-11-11')[0].links).toBe(1)
    await store.updateLinkPath('D:/notes/b2.md', { path: 'D:/notes/mang/b2.md', name: 'b2.md', hash: 'abc' })
    expect(store.refsTo((l) => l.path === 'D:/notes/mang/b2.md')).toEqual([{ uid, rid: '2026-11-10T07:00' }])
    await store.unlink(uid, '2026-11-10T07:00', 'D:/notes/mang/b2.md', same)
    expect(store.refsTo(() => true)).toEqual([])
  })

  it('merges a backup: keeps the newer copy of an event, adds the rest', async () => {
    const a = await CalendarStore.open(tmp())
    const uid = await a.create(lesson())
    await a.link(uid, null, { path: 'D:/x.pdf', name: 'x.pdf' }, same)
    const backup = a.backup()
    const b = await CalendarStore.open(tmp())
    expect(await b.merge(backup)).toBe(1)
    expect(b.occurrences('2026-11-03', '2026-11-04')[0]).toMatchObject({ uid, summary: 'Lập trình mạng', links: 1 })
    await b.merge(backup)
    expect(b.occurrences('2026-11-03', '2026-11-04')).toHaveLength(1)
    await expect(b.merge({ ics: 'not a calendar' })).rejects.toThrow()
  })

  it('reads events from other calendar apps (UTC times, DURATION, cancelled classes)', async () => {
    const store = await CalendarStore.open(tmp())
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'BEGIN:VEVENT',
      'UID:abc@google.com',
      'DTSTAMP:20261101T000000Z',
      'DTSTART;VALUE=DATE:20261105',
      'DURATION:P1D',
      'SUMMARY:Nộp bài',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:x@google.com',
      'DTSTAMP:20261101T000000Z',
      'DTSTART;VALUE=DATE:20261102',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Ôn',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:x@google.com',
      'DTSTAMP:20261101T000000Z',
      'RECURRENCE-ID;VALUE=DATE:20261103',
      'DTSTART;VALUE=DATE:20261103',
      'STATUS:CANCELLED',
      'SUMMARY:Ôn',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    await store.merge({ ics })
    expect(store.occurrences('2026-11-01', '2026-11-10').map((o) => `${o.start} ${o.summary}`)).toEqual(['2026-11-02 Ôn', '2026-11-04 Ôn', '2026-11-05 Nộp bài'])
  })

  it('a broken calendar file is copied aside, not lost', async () => {
    const dir = tmp()
    const { writeFileSync, readdirSync } = await import('node:fs')
    writeFileSync(path.join(dir, 'calendar.ics'), 'BEGIN:VCALENDAR\r\nthis is not ical')
    const store = await CalendarStore.open(dir)
    expect(store.warning).toBeTruthy()
    expect(readdirSync(dir).some((f) => f.startsWith('calendar.corrupt-'))).toBe(true)
  })

  it('finds the next class of a course', async () => {
    const store = await CalendarStore.open(tmp())
    const uid = await store.create(lesson())
    expect(nextStart(store, uid, new Date(2026, 10, 12, 12))?.start).toBe('2026-11-17T07:00')
  })
})

describe('linking folders', () => {
  it('lists every workspace folder and sub-folder with how many documents it holds', () => {
    const doc = (root: string, rel: string): DocEntry => ({ path: `${root}/${rel}`, root, rel, name: rel.split('/').pop()!, kind: 'md', title: rel, size: 1, mtime: 1 })
    const docs = [doc('a1', 'mang/b1.md'), doc('a1', 'mang/lab/l1.md'), doc('a1', 'x.md'), doc('lo', 'y.md')]
    const list = folderChoices(docs, [
      { key: 'a1', name: 'Học kỳ 1', loose: false },
      { key: 'lo', name: 'Downloads', loose: true }
    ])
    expect(list.map((f) => `${f.id} ${f.count}`)).toEqual(['a1 3', 'a1/mang 2', 'a1/mang/lab 1'])
    expect(list[1]).toMatchObject({ name: 'mang', rel: 'mang', rootName: 'Học kỳ 1' })
  })

  it('a folder link is kept as a folder, also through a backup', async () => {
    const a = await CalendarStore.open(tmp())
    const uid = await a.create(lesson())
    await a.link(uid, null, { path: 'D:/hk1/mang', name: 'mang', kind: 'folder' }, same)
    await a.updateLinkPath('D:/hk1/mang', { path: 'D:/other', name: 'other' }) // only files follow a move by content
    const b = await CalendarStore.open(tmp())
    await b.merge(a.backup())
    expect(b.linksOf(uid, '2026-11-03T07:00')).toEqual([{ scope: 'series', link: { path: 'D:/hk1/mang', name: 'mang', kind: 'folder' } }])
  })
})

describe('time zones and long series', () => {
  const NEW_YORK = [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE'
  ]
  const online = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    ...NEW_YORK,
    'BEGIN:VEVENT',
    'UID:online@example.com',
    'DTSTAMP:20261101T000000Z',
    'DTSTART;TZID=America/New_York:20261117T090000',
    'DTEND;TZID=America/New_York:20261117T100000',
    'SUMMARY:Khoá online',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  // 09:00 in New York on 17 Nov 2026 (EST, UTC-5) is 14:00 UTC, shown in this PC's time zone.
  const expected = ymdhm(new Date(Date.UTC(2026, 10, 17, 14, 0)))

  it('an imported event keeps its time zone: shown at the right time here, and written back with it', async () => {
    const dir = tmp()
    const store = await CalendarStore.open(dir)
    await store.merge({ ics: online })
    expect(store.occurrences('2026-11-16', '2026-11-19').map((o) => o.start)).toEqual([expected])
    const ics = readFileSync(path.join(dir, 'calendar.ics'), 'utf8')
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n')
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261117T090000\r\n')
    // Opening the file again (a new start of the app) reads the zone from the file itself.
    ICAL.TimezoneService.remove('America/New_York')
    const again = await CalendarStore.open(dir)
    expect(again.occurrences('2026-11-16', '2026-11-19').map((o) => o.start)).toEqual([expected])
    // Importing the same file twice doesn't add the zone twice.
    await again.merge({ ics: online })
    expect(again.toIcs().match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)
  })

  it('a long daily series still shows years later', async () => {
    const store = await CalendarStore.open(tmp())
    await store.create(lesson({ summary: 'Đọc sách', start: '2000-01-01T21:00', end: '2000-01-01T21:30', rrule: 'FREQ=DAILY' }))
    expect(store.occurrences('2026-11-16', '2026-11-23').map((o) => o.start.slice(0, 10))).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'
    ])
  })

  it('skipping ahead gives the same classes as walking from the start', async () => {
    const store = await CalendarStore.open(tmp())
    const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'
    const fast = await store.create(lesson({ start: '2010-01-05T07:00', end: '2010-01-05T09:00', rrule: rule, exdates: ['2026-11-19'] }))
    // COUNT counts from the real start, so this one is walked class by class.
    const slow = await store.create(lesson({ start: '2010-01-05T07:00', end: '2010-01-05T09:00', rrule: `${rule};COUNT=4000`, exdates: ['2026-11-19'] }))
    const of = (uid: string): string[] => store.occurrencesOf(uid, '2026-10-01', '2027-01-01').map((o) => o.start)
    expect(of(fast).length).toBeGreaterThan(5)
    expect(of(fast)).toEqual(of(slow))
    expect(of(fast)).not.toContain('2026-11-19T07:00')
  })

  it('a Mon–Fri series never gains a weekend class when skipping ahead (also overnight and multi-day events)', async () => {
    const store = await CalendarStore.open(tmp())
    const cases = [
      { start: '2014-01-06T22:00', end: '2014-01-07T02:00', allDay: false }, // Monday night to Tuesday 02:00
      { start: '2014-01-06', end: '2014-01-08', allDay: true } // two whole days
    ]
    for (const c of cases) {
      for (const rule of ['FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=DAILY;INTERVAL=3;BYDAY=MO,TU,WE,TH,FR']) {
        const fast = await store.create(lesson({ ...c, rrule: rule }))
        const slow = await store.create(lesson({ ...c, rrule: `${rule};COUNT=2000` }))
        // Each starting day of the range is tried, so the skipped-to start lands on every weekday.
        for (let d = 0; d < 7; d++) {
          const from = `2016-02-0${d + 1}`
          const of = (uid: string): string[] => store.occurrencesOf(uid, from, '2016-02-20').map((o) => o.start)
          expect(of(fast)).toEqual(of(slow))
          expect(of(fast).map((s) => new Date(`${s.slice(0, 10)}T12:00`).getDay()).filter((w) => w === 0 || w === 6)).toEqual([])
        }
      }
    }
  }, 30000)
})

describe('reminders and subscribed calendars', () => {
  it('a reminder is a standard VALARM, read back as minutes before the start', async () => {
    const dir = tmp()
    const store = await CalendarStore.open(dir)
    const uid = await store.create(lesson({ reminder: 15 }))
    expect(store.toIcs()).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Lập trình mạng\r\nTRIGGER:-PT15M\r\nEND:VALARM')
    expect(store.occurrences('2026-11-10', '2026-11-11')[0].reminder).toBe(15)
    await store.update(uid, '2026-11-03T07:00', 'all', '2026-11-03T07:00', lesson({ reminder: -1 }))
    expect(store.toIcs()).not.toContain('VALARM')
    expect((await CalendarStore.open(dir)).occurrences('2026-11-10', '2026-11-11')[0].reminder).toBe(-1)
  })

  it('a subscribed calendar is shown with its colour, read-only, and its URL is not in backups', async () => {
    const dir = tmp()
    const store = await CalendarStore.open(dir)
    const id = await store.addSubscription('Trường', 'https://example.edu/tkb.ics', 'teal')
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//T//EN', 'BEGIN:VEVENT', 'UID:tkb-1@edu', 'DTSTAMP:20261101T000000Z', 'DTSTART:20261105T070000', 'DTEND:20261105T093000', 'SUMMARY:Toán rời rạc', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    await store.setSubscriptionData(id, { ics })
    const [o] = store.occurrences('2026-11-05', '2026-11-06')
    expect(o).toMatchObject({ summary: 'Toán rời rạc', readOnly: true, source: 'Trường', color: 'teal' })
    await expect(store.update(o.uid, o.rid, 'all', o.start, lesson())).rejects.toThrow()
    await expect(store.delete(o.uid, o.rid, 'all')).rejects.toThrow()
    // Documents can still be linked to its classes.
    await store.link(o.uid, o.rid, { path: 'D:/x.md', name: 'x.md' }, same)
    expect(store.occurrences('2026-11-05', '2026-11-06')[0].links).toBe(1)
    expect(JSON.stringify(store.backup())).not.toContain('example.edu')
    expect(store.toIcs()).not.toContain('Toán rời rạc') // not copied into the app's own calendar
    // Next start: read again from the downloaded copy.
    const again = await CalendarStore.open(dir)
    await again.loadSubscriptions()
    expect(again.subscriptions()).toMatchObject([{ name: 'Trường', events: 1, error: null }])
    expect(again.occurrences('2026-11-05', '2026-11-06')).toHaveLength(1)
    await again.setSubscriptionData(id, { error: 'HTTP 404' })
    expect(again.subscriptions()[0].error).toBe('HTTP 404')
    await again.removeSubscription(id)
    expect(again.occurrences('2026-11-05', '2026-11-06')).toHaveLength(0)
  })
})
