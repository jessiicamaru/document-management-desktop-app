# Calendar: plan

A simple calendar for classes and study sessions, where each event (or one occurrence of a recurring class) links to documents and notes in the library.

Example: "Network Programming, Tuesday morning" repeats weekly; the syllabus links to the whole course, and the notes of the 25 Nov class link to that one class.

Status: **milestones 1 and 2 are built**, and reminders from milestone 3. Next (optional): today's agenda on the home screen, colours per course. Work top to bottom; each milestone ships on its own.

## Decisions

- **Local first.** The app's own events are the core. External calendars are **read-only** (iCal/ICS), so there is no Google sign-in and no Google Cloud project.
- **Two-way Google sync is out of scope for now.** It needs OAuth, a Google Cloud project, Google's app verification for the calendar scope (otherwise users see an "unverified app" warning and the app is capped at 100 users), and conflict handling. Events can still be created in Google and read in through ICS.
- **Notion Calendar** runs on Google Calendar, so reading Google covers it. Notion *databases* with dates (API token) can come later if needed.
- **Data lives in the app's data folder**, never in the documents' folders, like tags and notes:
  `%APPDATA%\Study Docs\data\calendar.json`
- **Events use the standard calendar format, iCalendar ([RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)) `VEVENT`**, so they convert 1:1 to and from `.ics`, Google and Outlook.
  - Field names and meanings follow the RFC, not a format of our own: `UID`, `DTSTAMP`, `DTSTART`/`DTEND` (or `DURATION`), `SUMMARY`, `LOCATION`, `DESCRIPTION`, `RRULE`, `EXDATE`, `RDATE`, `RECURRENCE-ID`, `SEQUENCE`, `STATUS`, `CATEGORIES`, `COLOR` ([RFC 7986](https://www.rfc-editor.org/rfc/rfc7986)), `VALARM`.
  - `RRULE` is stored as the standard string, for example `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T235959Z`.
  - Times are local wall-clock ("floating") times, and all-day events use `VALUE=DATE`. Imported times with a `TZID` or in UTC are shown in this PC's time zone.
  - Stored as an `.ics` file (`data\calendar.ics`), read and written by ical.js, so any calendar app can open it as it is.
  - App-only data (document links, notes folder of each course) goes beside it in `data\calendar.json`, never in standard fields.
- **Libraries:**
  - **FullCalendar** v6 (MIT core: daygrid, timegrid, interaction) for the week and month views; repeats are expanded by ical.js in the main process.
  - **ical.js** to parse `.ics` files and expand recurrences. Hand-written RRULE handling is too error-prone.

## Milestone 1: local calendar (MVP)

1. [x] **Data model + store** (`src/main/calendar-store.ts`, same write queue and corrupt-file backup as DocStore):
   - Events are iCalendar `VEVENT`s (see Decisions).
   - An edited or cancelled single occurrence is a separate `VEVENT` with the same `UID` and a `RECURRENCE-ID`, or an `EXDATE` on the series, as the RFC does it.
   - Links, per `UID`: `series` (the whole course) and `occ[<RECURRENCE-ID>]` (one class), each a list of `{ path, name, hash }`. The hash and name find a document again after it is renamed or moved.
2. [x] **IPC + unit tests:**
   - CRUD for events and links.
   - Recurrence expansion for a date range: every preset, `INTERVAL`, `BYDAY` with ordinals, `COUNT`/`UNTIL`, `EXDATE`, and daylight-saving changes.
   - Editing "this / this and following / all".
   - `.ics` round-trip.
3. [x] **Calendar view:**
   - New "Calendar" entry in the sidebar.
   - Week view by default (it fits a timetable), plus month view.
   - Today button; view and date remembered.
4. [x] **Event dialog:** title, all-day or time, location, color, description, repeat (reminders: milestone 3). Uses the custom dialog styles.
   - **Repeat presets:** does not repeat · daily · weekly on <weekday> · monthly on day <N> · monthly on the <2nd Tuesday> · yearly · every weekday (Mon–Fri) · **Custom…**
   - **Custom repeat** (like Google Calendar), producing a standard `RRULE`:
     - Every **N** days / weeks / months / years (`FREQ` + `INTERVAL`).
     - Weekly: pick several weekdays, for example Tue + Thu (`BYDAY`).
     - Monthly: on day N (`BYMONTHDAY`), or on the Nth / last <weekday> (`BYDAY=2TU`, `BYDAY=-1FR`).
     - Ends: never · on a date (`UNTIL`) · after N times (`COUNT`).
     - A summary line in plain words ("Every 2 weeks on Tue, Thu, until 31 Dec 2026"), plus a preview of the next few dates.
   - **Skip dates**, for example holidays or exam week (`EXDATE`).
   - **Editing a repeating event** asks: this event · this and following events (splits the series: old `UNTIL` + new series) · all events.
   - **Deleting** asks the same three choices.
   - RRULEs from imported calendars that the dialog can't show (for example `BYSETPOS`, `BYWEEKNO`) are kept unchanged and shown as "Custom (from calendar)".
5. [x] **Link documents:**
   - Drag a document from the sidebar onto an event, or pick one from a searchable list.
   - Choose "this class / whole course".
   - Clicking a linked doc opens it.
6. [x] **"Notes for this class" button:**
   - Creates `<chosen folder>/<event title>/<YYYY-MM-DD>.md` with a small template (title, date, location) and opens it for editing.
   - Links the file to that occurrence. If the file already exists, it is opened instead.
7. [x] **Reverse link:** a document shows the classes it belongs to (a chip in DocView); clicking one jumps to the calendar.
8. [x] **Relink support:** links follow documents through the existing rename/move recognition and folder relink.
9. [x] **Backup/restore** includes `calendar.json`.
10. [x] **i18n** (vi + en), **smoke steps**, **README** section.

## Milestone 2: read external calendars (ICS)

1. [x] **Subscribe to a calendar URL**, for example Google Calendar's "Secret address in iCal format":
   - Settings → Calendar → add URL, name, color.
   - Refreshed on start and every 30 minutes, with manual refresh.
2. [x] **Import a `.ics` file** (for example a timetable exported by the school), as a one-off copy into local events.
3. [x] **Rendering:** external events are shown read-only in their own color, recurrences expanded by ical.js.
4. [x] **Links on external events:** keyed by the event `UID` (+ occurrence date), so documents and notes can be attached to Google events too. The app never writes back to Google.
5. [x] **Privacy:**
   - The secret URL lets anyone see the calendar. Store it only locally; never log it, never include it in backups or exports unless asked.
   - Fetch only from the main process, over https only.
6. [x] Cache the last fetched feed, so the calendar works offline.

7. [x] **Export to `.ics`** (the whole local calendar), so it can be imported into Google, Outlook or a phone.

## Milestone 3: small extras (pick later)

- [x] **Windows notification** before a class (only while the app is running), for example "Network Programming in 15 min, room B2".
- [ ] **Agenda** of today's events on the home screen.
- [ ] **Colors per course**, reused by its documents' tags.

## Not now

- Two-way Google / Notion sync.
- Sharing calendars, invites, time zones other than the PC's.
- Spaced-repetition review schedule (declined earlier).

## Decided along the way

- "Notes for this class" asks for a folder the first time, per course, and remembers it (it can be changed in the event panel).
- An event can link a whole folder of the workspace: every document in it, also ones added later. Documents inside show the class chip ("linked through the folder").
- Files anywhere on the PC can be linked from the picker ("Choose files on this PC…"); outside the workspace they are added to "Single files".
