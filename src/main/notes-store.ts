// Highlights and notes of the documents in one workspace folder: <folder>/.docs-notes.json.
// Documents themselves are never changed. File safety (write queue, corrupt-file backup,
// following renames) lives in DocStore.

import type { Annotation, DocEntry, HighlightColor } from '../shared/types'
import { DocStore, type DocKeyed } from './doc-store'

export const NOTES_FILE = '.docs-notes.json'

interface DocNotes extends DocKeyed {
  items: Annotation[]
}

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink']
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Keeps only known fields with sane sizes; anything coming from the UI goes through here. */
export function sanitizeAnnotation(input: Partial<Annotation>, now = Date.now()): Annotation {
  if (typeof input.id !== 'string' || !/^[\w-]{6,64}$/.test(input.id)) throw new Error('Ghi chú không hợp lệ (id)')
  const quote = text(input.quote, 5000)
  if (!quote.trim()) throw new Error('Ghi chú không hợp lệ (đoạn trích trống)')
  return {
    id: input.id,
    color: COLORS.includes(input.color as HighlightColor) ? (input.color as HighlightColor) : 'yellow',
    note: text(input.note, 20000),
    quote,
    prefix: text(input.prefix, 64),
    suffix: text(input.suffix, 64),
    ...(typeof input.cfi === 'string' ? { cfi: input.cfi.slice(0, 2000) } : {}),
    created: typeof input.created === 'number' ? input.created : now,
    updated: now
  }
}

export class NotesStore extends DocStore<DocNotes> {
  private constructor(root: string) {
    super(root, NOTES_FILE, 'highlight và ghi chú')
  }

  static async open(root: string): Promise<NotesStore> {
    const store = new NotesStore(root)
    await store.load()
    return store
  }

  /** Document path -> its annotations (documents without any are left out). */
  byDoc(): Record<string, Annotation[]> {
    const out: Record<string, Annotation[]> = {}
    for (const [p, entry] of Object.entries(this.docs)) if (entry.items?.length) out[p] = entry.items
    return out
  }

  /** Adds or replaces one annotation (matched by id). Resolves with the document's annotations. */
  save(docPath: string, annotation: Annotation, doc?: Pick<DocEntry, 'hash' | 'name'>): Promise<Annotation[]> {
    return this.enqueue(async () => {
      const entry = this.docs[docPath] ?? { items: [] }
      const items = entry.items.some((a) => a.id === annotation.id)
        ? entry.items.map((a) => (a.id === annotation.id ? annotation : a))
        : [...entry.items, annotation]
      await this.write({ ...this.docs, [docPath]: { ...entry, hash: doc?.hash ?? entry.hash, name: doc?.name ?? entry.name, items } })
      return items
    })
  }

  /** Deletes one annotation. Resolves with the document's remaining annotations. */
  remove(docPath: string, id: string): Promise<Annotation[]> {
    return this.enqueue(async () => {
      const entry = this.docs[docPath]
      if (!entry) return []
      const items = entry.items.filter((a) => a.id !== id)
      const next = { ...this.docs }
      if (items.length) next[docPath] = { ...entry, items }
      else delete next[docPath]
      await this.write(next)
      return items
    })
  }
}
