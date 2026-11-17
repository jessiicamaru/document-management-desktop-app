// Auto-update from GitHub Releases (electron-updater).
//
// How it works: the installed app reads release info from the repo configured in
// package.json > build.publish. When a newer version exists it is downloaded in the
// background; it is installed when you click "Khởi động lại để cập nhật" or the next
// time you quit the app. Only runs in the installed app, never in `npm run dev`.

import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateCheck, UpdateStatus } from '../shared/types'
import { t } from '../shared/i18n'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000 // every 4 hours while the app stays open

let status: UpdateStatus = { state: 'idle' }

export const getUpdateStatus = (): UpdateStatus => status

export function startAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const set = (next: UpdateStatus): void => {
    status = next
    getWindow()?.webContents.send('update:status', next)
  }

  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => set({ ...status, state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  // Offline, GitHub down, no release yet...: not worth bothering you, just try again later.
  autoUpdater.on('error', (err) => {
    console.error('Update check failed:', err.message)
    if (status.state === 'downloading') set({ state: 'idle' })
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err: Error) => console.error('Update check failed:', err.message))
  }
  check()
  setInterval(check, CHECK_EVERY_MS)
}

/** "Kiểm tra cập nhật" button in Settings: says plainly whether there is something new. */
export async function checkForUpdatesNow(): Promise<UpdateCheck> {
  if (!app.isPackaged) throw new Error(t('Đang chạy bản dev (npm run dev): không có cập nhật.'))
  if (status.state === 'ready') return { result: 'ready', version: status.version ?? '' }
  if (status.state === 'downloading') return { result: 'downloading', version: status.version ?? '' }
  let check
  try {
    check = await autoUpdater.checkForUpdates()
  } catch (err) {
    throw new Error(t('Không kiểm tra được cập nhật (mất mạng hoặc GitHub không phản hồi): {0}', { 0: (err as Error).message }))
  }
  if (check?.isUpdateAvailable) return { result: 'downloading', version: check.updateInfo.version }
  return { result: 'latest', version: app.getVersion() }
}

/** Closes the app, installs the downloaded update silently and starts the new version. */
export function installUpdateNow(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
}
