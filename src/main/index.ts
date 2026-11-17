// Electron main process: owns the window, the file system and the `doc://` protocol.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Annotation, DocEntry, DocMeta, HtmlBlockEdit, LibrarySnapshot, RecoveryItem, UiSettings } from '../shared/types'
import { applyHtmlEdits, editModeInjection, HtmlEditError } from './html-edit'
import { printNotesInjection, viewModeInjection } from './view-helper'
import { kindOf, resolveInLibrary, scanLibrary, type ScannedDoc } from './library'
import { META_FILE, MetaStore } from './meta-store'
import { ScanCache } from './scan-cache'
import { SearchService } from './search'
import { NOTES_FILE, NotesStore, sanitizeAnnotation } from './notes-store'
import { loadRecent, loadUiSettings, loadWorkspacePaths, markOpened, sanitizeUi, saveSettings, saveWorkspacePaths } from './storage'
import { isSameOrInside, labelRoots, normalizeRoot, pathKey, rootConflict, rootKeyOf, splitDocId } from './workspace'
import { canOpenWithDefaultApp } from './open-policy'
import { decodeUtf8Strict } from './text-file'
import { checkForUpdatesNow, getUpdateStatus, installUpdateNow, startAutoUpdate } from './updater'

// Tests run with their own settings folder so they never touch your real settings.
if (process.env.STUDYDOCS_USER_DATA) app.setPath('userData', process.env.STUDYDOCS_USER_DATA)

// Documents are served as doc://library/<root key>/<path inside that folder>. A "standard" scheme means
// relative links inside an HTML document (images, other pages) resolve normally.
protocol.registerSchemesAsPrivileged([
  { scheme: 'doc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

/** Origin of Chromium's built-in PDF viewer, which shows PDF documents inside an iframe. */
const PDF_VIEWER = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'


let win: BrowserWindow | null = null

/** One folder of the workspace, with its own scan cache, metadata file and watcher. */
interface Root {
  key: string
  path: string
  name: string
  /** Documents with paths relative to this folder. */
  docs: ScannedDoc[]
  /** Null when the folder could not be opened. */
  meta: MetaStore | null
  notes: NotesStore | null
  watcher: FSWatcher | null
  warning: string | null
}

let roots: Root[] = []
/** True while folders are being scanned (the UI shows "Đang quét…"). */
let scanning = false
/** Titles/hashes of files seen before, so unchanged files aren't read again. Set at startup. */
let scanCache: ScanCache | undefined
/** Full-text search in a background thread. Set at startup. */
let search: SearchService | undefined

// ---------- workspace ----------

const newRoot = (p: string): Root => ({ key: rootKeyOf(p), path: p, name: '', docs: [], meta: null, notes: null, watcher: null, warning: null })

/** Finds a document id ("<root key>/<path>") in the workspace; null if it isn't in any folder. */
function locate(id: string): { root: Root; rel: string; abs: string } | null {
  const parts = splitDocId(id)
  const root = parts && roots.find((r) => r.key === parts.key)
  const abs = root && resolveInLibrary(root.path, parts.rel)
  return root && abs ? { root, rel: parts.rel, abs } : null
}
const inLibrary = (id: string): string | null => locate(id)?.abs ?? null
const hasDoc = (id: string): boolean => {
  const loc = locate(id)
  return !!loc && loc.root.docs.some((d) => d.path === loc.rel)
}

/** Splits doc://library/<id>#part into { path: id, hash: 'part' }. */
function parseDocUrl(url: string): { path: string; hash: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'doc:') return null
    return {
      path: decodeURIComponent(u.pathname).replace(/^\/+/, ''),
      hash: decodeURIComponent(u.hash.replace(/^#/, ''))
    }
  } catch {
    return null
  }
}

/** Document id -> last opened time, for documents currently in the workspace. */
function recentByDoc(byFile: Record<string, number>): Record<string, number> {
  const recent: Record<string, number> = {}
  for (const r of roots) {
    for (const d of r.docs) {
      const ts = byFile[pathKey(path.join(r.path, d.path))]
      if (ts) recent[`${r.key}/${d.path}`] = ts
    }
  }
  return recent
}

async function snapshot(): Promise<LibrarySnapshot> {
  const docs: DocEntry[] = []
  const meta: Record<string, DocMeta> = {}
  const notes: Record<string, Annotation[]> = {}
  const docNotes: Record<string, string> = {}
  const warnings: string[] = []
  const recovery: RecoveryItem[] = []
  let orphans = 0
  for (const r of roots) {
    for (const d of r.docs) docs.push({ ...d, path: `${r.key}/${d.path}`, root: r.key, rel: d.path })
    for (const [rel, m] of Object.entries(r.meta?.all() ?? {})) meta[`${r.key}/${rel}`] = m
    for (const [rel, items] of Object.entries(r.notes?.byDoc() ?? {})) notes[`${r.key}/${rel}`] = items
    for (const [rel, text] of Object.entries(r.notes?.docNotes() ?? {})) docNotes[`${r.key}/${rel}`] = text
    for (const [store, s] of [['meta', r.meta], ['notes', r.notes]] as const) {
      for (const file of (await s?.backups()) ?? []) recovery.push({ root: r.key, rootName: r.name, store, file })
    }
    // Only count once the folder is fully scanned and reachable, or every file would look gone.
    if (!scanning && !r.warning) orphans += storesOf(r).reduce((n, st) => n + st.orphans(r.docs.map((d) => d.path)).length, 0)
    for (const w of [r.meta?.warning, r.notes?.warning, r.warning]) if (w) warnings.push(roots.length > 1 ? `${r.name}: ${w}` : w)
  }
  return {
    scanning,
    roots: roots.map((r) => ({ key: r.key, path: r.path, name: r.name, available: !!r.meta })),
    docs,
    meta,
    recent: recentByDoc(await loadRecent()),
    notes,
    docNotes,
    warnings,
    recovery,
    orphans
  }
}

const storesOf = (r: Root): (MetaStore | NotesStore)[] => [r.meta, r.notes].filter((x): x is MetaStore | NotesStore => !!x)

/** The meta or notes store of a folder, for the recovery dialog. */
function storeFor(rootKey: string, store: string): MetaStore | NotesStore {
  const r = roots.find((x) => x.key === rootKey)
  const s = store === 'meta' ? r?.meta : store === 'notes' ? r?.notes : null
  if (!s) throw new Error('Thư mục này không còn trong workspace')
  return s
}
/** Which store a backup file name belongs to. */
const storeOfBackup = (file: string): 'meta' | 'notes' => (String(file).startsWith('.docs-notes.') ? 'notes' : 'meta')

async function pushSnapshot(): Promise<void> {
  win?.webContents.send('library:changed', await snapshot())
  openPendingFile()
}

// ---------- opening a file from Explorer (issue #24) ----------

/** File types the installer associates with the app. */
const OPENABLE = /\.(md|markdown|html?|pdf|epub)$/i
/** A file to show once the UI is ready and its folder has been scanned. */
let pendingFile: string | null = null
/** True once the UI asked for the library, so it is listening for doc:navigate. */
let uiReady = false

/** Document files in a command line ("Study Docs.exe" "C:\notes\a.md"). */
function filesInArgs(argv: string[], cwd = process.cwd()): string[] {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-') && OPENABLE.test(a))
    .map((a) => path.resolve(cwd, a))
}

/** Opens a file given on the command line; files outside the workspace ask to add their folder. */
async function openFromExplorer(abs: string): Promise<void> {
  try {
    if (!(await fs.stat(abs)).isFile()) return
  } catch {
    return
  }
  if (win?.isMinimized()) win.restore()
  win?.focus()
  if (!roots.some((r) => isSameOrInside(abs, r.path))) {
    const folder = path.dirname(abs)
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Thêm thư mục và mở', 'Huỷ'],
      defaultId: 0,
      cancelId: 1,
      title: 'Mở file',
      message: `"${path.basename(abs)}" không nằm trong workspace.`,
      detail: `Study Docs chỉ mở file trong các thư mục của workspace (để lưu tag, ghi chú cạnh file).\n\nThêm thư mục này vào workspace?\n${folder}`
    })
    if (response !== 0) return
    const refused = await addRoots([folder])
    if (refused.length) {
      void dialog.showMessageBox(win!, { type: 'warning', message: 'Không thêm được thư mục', detail: refused.join('\n') })
      return
    }
  }
  pendingFile = abs
  openPendingFile()
}

/** Shows the pending file once its folder is scanned and the UI is listening. */
function openPendingFile(): void {
  if (!pendingFile || !uiReady || !win) return
  const root = roots.find((r) => isSameOrInside(pendingFile!, r.path))
  if (!root) {
    pendingFile = null
    return
  }
  const rel = path.relative(root.path, pendingFile).split(path.sep).join('/')
  if (root.docs.some((d) => d.path === rel)) {
    pendingFile = null
    win.webContents.send('doc:navigate', `${root.key}/${rel}`, '')
  } else if (!scanning) {
    const name = path.basename(pendingFile)
    pendingFile = null
    void dialog.showMessageBox(win, { type: 'warning', message: `Không mở được "${name}"`, detail: 'File nằm trong thư mục ẩn (tên bắt đầu bằng dấu chấm) hoặc không còn tồn tại.' })
  }
}

function relabel(): void {
  const labels = labelRoots(roots.map((r) => r.path))
  roots.forEach((r, i) => (r.name = labels[i]))
}

async function openRoot(root: Root): Promise<void> {
  try {
    if (!(await fs.stat(root.path)).isDirectory()) throw new Error('not a folder')
    root.meta = await MetaStore.open(root.path)
    root.notes = await NotesStore.open(root.path)
  } catch {
    root.warning = 'Không mở được thư mục này (bị xoá, đổi tên hoặc ổ đĩa chưa cắm). Nếu không dùng nữa, bỏ nó khỏi workspace trong Cài đặt.'
    return
  }
  root.docs = await scanLibrary(root.path, [], scanCache)
  await reconcileStores(root)
  // The folder may have been removed from the workspace while it was being scanned:
  // then don't start watching it, nobody would ever stop the watcher (issue #9).
  if (roots.includes(root)) watchRoot(root)
}

/** Lets tags and notes follow renamed/moved documents. */
async function reconcileStores(root: Root): Promise<void> {
  for (const store of [root.meta, root.notes]) await store?.reconcile(root.docs).catch((err) => console.error('reconcile failed', err))
}

function closeRoot(root: Root): void {
  root.watcher?.close()
  root.watcher = null
}

/** Tells the search worker about the current documents; it indexes new/changed ones in the background. */
function syncSearch(): void {
  search?.update(
    roots.flatMap((r) =>
      r.docs.map((d) => ({
        id: `${r.key}/${d.path}`,
        abs: path.join(r.path, d.path),
        kind: d.kind,
        title: d.title,
        name: d.name,
        rel: d.path,
        size: d.size,
        mtime: d.mtime
      }))
    ),
    !scanning
  )
}

/** Opens folders one by one, showing each in the UI as soon as it is scanned. */
async function openRoots(list: Root[]): Promise<void> {
  scanning = true
  await pushSnapshot()
  for (const root of list) {
    if (!roots.includes(root)) continue // removed before its turn
    await openRoot(root)
    syncSearch()
    await pushSnapshot()
  }
  scanning = false
  syncSearch() // the full list now: lets the worker clean up texts of files that are gone
  await scanCache?.save()
  await pushSnapshot()
}

/** Replaces the whole workspace (at startup). Duplicate or nested folders are skipped. */
async function openWorkspace(paths: string[]): Promise<void> {
  roots.forEach(closeRoot)
  roots = []
  for (const p of paths) {
    const norm = normalizeRoot(p)
    if (!rootConflict(roots.map((r) => r.path), norm)) roots.push(newRoot(norm))
  }
  relabel()
  await openRoots(roots)
}

/** Adds folders; returns a message for each folder that was refused. */
async function addRoots(paths: string[]): Promise<string[]> {
  const refused: string[] = []
  const added: Root[] = []
  for (const p of paths) {
    const norm = normalizeRoot(p)
    const conflict = rootConflict(roots.map((r) => r.path), norm)
    if (conflict) refused.push(conflict)
    else added.push(newRoot(norm))
  }
  roots.push(...added)
  relabel()
  await saveWorkspacePaths(roots.map((r) => r.path))
  await openRoots(added)
  return refused
}

async function removeRoot(key: string): Promise<void> {
  const root = roots.find((r) => r.key === key)
  if (!root) return
  closeRoot(root)
  roots = roots.filter((r) => r !== root)
  relabel()
  await saveWorkspacePaths(roots.map((r) => r.path))
  syncSearch()
}

function watchRoot(root: Root): void {
  let rescanTimer: NodeJS.Timeout | undefined
  let metaTimer: NodeJS.Timeout | undefined
  const stillOpen = (): boolean => roots.includes(root)

  const rescan = async (): Promise<void> => {
    if (!stillOpen()) return
    root.docs = await scanLibrary(root.path, root.docs, scanCache)
    await reconcileStores(root)
    syncSearch()
    await pushSnapshot()
  }
  const reloadStores = async (): Promise<void> => {
    if (!stillOpen()) return
    let changed = false
    for (const store of [root.meta, root.notes]) if (store) changed = (await store.reloadFromDisk().catch(() => false)) || changed
    if (changed || root.meta?.warning || root.notes?.warning) await pushSnapshot()
  }

  try {
    // Windows supports recursive watching natively, no extra dependency needed.
    root.watcher = watch(root.path, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? '')
      if (name === META_FILE || name === NOTES_FILE) {
        // Changed by a sync tool or another PC (our own writes are recognised and skipped).
        clearTimeout(metaTimer)
        metaTimer = setTimeout(() => void reloadStores(), 400)
        return
      }
      // Other hidden files (backups, temp files) and node_modules are not documents.
      if (name.split(/[\\/]/).some((p) => p.startsWith('.') || p === 'node_modules')) return
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(() => void rescan(), 400)
    })
    // Happens when the folder is deleted, renamed or on a USB drive that was removed.
    root.watcher.on('error', (err) => {
      console.error('watcher error', err)
      closeRoot(root)
      root.warning = 'Mất kết nối với thư mục này (bị xoá, đổi tên hoặc rút ổ). App không còn tự cập nhật khi file trong đó thay đổi.'
      void pushSnapshot()
    })
  } catch (err) {
    console.error('Cannot watch folder', err)
    root.warning = 'Không theo dõi được thư mục này; app sẽ không tự cập nhật khi file trong đó thay đổi.'
  }
}

/** Opens a library file with its default app; programs/scripts are only shown in Explorer. */
/**
 * Opens a library file with its default app. Only safe types are opened (see open-policy.ts);
 * anything else is shown in Explorer. `fromPage`: the request came from inside a document
 * (a link or a script in an HTML page), not from you clicking in the app, so ask first.
 */
async function openLibraryFile(rel: string, fromPage = false): Promise<void> {
  const abs = inLibrary(rel)
  if (!abs) throw new Error('File nằm ngoài thư mục tài liệu')
  if (!canOpenWithDefaultApp(abs)) {
    shell.showItemInFolder(abs)
    return
  }
  if (fromPage && win) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Mở file',
      message: `Bài đang đọc muốn mở "${path.basename(abs)}" bằng ứng dụng mặc định của Windows.`,
      buttons: ['Mở', 'Không'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return
  }
  const error = await shell.openPath(abs)
  if (error) throw new Error(error)
}

/**
 * Writes a document only if it still has the modified time the editor started from,
 * so an edit never silently overwrites a change made in another program.
 * Writes to a hidden temp file first, then renames it over the original.
 */
async function writeDocChecked(rel: string, build: (current: string) => string, expectedMtime: number): Promise<number> {
  const abs = inLibrary(rel)
  const kind = abs ? kindOf(abs) : null
  if (!abs || (kind !== 'md' && kind !== 'html')) throw new Error('Chỉ sửa được file .md / .html trong thư mục tài liệu.')
  const stat = await fs.stat(abs)
  if (Math.abs(stat.mtimeMs - expectedMtime) > 1) {
    throw new Error('File vừa bị thay đổi bên ngoài app. Bài đã được tải lại; hãy sửa lại thay đổi của bạn.')
  }
  // Refuse files that aren't UTF-8: saving them as UTF-8 would garble their text (issue #4).
  const content = build(decodeUtf8Strict(await fs.readFile(abs)))
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.studydocs-tmp`)
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, abs)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw friendlyWriteError(err)
  }
  return (await fs.stat(abs)).mtimeMs
}

/** Export to PDF: the page may draw itself, but not read other files or open connections. */
const PRINT_CSP = "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'"

/**
 * Prints a document to PDF in a hidden window: HTML pages as they are (without the app's
 * helper script), Markdown through the app's own renderer (#print=<id>, see PrintPage.tsx).
 * Always in light colours, whatever theme the app uses.
 */
async function printToPdf(id: string, kind: 'md' | 'html', withNotes: boolean): Promise<Buffer> {
  const printWin = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Markdown is rendered by the app's own page, which reads the file through window.api.
      preload: kind === 'md' ? path.join(__dirname, '../preload/index.js') : undefined
    }
  })
  const wc = printWin.webContents
  const debug = (msg: string): void => {
    if (process.env.STUDYDOCS_DEBUG) console.log(`[printToPdf] ${msg}`)
  }
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e) => e.preventDefault())
  try {
    debug('load')
    const printHash = `print=${encodeURIComponent(id)}${withNotes ? '&notes=1' : ''}`
    if (kind === 'html') {
      await printWin.loadURL(`doc://library/${id.split('/').map(encodeURIComponent).join('/')}?print=1${withNotes ? '&notes=1' : ''}`)
    } else if (process.env.ELECTRON_RENDERER_URL) {
      await printWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${printHash}`)
    } else {
      await printWin.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: printHash })
    }
    // HTML pages that have a dark mode: print them light. Done after loading and given at
    // most 3 s, so a debugger hiccup can never block the export (the page then prints as is).
    if (kind === 'html') {
      debug('emulate light')
      try {
        wc.debugger.attach('1.3')
        await Promise.race([
          wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ])
      } catch (err) {
        debug(`could not force light colours: ${(err as Error).message}`)
      }
    }

    // Wait for web fonts, images and (Markdown) diagrams before printing, but never more
    // than 15 s: a page that keeps loading must not block the export.
    debug('wait for content')
    await wc.executeJavaScript(`(async () => {
      const ready = (async () => {
        await document.fonts.ready
        await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })))
        if (window.__studydocsPrintReady) await window.__studydocsPrintReady
      })()
      await Promise.race([ready, new Promise((r) => setTimeout(r, 15000))])
      await new Promise((r) => setTimeout(r, 250))
    })()`)
    debug('print')

    return await wc.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.55, bottom: 0.6, left: 0.5, right: 0.5 },
      generateDocumentOutline: true, // PDF bookmarks from the headings...
      generateTaggedPDF: true, // ...which Chromium builds from the tagged structure
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#888;text-align:center;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    })
  } finally {
    printWin.destroy()
  }
}

/** Turns low-level file errors into a message that makes sense in the UI. */
function friendlyWriteError(err: unknown): Error {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return new Error('Không lưu được: thư mục tài liệu chỉ đọc, hoặc file đang bị app khác khoá.')
  }
  return new Error(`Không lưu được: ${(err as Error).message}`)
}

// ---------- IPC handlers (called through window.api in the UI) ----------

function registerIpc(): void {
  ipcMain.handle('library:get', async () => {
    const snap = await snapshot()
    uiReady = true
    setTimeout(openPendingFile, 0) // after the UI got the library, so the document is in its list
    return snap
  })

  ipcMain.handle('workspace:add', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Thêm thư mục vào workspace',
      buttonLabel: 'Thêm thư mục',
      properties: ['openDirectory', 'multiSelections']
    })
    const refused = result.canceled ? [] : await addRoots(result.filePaths)
    return { snapshot: await snapshot(), refused }
  })

  ipcMain.handle('workspace:remove', async (_e, key: string) => {
    await removeRoot(key)
    return snapshot()
  })

  ipcMain.handle('doc:read', async (_e, rel: string) => {
    const abs = inLibrary(rel)
    if (!abs) throw new Error('File nằm ngoài thư mục tài liệu')
    return fs.readFile(abs, 'utf8')
  })

  ipcMain.handle('meta:update', async (_e, id: string, patch: Partial<DocMeta>) => {
    const loc = locate(id)
    if (!loc?.root.meta) throw new Error('File nằm ngoài thư mục tài liệu')
    // Only tags and status can be changed from the UI.
    const clean: Partial<DocMeta> = {}
    if (Array.isArray(patch.tags)) clean.tags = patch.tags.map(String)
    if (patch.status) clean.status = patch.status
    try {
      await loc.root.meta.update(loc.rel, clean, loc.root.docs.find((d) => d.path === loc.rel))
      return (await snapshot()).meta
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  ipcMain.handle('doc:opened', async (_e, id: string) => {
    const loc = locate(id)
    if (!loc) return {}
    try {
      return recentByDoc(await markOpened(loc.abs))
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  ipcMain.handle('doc:openPath', (_e, rel: string) => openLibraryFile(rel))

  ipcMain.handle('search', (_e, query: string) => search?.search(String(query)) ?? [])

  ipcMain.handle('doc:readBinary', async (_e, id: string) => {
    const abs = inLibrary(id)
    if (!abs) throw new Error('File nằm ngoài thư mục tài liệu')
    return new Uint8Array(await fs.readFile(abs))
  })

  ipcMain.handle('notes:save', async (_e, id: string, input: Partial<Annotation>) => {
    const loc = locate(id)
    if (!loc?.root.notes) throw new Error('File nằm ngoài thư mục tài liệu')
    const annotation = sanitizeAnnotation(input)
    try {
      return await loc.root.notes.save(loc.rel, annotation, loc.root.docs.find((d) => d.path === loc.rel))
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  ipcMain.handle('notes:delete', async (_e, id: string, annotationId: string) => {
    const loc = locate(id)
    if (!loc?.root.notes) throw new Error('File nằm ngoài thư mục tài liệu')
    try {
      return await loc.root.notes.remove(loc.rel, String(annotationId))
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  ipcMain.handle('notes:docNote', async (_e, id: string, text: string) => {
    const loc = locate(id)
    if (!loc?.root.notes) throw new Error('File nằm ngoài thư mục tài liệu')
    try {
      return await loc.root.notes.setDocNote(loc.rel, String(text ?? ''), loc.root.docs.find((d) => d.path === loc.rel))
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  // ---------- workspace-wide tags and clean-up (issue #22) ----------
  ipcMain.handle('tags:rename', async (_e, from: string, to: string) => {
    const a = String(from ?? '').trim()
    const b = String(to ?? '').trim()
    if (!a || !b) throw new Error('Tên tag không được trống')
    let n = 0
    try {
      for (const r of roots) n += (await r.meta?.renameTag(a, b)) ?? 0
    } catch (err) {
      throw friendlyWriteError(err)
    }
    await pushSnapshot()
    return n
  })
  ipcMain.handle('tags:delete', async (_e, tag: string) => {
    let n = 0
    try {
      for (const r of roots) n += (await r.meta?.deleteTag(String(tag ?? ''))) ?? 0
    } catch (err) {
      throw friendlyWriteError(err)
    }
    await pushSnapshot()
    return n
  })
  ipcMain.handle('library:cleanOrphans', async () => {
    if (scanning) throw new Error('Đang quét thư mục, đợi quét xong rồi thử lại')
    let n = 0
    try {
      for (const r of roots) {
        if (r.warning) continue // folder unreachable: its files only look missing
        for (const st of storesOf(r)) n += await st.pruneOrphans(r.docs.map((d) => d.path))
      }
    } catch (err) {
      throw friendlyWriteError(err)
    }
    await pushSnapshot()
    return n
  })

  // ---------- recovery of broken data files (issue #25) ----------
  ipcMain.handle('recovery:restore', async (_e, rootKey: string, file: string) => {
    const n = await storeFor(rootKey, storeOfBackup(file)).restoreBackup(String(file))
    await pushSnapshot()
    return n
  })
  ipcMain.handle('recovery:discard', async (_e, rootKey: string, file: string) => {
    const st = storeFor(rootKey, storeOfBackup(file))
    await shell.trashItem(st.backupPath(String(file)))
    if (!(await st.backups()).length) st.warning = null
    await pushSnapshot()
  })
  ipcMain.handle('recovery:reveal', (_e, rootKey: string, file: string) => {
    shell.showItemInFolder(storeFor(rootKey, storeOfBackup(file)).backupPath(String(file)))
  })

  ipcMain.handle('doc:exportPdf', async (_e, id: string, withNotes: boolean) => {
    const loc = locate(id)
    const doc = loc?.root.docs.find((d) => d.path === loc.rel)
    if (!loc || !doc || (doc.kind !== 'md' && doc.kind !== 'html')) throw new Error('Chỉ xuất PDF được bài .md hoặc .html.')
    const safeName = doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || path.parse(doc.name).name
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Xuất PDF',
      defaultPath: path.join(path.dirname(loc.abs), `${safeName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return null
    const pdf = await printToPdf(id, doc.kind, withNotes === true)
    try {
      await fs.writeFile(filePath, pdf)
    } catch (err) {
      throw friendlyWriteError(err)
    }
    return filePath
  })

  ipcMain.handle('doc:reveal', (_e, rel: string) => {
    const abs = inLibrary(rel)
    if (abs) shell.showItemInFolder(abs)
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), update: getUpdateStatus() }))
  ipcMain.handle('update:install', () => installUpdateNow())
  ipcMain.handle('update:check', () => checkForUpdatesNow())

  ipcMain.handle('settings:get', () => loadUiSettings())
  ipcMain.handle('settings:set', async (_e, ui: UiSettings) => {
    const clean = sanitizeUi(ui)
    await saveSettings({ ui: clean })
    nativeTheme.themeSource = clean.theme // also switches prefers-color-scheme for the pages
    return clean
  })

  ipcMain.handle('doc:write', (_e, rel: string, content: string, expectedMtime: number) => {
    if (typeof content !== 'string') throw new Error('Nội dung không hợp lệ')
    return writeDocChecked(rel, () => content, expectedMtime)
  })

  ipcMain.handle('doc:saveHtmlEdits', async (_e, rel: string, edits: HtmlBlockEdit[], expectedMtime: number) => {
    if (kindOf(rel) !== 'html') throw new Error('Không phải file HTML')
    try {
      return await writeDocChecked(rel, (current) => applyHtmlEdits(current, edits), expectedMtime)
    } catch (err) {
      if (err instanceof HtmlEditError) throw new Error(err.message)
      throw err
    }
  })
}

// ---------- window ----------

function openInBrowser(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 520,
    title: 'Study Docs',
    // The installed app takes its icon from the .exe; in `npm run dev` use the PNG directly.
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const { webContents } = win

  // The app window itself never navigates away; web links open in your normal browser.
  webContents.on('will-navigate', (e) => {
    e.preventDefault()
    openInBrowser(e.url)
  })

  // Navigation inside the document iframe.
  webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame || e.url.startsWith('about:')) return
    // The built-in PDF viewer is an internal extension page that loads the PDF itself.
    if (e.url.startsWith(PDF_VIEWER) || e.initiator?.url.startsWith(PDF_VIEWER)) return
    if (!e.url.startsWith('doc://')) {
      e.preventDefault()
      openInBrowser(e.url)
      return
    }
    // The app itself set the iframe's src: let it load.
    const initiator = e.initiator
    if (!initiator || initiator.frameTreeNodeId === webContents.mainFrame.frameTreeNodeId) return

    // A link clicked inside the document: let the UI switch documents so the
    // title, tags and status always belong to what you are reading.
    e.preventDefault()
    const target = parseDocUrl(e.url)
    if (!target) return
    if (hasDoc(target.path)) {
      webContents.send('doc:navigate', target.path, target.hash)
    } else {
      openLibraryFile(target.path, true).catch((err) => console.error('open failed', err))
    }
  })

  webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })

  // Back/forward buttons on the mouse (Windows sends them as "app commands").
  win.on('app-command', (_e, command) => {
    if (command === 'browser-backward') webContents.send('nav:history', 'back')
    if (command === 'browser-forward') webContents.send('nav:history', 'forward')
  })

  // The UI blocks closing while an edit is unsaved; ask what to do.
  webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      title: 'Thay đổi chưa lưu',
      message: 'Bạn đang có thay đổi chưa lưu.',
      detail: 'Thoát bây giờ sẽ mất các thay đổi đó.',
      buttons: ['Ở lại', 'Thoát, bỏ thay đổi'],
      defaultId: 0,
      cancelId: 0
    })
    if (choice === 1) e.preventDefault() // preventDefault here means "close anyway"
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => (win = null))
}

// ---------- startup ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Opening another file from Explorer while the app runs starts a second copy, which quits
  // at once and hands its command line over to this one.
  app.on('second-instance', (_e, argv, cwd) => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
    const [file] = filesInArgs(argv, cwd)
    if (file) void openFromExplorer(file)
  })

  app.whenReady().then(async () => {
    protocol.handle('doc', async (request) => {
      const target = parseDocUrl(request.url) // null for malformed URLs such as a stray "%"
      // Hidden files (.docs-meta.json, .docs-notes.json, backups...) are the app's own data,
      // never something a page may load.
      const hidden = target?.path.split('/').some((part) => part.startsWith('.'))
      const abs = target && !hidden ? inLibrary(target.path) : null
      if (!abs) return new Response('Not found', { status: 404 })

      // ?edit=1 on an HTML doc: serve it with the inline editor script, and switch off the
      // page's own scripts (only the script with this nonce may run).
      if (new URL(request.url).searchParams.get('edit') === '1' && kindOf(abs) === 'html') {
        const nonce = randomBytes(16).toString('base64')
        const source = await fs.readFile(abs, 'utf8')
        return new Response(source + editModeInjection(nonce), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': `script-src 'nonce-${nonce}'; object-src 'none'`
          }
        })
      }
      if (kindOf(abs) === 'html') {
        const params = new URL(request.url).searchParams
        const html = (body: string, csp?: string): Response =>
          new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...(csp ? { 'Content-Security-Policy': csp } : {}) } })
        const source = await fs.readFile(abs, 'utf8')
        // Export to PDF: the page as it is, plus (if asked) its highlights and notes.
        if (params.get('print') === '1') {
          const loc = locate(target!.path)
          const withNotes = params.get('notes') === '1'
          const notes = withNotes ? (loc?.root.notes?.byDoc()[loc.rel] ?? []) : []
          const docNote = withNotes ? (loc?.root.notes?.docNotes()[loc.rel] ?? '') : ''
          // When printing, the page is not in the sandboxed iframe, so it must not be able to
          // read other files (fetch, frames, workers) and send them anywhere. Fonts, images
          // and styles still load so the PDF looks right.
          return html(notes.length || docNote ? source + printNotesInjection(notes, docNote) : source, PRINT_CSP)
        }
        // Reading mode: add the helper for outline, highlights, reading position and shortcuts.
        return html(source + viewModeInjection())
      }
      return net.fetch(pathToFileURL(abs).toString())
    })

    registerIpc()
    nativeTheme.themeSource = (await loadUiSettings()).theme

    scanCache = new ScanCache(path.join(app.getPath('userData'), 'scan-cache.json'))
    await scanCache.load()
    search = new SearchService(path.join(app.getPath('userData'), 'text-cache'), (status) =>
      win?.webContents.send('search:status', status)
    )

    // Show the window right away; folders are scanned in the background and appear as they finish.
    createWindow()
    startAutoUpdate(() => win)

    // DOCS_LIBRARY lets you (or the smoke test) open folders directly, separated by ";".
    const fromEnv = (process.env.DOCS_LIBRARY ?? '').split(path.delimiter).filter(Boolean)
    await openWorkspace(fromEnv.length ? fromEnv : await loadWorkspacePaths())

    // Started by double-clicking a document in Explorer.
    const [file] = filesInArgs(process.argv)
    if (file) await openFromExplorer(file)
  })

  app.on('window-all-closed', () => app.quit())
  // Keep what was learned about the files for the next start.
  app.on('before-quit', () => scanCache?.saveSync())
}
