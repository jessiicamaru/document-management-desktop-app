// Pure helpers for a workspace made of several folders ("roots"), e.g. D:\Học and C:\Notes.
//
// Every document gets a workspace-wide id "<rootKey>/<path inside that folder>".
// rootKey is a short hash of the folder's absolute path, so it is stable between sessions
// and two folders never collide even if they have the same name.
// No Electron imports here, so this file is unit tested directly.

import { createHash } from 'node:crypto'
import path from 'node:path'
import { t } from '../shared/i18n'

const caseInsensitive = process.platform === 'win32'

/** Absolute path without a trailing separator. */
export function normalizeRoot(p: string): string {
  const abs = path.resolve(p)
  return abs.length > path.parse(abs).root.length ? abs.replace(/[\\/]+$/, '') : abs
}

/** Comparable form of a path (Windows paths are case-insensitive). */
export function pathKey(p: string): string {
  const n = normalizeRoot(p)
  return caseInsensitive ? n.toLowerCase() : n
}

export function rootKeyOf(rootPath: string): string {
  return createHash('sha1').update(pathKey(rootPath)).digest('hex').slice(0, 8)
}

/** "<rootKey>/<rel>" -> { key, rel }. */
export function splitDocId(id: string): { key: string; rel: string } | null {
  const slash = id.indexOf('/')
  if (slash <= 0 || slash === id.length - 1) return null
  return { key: id.slice(0, slash), rel: id.slice(slash + 1) }
}

/** True if `inner` is the same folder as `outer` or somewhere inside it. */
export function isSameOrInside(inner: string, outer: string): boolean {
  const a = pathKey(inner)
  const b = pathKey(outer)
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

/**
 * Why `candidate` can't be added next to `existing` folders, or null if it can.
 * Nested folders are refused, otherwise the same document would appear twice.
 */
export function rootConflict(existing: string[], candidate: string): string | null {
  for (const root of existing) {
    if (pathKey(root) === pathKey(candidate)) return t('{0} đã có trong workspace.', { 0: candidate })
    if (isSameOrInside(candidate, root)) return t('{0} nằm bên trong {1}, vốn đã có trong workspace.', { 0: candidate, 1: root })
    if (isSameOrInside(root, candidate)) return t('{0} chứa {1}, vốn đã có trong workspace. Hãy bỏ {2} trước.', { 0: candidate, 1: root, 2: root })
  }
  return null
}

/**
 * Display names for the folders: the folder name, plus where it is when two folders
 * share a name ("Docs (D:)", "Docs (C:\Users\me)").
 */
export function labelRoots(paths: string[]): string[] {
  const base = paths.map((p) => path.basename(normalizeRoot(p)) || normalizeRoot(p))
  return paths.map((p, i) => {
    const clash = base.some((b, j) => j !== i && b.toLowerCase() === base[i].toLowerCase())
    if (!clash) return base[i]
    const parent = path.dirname(normalizeRoot(p))
    const hint = parent === path.parse(parent).root ? parent.replace(/[\\/]+$/, '') : parent
    return `${base[i]} (${hint})`
  })
}
