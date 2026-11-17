// The only bridge between the UI and Node. The UI can call exactly these functions
// and nothing else, so a document can never reach the file system on its own.

import { contextBridge, ipcRenderer } from 'electron'
import type { DocsApi, LibrarySnapshot } from '../shared/types'

const api: DocsApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  readDoc: (path) => ipcRenderer.invoke('doc:read', path),
  updateMeta: (path, patch) => ipcRenderer.invoke('meta:update', path, patch),
  openExternal: (path) => ipcRenderer.invoke('doc:openExternal', path),
  revealInFolder: (path) => ipcRenderer.invoke('doc:reveal', path),
  onLibraryChanged: (cb) => {
    const listener = (_e: unknown, snapshot: LibrarySnapshot): void => cb(snapshot)
    ipcRenderer.on('library:changed', listener)
    return () => ipcRenderer.removeListener('library:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
