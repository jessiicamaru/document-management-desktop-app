// App-level JSON files in Electron's userData folder (%APPDATA%\Study Docs):
//  - settings.json: which library folder to open
//  - recent.json:   when you last opened each document, per library
// "Recently opened" changes on every click, so it is kept here instead of in the
// library's .docs-meta.json, which may be synced between computers.

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_UI, type UiSettings } from '../shared/types'

interface Settings {
  libraryPath?: string
  ui?: Partial<UiSettings>
}

type RecentFile = Record<string, Record<string, number>>

const MAX_RECENT = 50
const file = (name: string): string => path.join(app.getPath('userData'), name)

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file(name), 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(name: string, data: unknown): Promise<void> {
  const target = file(name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(`${target}.tmp`, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(`${target}.tmp`, target)
}

export const loadSettings = (): Promise<Settings> => readJson<Settings>('settings.json', {})

/** Merges `patch` into settings.json so library path and appearance don't overwrite each other. */
export async function saveSettings(patch: Settings): Promise<void> {
  await writeJson('settings.json', { ...(await loadSettings()), ...patch })
}

const HEX = /^#[0-9a-f]{6}$/i

/** Reads appearance settings, replacing anything missing or invalid with the default. */
export async function loadUiSettings(): Promise<UiSettings> {
  const ui = { ...DEFAULT_UI, ...(await loadSettings()).ui }
  return sanitizeUi(ui)
}

export function sanitizeUi(ui: Partial<UiSettings>): UiSettings {
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
  return {
    theme: pick(ui.theme, ['system', 'light', 'dark'] as const, DEFAULT_UI.theme),
    accent: typeof ui.accent === 'string' && HEX.test(ui.accent) ? ui.accent : DEFAULT_UI.accent,
    readingSize: Math.min(24, Math.max(13, Math.round(Number(ui.readingSize) || DEFAULT_UI.readingSize))),
    readingFont: pick(ui.readingFont, ['sans', 'serif'] as const, DEFAULT_UI.readingFont),
    readingWidth: pick(ui.readingWidth, ['narrow', 'normal', 'wide'] as const, DEFAULT_UI.readingWidth)
  }
}

// recent.json is written one call at a time, same idea as MetaStore.
let recentQueue: Promise<unknown> = Promise.resolve()

export async function loadRecent(root: string): Promise<Record<string, number>> {
  return (await readJson<RecentFile>('recent.json', {}))[root] ?? {}
}

export function markOpened(root: string, docPath: string): Promise<Record<string, number>> {
  const run = recentQueue.then(async () => {
    const all = await readJson<RecentFile>('recent.json', {})
    const entries = Object.entries({ ...all[root], [docPath]: Date.now() })
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RECENT)
    all[root] = Object.fromEntries(entries)
    await writeJson('recent.json', all)
    return all[root]
  })
  recentQueue = run.catch(() => undefined)
  return run
}
