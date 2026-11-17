// Types shared by the main process, the preload bridge and the React UI.

export type DocKind = 'md' | 'html'

/** How far along you are with a document. */
export type StudyStatus = 'new' | 'learning' | 'review' | 'done'

/** One file found in the library folder. */
export interface DocEntry {
  /** Path relative to the library root, always with forward slashes. */
  path: string
  name: string
  kind: DocKind
  title: string
  /** Plain text (tags stripped) used for full-text search. */
  text: string
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

export interface LibrarySnapshot {
  root: string | null
  docs: DocEntry[]
  meta: Record<string, DocMeta>
  /** path -> timestamp of when you last opened it. Kept in the app's own data folder, not the library. */
  recent: Record<string, number>
  /** Problems the user should know about (corrupt meta file, folder missing...). */
  warnings: string[]
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

export interface AppInfo {
  version: string
  update: UpdateStatus
}

/** The API the preload script exposes as `window.api`. */
export interface DocsApi {
  getLibrary(): Promise<LibrarySnapshot>
  chooseLibrary(): Promise<LibrarySnapshot>
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
  getAppInfo(): Promise<AppInfo>
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void
  /** Restarts the app into the downloaded update. */
  installUpdate(): Promise<void>
  checkForUpdates(): Promise<void>

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
