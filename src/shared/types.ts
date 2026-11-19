// Types shared by the main process, the preload bridge and the React UI.

import type { CalDocRef, CalEventData, CalEventDetail, CalOccurrence, EditScope } from './calendar'

/**
 * md and html can be read, edited, annotated and exported; pdf is shown with the built-in
 * PDF viewer; epub books are read (and annotated) with epub.js.
 */
/** mobi = Kindle books (.mobi, .azw3, .azw), read like EPUB. */
export type DocKind = 'md' | 'html' | 'pdf' | 'epub' | 'mobi' | 'docx' | 'txt' | 'image'

/** How far along you are with a document. */
export type StudyStatus = 'new' | 'learning' | 'review' | 'done'

/** One folder in the workspace (a workspace can hold folders on different drives). */
export interface RootInfo {
  /** Short stable id; the first part of every document id in this folder. */
  key: string
  /** Absolute path on disk. */
  path: string
  /** Display name: the folder name, with its location added when two names clash. */
  name: string
  /** False when the folder can't be opened (deleted, renamed, USB unplugged...). */
  available: boolean
  /** True for the folder of files opened on their own ("File lẻ"), not a workspace folder. */
  loose: boolean
}

/** One file found in the workspace. */
export interface DocEntry {
  /** Workspace-wide id: "<root key>/<path inside that folder>", forward slashes. */
  path: string
  /** Key of the folder (RootInfo.key) this document belongs to. */
  root: string
  /** Path inside that folder. */
  rel: string
  name: string
  kind: DocKind
  title: string
  size: number
  mtime: number
  /** SHA-1 of the file content; used to keep tags when a file is renamed. Missing for very large files. */
  hash?: string
}

/** Your own notes about a document (tags, status), stored in the app's data folder. */
export interface DocMeta {
  tags: string[]
  status: StudyStatus
  /** Last known content hash and file name, so tags survive a rename or move. */
  hash?: string
  name?: string
}

/** One search result. Searching runs in a background worker in the main process. */
export interface SearchResult {
  /** Document id. */
  path: string
  /** Text around the first match; empty when only the title/name matched. */
  snippet: { before: string; match: string; after: string } | null
}

/** Background indexing of book text for search (shown in the sidebar footer). */
export interface SearchStatus {
  /** Documents whose text is indexed / all documents with text. */
  done: number
  total: number
}

export interface LibrarySnapshot {
  /** True while folders are still being scanned (the list may be incomplete). */
  scanning: boolean
  /** Folders in the workspace, in the order you added them. */
  roots: RootInfo[]
  docs: DocEntry[]
  /** Keyed by document id. Stored in %APPDATA%\Study Docs\data\<folder key>\meta.json. */
  meta: Record<string, DocMeta>
  /** Document id -> when you last opened it. Kept in the app's own data folder, not the library. */
  recent: Record<string, number>
  /** Document id -> its highlights/notes (documents without any are left out). */
  notes: Record<string, Annotation[]>
  /** Document id -> its note about the whole document (issue #21). */
  docNotes: Record<string, string>
  /** Files opened on their own ("File lẻ"); id is null while the file can't be found. */
  looseFiles: { path: string; id: string | null }[]
  /** Problems the user should know about (corrupt meta file, folder missing...). */
  warnings: string[]
  /** Backups of broken meta.json / notes.json data files that can be merged back (issue #25). */
  recovery: RecoveryItem[]
  /** Tags/notes saved for files that no longer exist (0 while scanning). */
  orphans: number
}

/** A question from the main process, shown in the app's own dialog. */
export interface AskRequest {
  message: string
  detail?: string
  buttons: string[]
  cancelId: number
  dangerId?: number
}

/** A backup of a broken data file, offered in the recovery dialog. */
export interface RecoveryItem {
  root: string
  rootName: string
  store: 'meta' | 'notes'
  /** Backup file name, e.g. "meta.corrupt-2026-01-01T10-00-00-000Z.json". */
  file: string
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

/** Where a highlight is: the selected text with a little context, so it can be found again after edits. */
export interface TextQuote {
  quote: string
  /** Up to 32 characters before the quote. */
  prefix: string
  /** Up to 32 characters after the quote. */
  suffix: string
}

/** A highlight, optionally with a note. Stored in the app's data folder, never in the document. */
export interface Annotation extends TextQuote {
  id: string
  color: HighlightColor
  /** Plain text; empty for a highlight without a note. */
  note: string
  /** EPUB only: exact position in the book (an EPUB CFI range). */
  cfi?: string
  /** PDF only: the page (1-based) the quote is on. */
  page?: number
  created: number
  updated: number
}

/** Appearance settings, stored in %APPDATA%\Study Docs\settings.json. */
export interface UiSettings {
  theme: 'system' | 'light' | 'dark'
  /** Accent colour as #rrggbb. */
  accent: string
  /** Markdown reading text size in px. */
  readingSize: number
  readingFont: 'sans' | 'serif'
  readingWidth: 'narrow' | 'normal' | 'wide'
  /** Sidebar order inside each folder (issue #23). */
  sidebarSort: 'name' | 'modified'
  /** Books (EPUB, Kindle): always one page, or two side by side when the window is wide. */
  epubSpread: 'single' | 'auto'
  /** List image files (.png, .jpg...) in the sidebar. Off for folders full of pictures used by notes. */
  showImages: boolean
  /** Interface language (see shared/i18n.ts). */
  language: 'vi' | 'en'
}

export const DEFAULT_UI: UiSettings = {
  theme: 'system',
  accent: '#b4531f',
  readingSize: 16,
  readingFont: 'sans',
  readingWidth: 'normal',
  sidebarSort: 'name',
  epubSpread: 'auto',
  showImages: true,
  language: 'vi'
}

/** One edited block of an HTML document: which element (by position) and its new inner HTML. */
export interface HtmlBlockEdit {
  /** Element child indexes from <html> down to the block, e.g. [1, 0, 3] = body > 1st child > 4th child. */
  path: number[]
  /** Lower-case tag name, checked before writing so a wrong match is never saved. */
  tag: string
  html: string
}

/** Auto-update progress (see src/main/updater.ts). */
export interface UpdateStatus {
  state: 'idle' | 'downloading' | 'ready'
  version?: string
  percent?: number
}

/** Result of pressing "Kiểm tra cập nhật". */
export interface UpdateCheck {
  /** latest = nothing newer; downloading = a newer version is being downloaded; ready = downloaded, restart to install. */
  result: 'latest' | 'downloading' | 'ready'
  version: string
}

export interface AppInfo {
  version: string
  update: UpdateStatus
}

/** The API the preload script exposes as `window.api`. */
export interface DocsApi {
  getLibrary(): Promise<LibrarySnapshot>
  /** Opens a folder picker (several folders allowed) and adds them to the workspace. */
  addFolders(): Promise<{ snapshot: LibrarySnapshot; refused: string[] }>
  /** Removes a folder from the workspace. Nothing on disk is deleted. */
  removeFolder(key: string): Promise<LibrarySnapshot>
  readDoc(path: string): Promise<string>
  updateMeta(path: string, patch: Partial<Pick<DocMeta, 'tags' | 'status'>>): Promise<Record<string, DocMeta>>
  markOpened(path: string): Promise<Record<string, number>>
  /** Opens any file inside the library with its default Windows app. */
  openPath(path: string): Promise<void>
  revealInFolder(path: string): Promise<void>
  /** Called whenever files in the library change on disk. Returns an unsubscribe function. */
  onLibraryChanged(cb: (snapshot: LibrarySnapshot) => void): () => void
  /** Called when a link inside an HTML document points to another library document. */
  onNavigate(cb: (path: string, hash: string) => void): () => void
  /** Mouse back/forward buttons. */
  onHistory(cb: (direction: 'back' | 'forward') => void): () => void
  /**
   * Asks where to save, then prints the document (md or html) to PDF, optionally with its
   * highlights and notes. Resolves with the file path, or null if cancelled.
   */
  exportPdf(path: string, withNotes: boolean): Promise<string | null>
  /** Adds or updates a highlight/note. Resolves with all annotations of that document. */
  saveAnnotation(path: string, annotation: Annotation): Promise<Annotation[]>
  deleteAnnotation(path: string, id: string): Promise<Annotation[]>
  /** Sets the note about the whole document (empty text removes it). Resolves with the saved text. */
  saveDocNote(path: string, text: string): Promise<string>
  /** Renames a tag on every document in the workspace. Resolves with how many documents changed. */
  renameTag(from: string, to: string): Promise<number>
  /** Removes a tag from every document in the workspace. */
  deleteTag(tag: string): Promise<number>
  /** Removes tags/notes of files that no longer exist. Resolves with how many entries were removed. */
  cleanOrphans(): Promise<number>
  /** Merges a backup of a broken data file into the current data. Resolves with how many documents it had. */
  restoreBackup(root: string, file: string): Promise<number>
  /** Moves a backup to the Recycle Bin. */
  discardBackup(root: string, file: string): Promise<void>
  /** Shows a backup file in Explorer (to fix it by hand). */
  revealBackup(root: string, file: string): Promise<void>
  /** The main process asks a question; the app shows it in its own dialog and answers with answerAsk. */
  onAsk(cb: (id: number, request: AskRequest) => void): () => void
  answerAsk(id: number, index: number): Promise<void>
  /** Shows a file picker and opens the chosen documents ("File lẻ" if outside the workspace). Resolves with their ids. */
  openFiles(): Promise<string[]>
  /** Opens documents by path (drag and drop). Resolves with their ids. */
  addFiles(paths: string[]): Promise<string[]>
  /** Removes a file from "File lẻ" (the file and its notes stay). */
  removeLooseFile(path: string): Promise<void>
  /** Path of a file dropped on the window. */
  pathForFile(file: File): string
  /** Saves all tags and notes to a file of your choice. Resolves with its path, or null if cancelled. */
  exportData(): Promise<string | null>
  /** Merges a backup file into the current data. Resolves with how many documents it had, or null if cancelled. */
  importData(): Promise<number | null>
  /** Raw bytes of a document (used for EPUB books). */
  readBinary(path: string): Promise<Uint8Array>
  /** Full-text search over all documents (accent-insensitive). */
  search(query: string): Promise<SearchResult[]>
  onSearchStatus(cb: (status: SearchStatus) => void): () => void
  getAppInfo(): Promise<AppInfo>
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
  /** Restarts the app into the downloaded update. */
  installUpdate(): Promise<void>
  checkForUpdates(): Promise<UpdateCheck>

  getUiSettings(): Promise<UiSettings>
  setUiSettings(ui: UiSettings): Promise<UiSettings>

  /**
   * Overwrites a document. `expectedMtime` is the modified time the editor started from;
   * if the file changed on disk since then, nothing is written and the promise rejects.
   * Resolves with the new modified time.
   */
  writeDoc(path: string, content: string, expectedMtime: number): Promise<number>
  /** Applies inline text edits to an HTML document without touching the rest of the file. */
  saveHtmlEdits(path: string, edits: HtmlBlockEdit[], expectedMtime: number): Promise<number>

  // ---------- calendar (see shared/calendar.ts) ----------
  /** Occurrences that overlap [from, to), local dates "YYYY-MM-DD". */
  calendarRange(from: string, to: string): Promise<CalOccurrence[]>
  calendarDetail(uid: string, rid: string): Promise<CalEventDetail>
  /** Resolves with the new event's UID. */
  calendarCreate(data: CalEventData): Promise<string>
  /** Changes one class, it and the following ones, or all (see CalendarStore.update). Resolves with its UID now. */
  calendarUpdate(uid: string, rid: string, scope: EditScope, shownStart: string, data: CalEventData): Promise<string>
  calendarDelete(uid: string, rid: string, scope: EditScope): Promise<void>
  /** The first starts of an event as the dialog has it. */
  calendarPreview(data: CalEventData): Promise<string[]>
  /** Links a document to the course (rid null) or to one class. */
  calendarLink(uid: string, rid: string | null, docId: string): Promise<void>
  /** Links a folder of the workspace (its id in the sidebar tree): every document in it, also ones added later. */
  calendarLinkFolder(uid: string, rid: string | null, folderId: string): Promise<void>
  /** Picks files anywhere on the PC, opens them (outside the workspace: "File lẻ") and links them. Resolves with how many. */
  calendarLinkFiles(uid: string, rid: string | null): Promise<number>
  /** Removes a linked document or folder (by its stored path). */
  calendarUnlink(uid: string, rid: string | null, filePath: string): Promise<void>
  /** The classes and courses a document is linked to. */
  calendarForDoc(docId: string): Promise<CalDocRef[]>
  /** Creates (or finds) the notes file of a class and links it. Resolves with its id, or null if cancelled. */
  calendarClassNotes(uid: string, rid: string): Promise<string | null>
  /** Picks the folder for a course's class notes. */
  calendarChooseNotesFolder(uid: string): Promise<string | null>
  /** Saves the calendar as an .ics file. Resolves with its path, or null if cancelled. */
  calendarExport(): Promise<string | null>
  /** Adds the events of an .ics file. Resolves with how many it had, or null if cancelled. */
  calendarImport(): Promise<number | null>
}

export const DEFAULT_META: DocMeta = { tags: [], status: 'new' }
