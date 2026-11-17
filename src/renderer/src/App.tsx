import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibrarySnapshot, StudyStatus } from '../../shared/types'
import { buildIndex, loadLocal, metaOf, saveLocal } from './lib/docs'
import Sidebar, { type SearchHit } from './components/Sidebar'
import DocView from './components/DocView'

export type StatusFilter = StudyStatus | 'all'

export default function App() {
  const [lib, setLib] = useState<LibrarySnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Load the library once, then follow changes on disk.
  useEffect(() => {
    void window.api.getLibrary().then((snap) => {
      setLib(snap)
      if (snap.root) setSelected(loadLocal<string | null>(`selected:${snap.root}`, null))
    })
    return window.api.onLibraryChanged(setLib)
  }, [])

  // Ctrl+K / Ctrl+P jumps to search, like in VS Code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const docs = lib?.docs ?? []
  const meta = lib?.meta ?? {}

  const openDoc = useCallback(
    (path: string) => {
      setSelected(path)
      if (lib?.root) saveLocal(`selected:${lib.root}`, path)
      void window.api.updateMeta(path, { lastOpened: Date.now() }).then((m) => setLib((l) => l && { ...l, meta: m }))
    },
    [lib?.root]
  )

  const chooseLibrary = useCallback(async () => {
    const snap = await window.api.chooseLibrary()
    setLib(snap)
    setSelected(snap.root ? loadLocal<string | null>(`selected:${snap.root}`, null) : null)
  }, [])

  const updateMeta = useCallback((path: string, patch: Parameters<typeof window.api.updateMeta>[1]) => {
    void window.api.updateMeta(path, patch).then((m) => setLib((l) => l && { ...l, meta: m }))
  }, [])

  // Only rebuild the search index when documents or tags change (not on every "lastOpened").
  const tagsKey = JSON.stringify(docs.map((d) => meta[d.path]?.tags ?? []))
  const index = useMemo(() => buildIndex(docs, meta), [docs, tagsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleDocs = useMemo(
    () =>
      docs.filter((d) => {
        const m = metaOf(meta, d.path)
        return (statusFilter === 'all' || m.status === statusFilter) && (!tagFilter || m.tags.includes(tagFilter))
      }),
    [docs, meta, statusFilter, tagFilter]
  )

  const hits: SearchHit[] | null = useMemo(() => {
    if (!query.trim()) return null
    const visible = new Set(visibleDocs.map((d) => d.path))
    const byPath = new Map(docs.map((d) => [d.path, d]))
    return index
      .search(query)
      .filter((r) => visible.has(r.id as string))
      .slice(0, 100)
      .map((r) => ({ doc: byPath.get(r.id as string)!, terms: r.terms }))
  }, [query, index, visibleDocs, docs])

  const current = docs.find((d) => d.path === selected) ?? null

  return (
    <div className="app">
      <Sidebar
        lib={lib}
        docs={visibleDocs}
        hits={hits}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        tagFilter={tagFilter}
        onTagFilter={setTagFilter}
        selected={selected}
        onOpen={openDoc}
        onChooseLibrary={chooseLibrary}
      />
      <main className="content">
        {current ? (
          <DocView
            key={current.path}
            doc={current}
            meta={metaOf(meta, current.path)}
            allDocs={docs}
            onUpdateMeta={(patch) => updateMeta(current.path, patch)}
            onOpenDoc={openDoc}
          />
        ) : (
          <Welcome hasLibrary={!!lib?.root} count={docs.length} onChoose={chooseLibrary} />
        )}
      </main>
    </div>
  )
}

function Welcome({ hasLibrary, count, onChoose }: { hasLibrary: boolean; count: number; onChoose: () => void }) {
  if (!hasLibrary) {
    return (
      <div className="welcome">
        <h1>Study Docs</h1>
        <p>Chọn một thư mục chứa tài liệu học của bạn (.md, .html). App chỉ đọc file, không sửa nội dung gốc.</p>
        <button className="btn primary" onClick={onChoose}>
          Chọn thư mục tài liệu
        </button>
      </div>
    )
  }
  return (
    <div className="welcome">
      <h1>{count} tài liệu</h1>
      <p>
        Chọn một bài ở thanh bên trái, hoặc nhấn <kbd>Ctrl</kbd> + <kbd>K</kbd> để tìm kiếm. Tìm không cần gõ dấu:
        "su kien" vẫn ra "sự kiện".
      </p>
    </div>
  )
}
