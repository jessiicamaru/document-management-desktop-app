import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, DocMeta, LibrarySnapshot, StudyStatus } from '../../shared/types'
import { buildIndex, errorMessage, loadLocal, metaOf, saveLocal } from './lib/docs'
import Sidebar, { type SearchHit } from './components/Sidebar'
import DocView from './components/DocView'

export type StatusFilter = StudyStatus | 'all'

/** Where to scroll inside the open document. `n` changes on every jump so the same #hash can be reused. */
export interface ScrollTarget {
  hash: string
  n: number
}

interface Toast {
  id: number
  text: string
}

export default function App() {
  const [lib, setLib] = useState<LibrarySnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget>({ hash: '', n: 0 })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  /** Shows an error message in the bottom-right corner for a few seconds. */
  const notify = useCallback((err: unknown) => {
    const toast = { id: Date.now() + Math.random(), text: errorMessage(err) }
    setToasts((t) => [...t, toast])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 6000)
  }, [])

  // Load the library once, then follow changes on disk.
  useEffect(() => {
    window.api
      .getLibrary()
      .then((snap) => {
        setLib(snap)
        if (snap.root) setSelected(loadLocal<string | null>(`selected:${snap.root}`, null))
      })
      .catch(notify)
    return window.api.onLibraryChanged(setLib)
  }, [notify])

  // App version + auto-update progress.
  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo).catch(notify)
    return window.api.onUpdateStatus((update) => setAppInfo((info) => info && { ...info, update }))
  }, [notify])

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
    (path: string, hash = '') => {
      setSelected(path)
      setScrollTarget((t) => ({ hash, n: t.n + 1 }))
      if (lib?.root) saveLocal(`selected:${lib.root}`, path)
      window.api
        .markOpened(path)
        .then((recent) => setLib((l) => l && { ...l, recent }))
        .catch(notify)
    },
    [lib?.root, notify]
  )

  // A link clicked inside an HTML document points to another document.
  useEffect(() => window.api.onNavigate((path, hash) => openDoc(path, hash)), [openDoc])

  const chooseLibrary = useCallback(async () => {
    try {
      const snap = await window.api.chooseLibrary()
      setLib(snap)
      setSelected(snap.root ? loadLocal<string | null>(`selected:${snap.root}`, null) : null)
    } catch (err) {
      notify(err)
    }
  }, [notify])

  const updateMeta = useCallback(
    (path: string, patch: Partial<Pick<DocMeta, 'tags' | 'status'>>) => {
      window.api
        .updateMeta(path, patch)
        .then((m) => setLib((l) => l && { ...l, meta: m }))
        .catch(notify)
    },
    [notify]
  )

  const index = useMemo(() => buildIndex(docs, meta), [docs, meta])

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
  const warnings = (lib?.warnings ?? []).filter((w) => !dismissed.includes(w))

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
        appInfo={appInfo}
      />
      <main className="content">
        {appInfo?.update.state === 'ready' && (
          <div className="banner update" role="status">
            <span>Đã tải xong bản {appInfo.update.version}. Bản mới sẽ được cài khi bạn tắt app, hoặc cập nhật ngay:</span>
            <button className="btn primary small" onClick={() => window.api.installUpdate().catch(notify)}>
              Khởi động lại để cập nhật
            </button>
          </div>
        )}
        {warnings.map((w) => (
          <div key={w} className="banner" role="alert">
            <span>{w}</span>
            <button aria-label="Ẩn cảnh báo" onClick={() => setDismissed((d) => [...d, w])}>
              ×
            </button>
          </div>
        ))}
        {current ? (
          <DocView
            key={current.path}
            doc={current}
            meta={metaOf(meta, current.path)}
            allDocs={docs}
            scrollTarget={scrollTarget}
            onUpdateMeta={(patch) => updateMeta(current.path, patch)}
            onOpenDoc={openDoc}
            onError={notify}
          />
        ) : (
          <Welcome hasLibrary={!!lib?.root} count={docs.length} onChoose={chooseLibrary} />
        )}
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
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
