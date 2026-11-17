// Tags and study status of the documents in one workspace folder: data\<folder key>\meta.json
// in the app's data folder.
// File safety (write queue, corrupt-file backup, following renames) lives in DocStore.

import { DEFAULT_META, type DocEntry, type DocMeta } from '../shared/types'
import { DocStore } from './doc-store'
import { t } from '../shared/i18n'

export const META_FILE = 'meta.json'

export class MetaStore extends DocStore<DocMeta> {
  private constructor(root: string) {
    super(root, META_FILE, t('tag và trạng thái'))
  }

  static async open(root: string): Promise<MetaStore> {
    const store = new MetaStore(root)
    await store.load()
    return store
  }

  /** Tags from both versions; the status that shows more progress. */
  protected mergeEntry(a: DocMeta, b: DocMeta): DocMeta {
    const order = ['new', 'learning', 'review', 'done']
    const status = order.indexOf(b.status) > order.indexOf(a.status) ? b.status : a.status
    return { ...b, ...a, tags: [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])], status: status ?? 'new' }
  }

  /** Renames a tag on every document (merging with the new name if it exists). Returns how many changed. */
  renameTag(from: string, to: string): Promise<number> {
    return this.retag((tags) => (tags.includes(from) ? tags.map((t) => (t === from ? to.trim() : t)) : null))
  }

  /** Removes a tag from every document. Returns how many changed. */
  deleteTag(tag: string): Promise<number> {
    return this.retag((tags) => (tags.includes(tag) ? tags.filter((t) => t !== tag) : null))
  }

  private retag(change: (tags: string[]) => string[] | null): Promise<number> {
    return this.enqueue(async () => {
      const next = { ...this.docs }
      let n = 0
      for (const [p, m] of Object.entries(next)) {
        const tags = change(m.tags ?? [])
        if (!tags) continue
        next[p] = { ...m, tags: [...new Set(tags.filter(Boolean))] }
        n++
      }
      if (n) await this.write(next)
      return n
    })
  }

  /** Changes tags/status of one document. Resolves with the full metadata after it is saved. */
  update(docPath: string, patch: Partial<DocMeta>, doc?: Pick<DocEntry, 'hash' | 'name'>): Promise<Record<string, DocMeta>> {
    return this.enqueue(async () => {
      const merged: DocMeta = { ...DEFAULT_META, ...this.docs[docPath], ...patch }
      merged.tags = [...new Set(merged.tags.map((t) => t.trim()).filter(Boolean))]
      if (doc?.hash) merged.hash = doc.hash
      if (doc?.name) merged.name = doc.name
      await this.write({ ...this.docs, [docPath]: merged })
      return this.docs
    })
  }
}
