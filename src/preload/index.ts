// The only bridge between the UI and Node. The UI can call exactly these functions
// and nothing else, so a document can never reach the file system on its own.

import { contextBridge, ipcRenderer } from 'electron'
import type { DocsApi, LibrarySnapshot } from '../shared/types'

/** Subscribes to a main-process event and returns an unsubscribe function. */
function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DocsApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  readDoc: (path) => ipcRenderer.invoke('doc:read', path),
  updateMeta: (path, patch) => ipcRenderer.invoke('meta:update', path, patch),
  markOpened: (path) => ipcRenderer.invoke('doc:opened', path),
  openPath: (path) => ipcRenderer.invoke('doc:openPath', path),
  revealInFolder: (path) => ipcRenderer.invoke('doc:reveal', path),
  onLibraryChanged: (cb) => listen<[LibrarySnapshot]>('library:changed', cb),
  onNavigate: (cb) => listen<[string, string]>('doc:navigate', cb)
}

contextBridge.exposeInMainWorld('api', api)
