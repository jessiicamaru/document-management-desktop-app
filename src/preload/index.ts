// The only bridge between the UI and Node. The UI can call exactly these functions
// and nothing else, so a document can never reach the file system on its own.

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AskRequest, DocsApi, LibrarySnapshot, SearchStatus, UpdateStatus } from '../shared/types'

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
  saveDocNote: (path, text) => ipcRenderer.invoke('notes:docNote', path, text),
  renameTag: (from, to) => ipcRenderer.invoke('tags:rename', from, to),
  deleteTag: (tag) => ipcRenderer.invoke('tags:delete', tag),
  cleanOrphans: () => ipcRenderer.invoke('library:cleanOrphans'),
  restoreBackup: (root, file) => ipcRenderer.invoke('recovery:restore', root, file),
  discardBackup: (root, file) => ipcRenderer.invoke('recovery:discard', root, file),
  revealBackup: (root, file) => ipcRenderer.invoke('recovery:reveal', root, file),
  onAsk: (cb) => listen<[number, AskRequest]>('dialog:ask', cb),
  answerAsk: (id, index) => ipcRenderer.invoke('dialog:answer', id, index),
  openFiles: () => ipcRenderer.invoke('files:open'),
  addFiles: (paths) => ipcRenderer.invoke('files:add', paths),
  removeLooseFile: (path) => ipcRenderer.invoke('files:remove', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  readBinary: (path) => ipcRenderer.invoke('doc:readBinary', path),
  search: (query) => ipcRenderer.invoke('search', query),
  onSearchStatus: (cb) => listen<[SearchStatus]>('search:status', cb),
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
