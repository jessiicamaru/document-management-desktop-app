// Electron main process: owns the window, the file system and the `doc://` protocol.

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DocEntry, DocMeta, LibrarySnapshot } from '../shared/types'
import { scanLibrary } from './library'
import { loadMeta, loadSettings, saveSettings, updateMeta } from './storage'

// Documents are served as doc://library/<relative path>. A "standard" scheme means
// relative links inside an HTML document (images, other pages) resolve normally.
protocol.registerSchemesAsPrivileged([
  { scheme: 'doc', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let win: BrowserWindow | null = null
let root: string | null = null
let docs: DocEntry[] = []
let watcher: FSWatcher | null = null

// ---------- library ----------

/** Turns a relative doc path into an absolute one, refusing anything outside the library. */
function resolveInLibrary(rel: string): string | null {
  if (!root) return null
  const base = path.resolve(root)
  const abs = path.resolve(base, rel)
  return abs.startsWith(base + path.sep) ? abs : null
}

async function snapshot(): Promise<LibrarySnapshot> {
  return { root, docs, meta: root ? await loadMeta(root) : {} }
}

async function openLibrary(dir: string | null): Promise<LibrarySnapshot> {
  watcher?.close()
  watcher = null
  root = dir
  docs = dir ? await scanLibrary(dir) : []
  if (dir) watchLibrary(dir)
  return snapshot()
}

function watchLibrary(dir: string): void {
  let timer: NodeJS.Timeout | undefined
  try {
    // Windows supports recursive watching natively, no extra dependency needed.
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      // Ignore hidden files such as .docs-meta.json (written by this app).
      const parts = (filename ?? '').split(/[\\/]/)
      if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return
      clearTimeout(timer)
      timer = setTimeout(async () => {
        if (root !== dir) return
        docs = await scanLibrary(dir)
        win?.webContents.send('library:changed', await snapshot())
      }, 400)
    })
  } catch (err) {
    console.error('Cannot watch library folder', err)
  }
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
    const abs = resolveInLibrary(rel)
    if (!abs) throw new Error('Path outside library')
    const { readFile } = await import('node:fs/promises')
    return readFile(abs, 'utf8')
  })

  ipcMain.handle('meta:update', (_e, rel: string, patch: Partial<DocMeta>) => {
    if (!root || !resolveInLibrary(rel)) throw new Error('Path outside library')
    return updateMeta(root, rel, patch)
  })

  ipcMain.handle('doc:openExternal', async (_e, rel: string) => {
    const abs = resolveInLibrary(rel)
    if (abs) await shell.openPath(abs)
  })

  ipcMain.handle('doc:reveal', (_e, rel: string) => {
    const abs = resolveInLibrary(rel)
    if (abs) shell.showItemInFolder(abs)
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
  // Inside a document iframe: allow other library docs, send web links to the browser.
  webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return
    if (e.url.startsWith('doc://') || e.url.startsWith('about:')) return
    e.preventDefault()
    openInBrowser(e.url)
  })
  webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
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
    protocol.handle('doc', (request) => {
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
      const abs = resolveInLibrary(rel)
      if (!abs) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(abs).toString())
    })

    registerIpc()

    // DOCS_LIBRARY lets you (or the smoke test) point the app at a folder directly.
    const settings = await loadSettings()
    await openLibrary(process.env.DOCS_LIBRARY || settings.libraryPath || null)

    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
