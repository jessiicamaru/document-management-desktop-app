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
}

/** Your own notes about a document, stored in <library>/.docs-meta.json. */
export interface DocMeta {
  tags: string[]
  status: StudyStatus
  lastOpened?: number
}

export interface LibrarySnapshot {
  root: string | null
  docs: DocEntry[]
  meta: Record<string, DocMeta>
}

/** The API the preload script exposes as `window.api`. */
export interface DocsApi {
  getLibrary(): Promise<LibrarySnapshot>
  chooseLibrary(): Promise<LibrarySnapshot>
  readDoc(path: string): Promise<string>
  updateMeta(path: string, patch: Partial<DocMeta>): Promise<Record<string, DocMeta>>
  openExternal(path: string): Promise<void>
  revealInFolder(path: string): Promise<void>
  /** Called whenever files in the library change on disk. Returns an unsubscribe function. */
  onLibraryChanged(cb: (snapshot: LibrarySnapshot) => void): () => void
}

export const DEFAULT_META: DocMeta = { tags: [], status: 'new' }
