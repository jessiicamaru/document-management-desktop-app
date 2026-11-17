// Electron main process: owns the window, the file system and the `doc://` protocol.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DocEntry, DocMeta, HtmlBlockEdit, LibrarySnapshot, UiSettings } from '../shared/types'
import { applyHtmlEdits, editModeInjection, HtmlEditError } from './html-edit'
import { kindOf, resolveInLibrary, scanLibrary } from './library'
import { META_FILE, MetaStore } from './meta-store'
import { loadRecent, loadSettings, loadUiSettings, markOpened, sanitizeUi, saveSettings } from './storage'
import { checkForUpdatesNow, getUpdateStatus, installUpdateNow, startAutoUpdate } from './updater'

// Tests run with their own settings folder so they never touch your real settings.
if (process.env.STUDYDOCS_USER_DATA) app.setPath('userData', process.env.STUDYDOCS_USER_DATA)

// Documents are served as doc://library/<relative path>. A "standard" scheme means
// relative links inside an HTML document (images, other pages) resolve normally.
protocol.registerSchemesAsPrivileged([
  { scheme: 'doc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

/** File types that are never launched from a link; they are shown in Explorer instead. */
const EXECUTABLE = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.scr', '.lnk', '.pif', '.hta', '.cpl', '.jar', '.reg', '.msc', '.appref-ms'
])

let win: BrowserWindow | null = null
let root: string | null = null
let docs: DocEntry[] = []
let metaStore: MetaStore | null = null
let watcher: FSWatcher | null = null
let libraryWarning: string | null = null

// ---------- library ----------

const inLibrary = (rel: string): string | null => (root ? resolveInLibrary(root, rel) : null)

/** Splits doc://library/a/b.html#part into { path: 'a/b.html', hash: 'part' }. */
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

async function snapshot(): Promise<LibrarySnapshot> {
  const warnings = [metaStore?.warning, libraryWarning].filter((w): w is string => !!w)
  return {
    root,
    docs,
    meta: metaStore?.all() ?? {},
    recent: root ? await loadRecent(root) : {},
    warnings
  }
}

async function pushSnapshot(): Promise<void> {
  win?.webContents.send('library:changed', await snapshot())
}

async function openLibrary(dir: string | null): Promise<LibrarySnapshot> {
  watcher?.close()
  watcher = null
  root = dir
  docs = []
  metaStore = null
  libraryWarning = null
  if (!dir) return snapshot()

  try {
    if (!(await fs.stat(dir)).isDirectory()) throw new Error('not a folder')
    metaStore = await MetaStore.open(dir)
  } catch {
    libraryWarning = `Không mở được thư mục tài liệu: ${dir}. Hãy bấm icon thư mục để chọn lại.`
    return snapshot()
  }
  docs = await scanLibrary(dir)
  await metaStore.reconcile(docs).catch((err) => console.error('reconcile failed', err))
  watchLibrary(dir)
  return snapshot()
}

function watchLibrary(dir: string): void {
  let rescanTimer: NodeJS.Timeout | undefined
  let metaTimer: NodeJS.Timeout | undefined

  const rescan = async (): Promise<void> => {
    if (root !== dir) return
    docs = await scanLibrary(dir, docs)
    await metaStore?.reconcile(docs).catch((err) => console.error('reconcile failed', err))
    await pushSnapshot()
  }
  const reloadMeta = async (): Promise<void> => {
    if (root !== dir || !metaStore) return
    const changed = await metaStore.reloadFromDisk().catch(() => false)
    if (changed || metaStore.warning) await pushSnapshot()
  }

  try {
    // Windows supports recursive watching natively, no extra dependency needed.
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      const name = String(filename ?? '')
      if (name === META_FILE) {
        // Changed by a sync tool or another PC (our own writes are recognised and skipped).
        clearTimeout(metaTimer)
        metaTimer = setTimeout(() => void reloadMeta(), 400)
        return
      }
      // Other hidden files (backups, temp files) and node_modules are not documents.
      if (name.split(/[\\/]/).some((p) => p.startsWith('.') || p === 'node_modules')) return
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(() => void rescan(), 400)
    })
    // Happens when the folder is deleted, renamed or on a USB drive that was removed.
    watcher.on('error', (err) => {
      console.error('watcher error', err)
      watcher?.close()
      watcher = null
      libraryWarning = 'Mất kết nối với thư mục tài liệu (bị xoá, đổi tên hoặc rút ổ). App không còn tự cập nhật khi file thay đổi.'
      void pushSnapshot()
    })
  } catch (err) {
    console.error('Cannot watch library folder', err)
    libraryWarning = 'Không theo dõi được thư mục tài liệu; app sẽ không tự cập nhật khi file thay đổi.'
  }
}

/** Opens a library file with its default app; programs/scripts are only shown in Explorer. */
async function openLibraryFile(rel: string): Promise<void> {
  const abs = inLibrary(rel)
  if (!abs) throw new Error('File nằm ngoài thư mục tài liệu')
  if (EXECUTABLE.has(path.extname(abs).toLowerCase())) {
    shell.showItemInFolder(abs)
    return
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
  if (!abs || !kindOf(abs)) throw new Error('Chỉ sửa được file .md / .html trong thư mục tài liệu.')
  const stat = await fs.stat(abs)
  if (Math.abs(stat.mtimeMs - expectedMtime) > 1) {
    throw new Error('File vừa bị thay đổi bên ngoài app. Bài đã được tải lại; hãy sửa lại thay đổi của bạn.')
  }
  const content = build(await fs.readFile(abs, 'utf8'))
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
  ipcMain.handle('library:get', () => snapshot())

  ipcMain.handle('library:choose', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Chọn thư mục tài liệu',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return snapshot()
    await saveSettings({ libraryPath: result.filePaths[0] })
    return openLibrary(result.filePaths[0])
  })

  ipcMain.handle('doc:read', async (_e, rel: string) => {
    const abs = inLibrary(rel)
    if (!abs) throw new Error('File nằm ngoài thư mục tài liệu')
    return fs.readFile(abs, 'utf8')
  })

  ipcMain.handle('meta:update', async (_e, rel: string, patch: Partial<DocMeta>) => {
    if (!metaStore || !inLibrary(rel)) throw new Error('File nằm ngoài thư mục tài liệu')
    // Only tags and status can be changed from the UI.
    const clean: Partial<DocMeta> = {}
    if (Array.isArray(patch.tags)) clean.tags = patch.tags.map(String)
    if (patch.status) clean.status = patch.status
    try {
      return await metaStore.update(rel, clean, docs.find((d) => d.path === rel))
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  ipcMain.handle('doc:opened', async (_e, rel: string) => {
    if (!root) return {}
    try {
      return await markOpened(root, rel)
    } catch (err) {
      throw friendlyWriteError(err)
    }
  })

  ipcMain.handle('doc:openPath', (_e, rel: string) => openLibraryFile(rel))

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
    if (docs.some((d) => d.path === target.path)) {
      webContents.send('doc:navigate', target.path, target.hash)
    } else {
      openLibraryFile(target.path).catch((err) => console.error('open failed', err))
    }
  })

  webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
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
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })

  app.whenReady().then(async () => {
    protocol.handle('doc', async (request) => {
      const target = parseDocUrl(request.url) // null for malformed URLs such as a stray "%"
      const abs = target ? inLibrary(target.path) : null
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
      return net.fetch(pathToFileURL(abs).toString())
    })

    registerIpc()
    nativeTheme.themeSource = (await loadUiSettings()).theme

    // DOCS_LIBRARY lets you (or the smoke test) point the app at a folder directly.
    const settings = await loadSettings()
    await openLibrary(process.env.DOCS_LIBRARY || settings.libraryPath || null)

    createWindow()
    startAutoUpdate(() => win)
  })

  app.on('window-all-closed', () => app.quit())
}
