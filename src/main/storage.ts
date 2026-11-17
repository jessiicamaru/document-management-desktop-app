// Small JSON files on disk:
//  - app settings (which library folder to open) live in Electron's userData folder
//  - per-document metadata (tags, study status) lives inside the library itself,
//    so it travels with your documents if you sync the folder (Git, OneDrive...).

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_META, type DocMeta } from '../shared/types'

export const META_FILE = '.docs-meta.json'

interface Settings {
  libraryPath?: string
}

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Write to a temp file first, then rename, so a crash never leaves half a JSON file. */
async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export const loadSettings = (): Promise<Settings> => readJson<Settings>(settingsFile(), {})
export const saveSettings = (s: Settings): Promise<void> => writeJson(settingsFile(), s)

interface MetaFile {
  version: 1
  docs: Record<string, DocMeta>
}

export async function loadMeta(root: string): Promise<Record<string, DocMeta>> {
  const file = await readJson<MetaFile>(path.join(root, META_FILE), { version: 1, docs: {} })
  return file.docs ?? {}
}

export async function updateMeta(
  root: string,
  docPath: string,
  patch: Partial<DocMeta>
): Promise<Record<string, DocMeta>> {
  const docs = await loadMeta(root)
  const next: DocMeta = { ...DEFAULT_META, ...docs[docPath], ...patch }
  next.tags = [...new Set(next.tags.map((t) => t.trim()).filter(Boolean))]
  docs[docPath] = next
  await writeJson(path.join(root, META_FILE), { version: 1, docs } satisfies MetaFile)
  return docs
}
