// The only bridge between the UI and Node. The UI can call exactly these functions
// and nothing else, so a document can never reach the file system on its own.

import { contextBridge, ipcRenderer } from 'electron'
import type { DocsApi, LibrarySnapshot, UpdateStatus } from '../shared/types'

/** Subscribes to a main-process event and returns an unsubscribe function. */
function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DocsApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  addFolders: () => ipcRenderer.invoke('workspace:add'),
  removeFolder: (key) => ipcRenderer.invoke('workspace:remove', key),
  readDoc: (path) => ipcRenderer.invoke('doc:read', path),
  updateMeta: (path, patch) => ipcRenderer.invoke('meta:update', path, patch),
  markOpened: (path) => ipcRenderer.invoke('doc:opened', path),
  openPath: (path) => ipcRenderer.invoke('doc:openPath', path),
  revealInFolder: (path) => ipcRenderer.invoke('doc:reveal', path),
  onLibraryChanged: (cb) => listen<[LibrarySnapshot]>('library:changed', cb),
  onNavigate: (cb) => listen<[string, string]>('doc:navigate', cb),
  onHistory: (cb) => listen<['back' | 'forward']>('nav:history', cb),
  exportPdf: (path, withNotes) => ipcRenderer.invoke('doc:exportPdf', path, withNotes),
  saveAnnotation: (path, annotation) => ipcRenderer.invoke('notes:save', path, annotation),
  deleteAnnotation: (path, id) => ipcRenderer.invoke('notes:delete', path, id),
  readBinary: (path) => ipcRenderer.invoke('doc:readBinary', path),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onUpdateStatus: (cb) => listen<[UpdateStatus]>('update:status', cb),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  getUiSettings: () => ipcRenderer.invoke('settings:get'),
  setUiSettings: (ui) => ipcRenderer.invoke('settings:set', ui),
  writeDoc: (path, content, expectedMtime) => ipcRenderer.invoke('doc:write', path, content, expectedMtime),
  saveHtmlEdits: (path, edits, expectedMtime) => ipcRenderer.invoke('doc:saveHtmlEdits', path, edits, expectedMtime)
}

contextBridge.exposeInMainWorld('api', api)
