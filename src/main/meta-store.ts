// Tags and study status of the documents in one workspace folder: <folder>/.docs-meta.json.
// File safety (write queue, corrupt-file backup, following renames) lives in DocStore.

import { DEFAULT_META, type DocEntry, type DocMeta } from '../shared/types'
import { DocStore } from './doc-store'

export const META_FILE = '.docs-meta.json'

export class MetaStore extends DocStore<DocMeta> {
  private constructor(root: string) {
    super(root, META_FILE, 'tag và trạng thái')
  }

  static async open(root: string): Promise<MetaStore> {
    const store = new MetaStore(root)
    await store.load()
    return store
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
