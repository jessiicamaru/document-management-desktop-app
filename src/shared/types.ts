// Types shared by the main process, the preload bridge and the React UI.

/**
 * md and html can be read, edited, annotated and exported; pdf is shown with the built-in
 * PDF viewer; epub books are read (and annotated) with epub.js.
 */
export type DocKind = 'md' | 'html' | 'pdf' | 'epub'

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

/** Your own notes about a document, stored in <library>/.docs-meta.json. */
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
  /** Keyed by document id. Each folder's part is stored in that folder's .docs-meta.json. */
  meta: Record<string, DocMeta>
  /** Document id -> when you last opened it. Kept in the app's own data folder, not the library. */
  recent: Record<string, number>
  /** Document id -> its highlights/notes (documents without any are left out). */
  notes: Record<string, Annotation[]>
  /** Problems the user should know about (corrupt meta file, folder missing...). */
  warnings: string[]
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

/** A highlight, optionally with a note. Stored in <folder>/.docs-notes.json, never in the document. */
export interface Annotation extends TextQuote {
  id: string
  color: HighlightColor
  /** Plain text; empty for a highlight without a note. */
  note: string
  /** EPUB only: exact position in the book (an EPUB CFI range). */
  cfi?: string
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
}

export const DEFAULT_UI: UiSettings = {
  theme: 'system',
  accent: '#b4531f',
  readingSize: 16,
  readingFont: 'sans',
  readingWidth: 'normal'
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
}

export const DEFAULT_META: DocMeta = { tags: [], status: 'new' }
