# Calendar: plan

A simple calendar for classes and study sessions, where each event (or one occurrence of a recurring class) links to documents and notes in the library.

Example: "Network Programming, Tuesday morning" repeats weekly; the syllabus links to the whole course, and the notes of the 25 Nov class link to that one class.

Status: planned, nothing built yet. Work top to bottom; each milestone ships on its own.

## Decisions

- **Local first.** The app's own events are the core. External calendars are **read-only** (iCal/ICS), so there is no Google sign-in and no Google Cloud project.
- **Two-way Google sync is out of scope for now.** It needs OAuth, a Google Cloud project, Google's app verification for the calendar scope (otherwise users see an "unverified app" warning and the app is capped at 100 users), and conflict handling. Events can still be created in Google and read in through ICS.
- **Notion Calendar** runs on Google Calendar, so reading Google covers it. Notion *databases* with dates (API token) can come later if needed.
- **Data lives in the app's data folder**, never in the documents' folders, like tags and notes:
  `%APPDATA%\Study Docs\data\calendar.json`
- **Libraries:**
  - **FullCalendar** (MIT core: daygrid, timegrid, interaction, rrule) for the week and month views.
  - **ical.js** to parse `.ics` files and expand recurrences. Hand-written RRULE handling is too error-prone.

## Milestone 1: local calendar (MVP)

1. [ ] **Data model + store** (`src/main/calendar-store.ts`, same write queue and corrupt-file backup as DocStore):
   - Event fields: `id`, `title`, `start`, `end`, `allDay`, `location`, `color`, `rrule?` (weekly repeat + end date), `exdates?`, `note?`.
   - Links: `{ eventId, occurrence?: 'YYYY-MM-DD', doc: { root, rel } }`.
     - Without `occurrence`, the link applies to the whole series (course material).
     - With it, the link applies to one class.
2. [ ] **IPC + unit tests:**
   - CRUD for events and links.
   - Recurrence expansion for a date range.
   - Editing "this occurrence / the whole series".
3. [ ] **Calendar view:**
   - New "Calendar" entry in the sidebar.
   - Week view by default (it fits a timetable), plus month view.
   - Today button; view and date remembered.
4. [ ] **Event dialog:** title, time, location, color, weekly repeat until a date, free-text note. Uses the custom dialog styles.
5. [ ] **Link documents:**
   - Drag a document from the sidebar onto an event, or pick one from a searchable list.
   - Choose "this class / whole course".
   - Clicking a linked doc opens it.
6. [ ] **"Notes for this class" button:**
   - Creates `<chosen folder>/<event title>/<YYYY-MM-DD>.md` with a small template (title, date, location) and opens it for editing.
   - Links the file to that occurrence. If the file already exists, it is opened instead.
7. [ ] **Reverse link:** a document shows the classes it belongs to (a chip in DocView); clicking one jumps to the calendar.
8. [ ] **Relink support:** links follow documents through the existing rename/move recognition and folder relink.
9. [ ] **Backup/restore** includes `calendar.json`.
10. [ ] **i18n** (vi + en), **smoke steps**, **README** section.

## Milestone 2: read external calendars (ICS)

1. [ ] **Subscribe to a calendar URL**, for example Google Calendar's "Secret address in iCal format":
   - Settings → Calendar → add URL, name, color.
   - Refreshed on start and every 30 minutes, with manual refresh.
2. [ ] **Import a `.ics` file** (for example a timetable exported by the school), as a one-off copy into local events.
3. [ ] **Rendering:** external events are shown read-only in their own color, recurrences expanded by ical.js.
4. [ ] **Links on external events:** keyed by the event `UID` (+ occurrence date), so documents and notes can be attached to Google events too. The app never writes back to Google.
5. [ ] **Privacy:**
   - The secret URL lets anyone see the calendar. Store it only locally; never log it, never include it in backups or exports unless asked.
   - Fetch only from the main process, over https only.
6. [ ] Cache the last fetched feed, so the calendar works offline.

## Milestone 3: small extras (pick later)

- [ ] **Windows notification** before a class (only while the app is running), for example "Network Programming in 15 min, room B2".
- [ ] **Agenda** of today's events on the home screen.
- [ ] **Colors per course**, reused by its documents' tags.

## Not now

- Two-way Google / Notion sync.
- Sharing calendars, invites, time zones other than the PC's.
- Spaced-repetition review schedule (declined earlier).

## Open questions

- Default folder for "Notes for this class": ask on first use, then remember? Or one setting per course?
- Should an event be able to link to a whole folder (all of a course's docs), not just single files?
