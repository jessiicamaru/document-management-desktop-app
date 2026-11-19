// Finding a folder's tags and notes again after its path changed (review point 2).
//
// Data is kept per folder path (data\<key of the path>). When a folder is renamed or moved,
// a USB drive gets another letter, or the folder is opened on another PC, its data stays
// under the old key. Every stored entry remembers the document's content hash and file
// name, so the old data can be recognised by comparing those with the files found now.
//
// No Electron imports here, so this file is unit tested directly.

/** What a stored entry remembers about its document. */
export interface Remembered {
  hash?: string
  name?: string
}

/** A document found in the folder now. */
export interface FoundDoc {
  path: string
  hash?: string
  name: string
}

export interface MatchScore {
  /** Stored entries in the old data. */
  total: number
  /** Entries that match a file found now (same content, or same file name). */
  matched: number
  /** Of those, matched by content. */
  byContent: number
}

const index = (docs: FoundDoc[]): { paths: Set<string>; hashes: Map<string, FoundDoc[]>; names: Map<string, FoundDoc[]> } => {
  const hashes = new Map<string, FoundDoc[]>()
  const names = new Map<string, FoundDoc[]>()
  for (const d of docs) {
    if (d.hash) hashes.set(d.hash, [...(hashes.get(d.hash) ?? []), d])
    names.set(d.name.toLowerCase(), [...(names.get(d.name.toLowerCase()) ?? []), d])
  }
  return { paths: new Set(docs.map((d) => d.path)), hashes, names }
}

/** How well old data fits the files of a folder. */
export function matchScore(entries: Record<string, Remembered>, docs: FoundDoc[]): MatchScore {
  const { paths, hashes, names } = index(docs)
  let matched = 0
  let byContent = 0
  const keys = Object.keys(entries)
  for (const rel of keys) {
    const e = entries[rel]
    if (e.hash && hashes.has(e.hash)) {
      matched++
      byContent++
    } else if (paths.has(rel) || (e.name && names.has(e.name.toLowerCase()))) {
      matched++
    }
  }
  return { total: keys.length, matched, byContent }
}

/**
 * True when the old data very likely belongs to this folder: at least half of its documents
 * are here, and either one of them has exactly the same content, or several match by name.
 */
export function looksLikeSameFolder(s: MatchScore): boolean {
  if (!s.total || s.matched / s.total < 0.5) return false
  return s.byContent >= 1 || s.matched >= 3
}

/**
 * Re-keys old entries to where their documents are now: the same path if it still exists,
 * otherwise the one file with the same content, otherwise the one file with the same name.
 * Entries that can't be placed keep their old path.
 */
export function remapEntries<V extends Remembered>(entries: Record<string, V>, docs: FoundDoc[]): Record<string, V> {
  const { paths, hashes, names } = index(docs)
  const out: Record<string, V> = {}
  for (const [rel, e] of Object.entries(entries)) {
    let target = rel
    if (!paths.has(rel)) {
      const sameContent = e.hash ? hashes.get(e.hash) : undefined
      const sameName = e.name ? names.get(e.name.toLowerCase()) : undefined
      if (sameContent?.length === 1) target = sameContent[0].path
      else if (!sameContent?.length && sameName?.length === 1) target = sameName[0].path
    }
    // Two old entries landing on the same document: keep the first (the caller merges data anyway).
    if (!(target in out)) out[target] = e
  }
  return out
}
