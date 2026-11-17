import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_UI, type AppInfo, type DocEntry, type DocMeta, type LibrarySnapshot, type StudyStatus, type UiSettings } from '../../shared/types'
import { buildIndex, errorMessage, loadLocal, metaOf, saveLocal } from './lib/docs'
import { applyUiSettings, timeAgo } from './lib/ui'
import Sidebar, { type SearchHit } from './components/Sidebar'
import DocView from './components/DocView'
import SettingsDialog from './components/SettingsDialog'

export type StatusFilter = StudyStatus | 'all'

/** Where to scroll inside the open document. `n` changes on every jump so the same #hash can be reused. */
export interface ScrollTarget {
  hash: string
  n: number
}

interface Toast {
  id: number
  text: string
  kind: 'error' | 'info'
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
  const [ui, setUi] = useState<UiSettings>(DEFAULT_UI)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  // True while the open document has unsaved edits (text edit or raw editor).
  const dirtyRef = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)

  /** Shows a message in the bottom-right corner for a few seconds. */
  const showToast = useCallback((text: string, kind: Toast['kind']) => {
    const toast = { id: Date.now() + Math.random(), text, kind }
    setToasts((t) => [...t, toast])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 6000)
  }, [])
  const notify = useCallback((err: unknown) => showToast(errorMessage(err), 'error'), [showToast])
  const inform = useCallback((text: string) => showToast(text, 'info'), [showToast])

  // Back/forward history of opened documents, like a browser.
  const history = useRef<{ entries: { path: string; hash: string }[]; index: number }>({ entries: [], index: -1 })
  const [historyPos, setHistoryPos] = useState({ canBack: false, canForward: false })
  const syncHistory = (): void => {
    const h = history.current
    setHistoryPos({ canBack: h.index > 0, canForward: h.index < h.entries.length - 1 })
  }

  // Load the library once, then follow changes on disk.
  useEffect(() => {
    window.api
      .getLibrary()
      .then((snap) => {
        setLib(snap)
        setSelected(loadLocal<string | null>('selected:workspace', null))
      })
      .catch(notify)
    return window.api.onLibraryChanged(setLib)
  }, [notify])

  // App version + auto-update progress.
  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo).catch(notify)
    return window.api.onUpdateStatus((update) => setAppInfo((info) => info && { ...info, update }))
  }, [notify])

  // Appearance: load once, apply on every change, save shortly after the last change
  // (so dragging the font-size slider doesn't write the file on every pixel).
  useEffect(() => {
    window.api.getUiSettings().then(setUi).catch(notify)
  }, [notify])
  useEffect(() => applyUiSettings(ui), [ui])
  const saveUiTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const changeUi = useCallback(
    (next: UiSettings) => {
      setUi(next)
      clearTimeout(saveUiTimer.current)
      saveUiTimer.current = setTimeout(() => window.api.setUiSettings(next).catch(notify), 250)
    },
    [notify]
  )

  // Closing the window with unsaved edits: the main process asks what to do.
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
    window.onbeforeunload = dirty
      ? (e) => {
          e.preventDefault()
          e.returnValue = false
        }
      : null
  }, [])

  const docs = lib?.docs ?? []
  const meta = lib?.meta ?? {}

  /** Opens a document; returns false if you chose to stay because of unsaved edits. */
  const openDoc = useCallback(
    (path: string, hash = '', fromHistory = false): boolean => {
      if (dirtyRef.current && path !== selected) {
        if (!window.confirm('Bài đang mở có thay đổi chưa lưu. Chuyển bài và bỏ các thay đổi đó?')) return false
        setDirty(false)
      }
      if (!fromHistory) {
        const h = history.current
        const cur = h.entries[h.index]
        if (!cur || cur.path !== path || cur.hash !== hash) {
          h.entries = [...h.entries.slice(0, h.index + 1), { path, hash }].slice(-100)
          h.index = h.entries.length - 1
          syncHistory()
        }
      }
      setSelected(path)
      setScrollTarget((t) => ({ hash, n: t.n + 1 }))
      saveLocal('selected:workspace', path)
      window.api
        .markOpened(path)
        .then((recent) => setLib((l) => l && { ...l, recent }))
        .catch(notify)
      return true
    },
    [notify, selected, setDirty]
  )

  const goHistory = useCallback(
    (direction: 'back' | 'forward') => {
      const h = history.current
      const target = h.index + (direction === 'back' ? -1 : 1)
      const entry = h.entries[target]
      if (!entry) return
      if (openDoc(entry.path, entry.hash, true)) {
        h.index = target
        syncHistory()
      }
    },
    [openDoc]
  )

  // A link clicked inside an HTML document points to another document.
  useEffect(() => window.api.onNavigate((path, hash) => openDoc(path, hash)), [openDoc])
  // Mouse back/forward buttons.
  useEffect(() => window.api.onHistory(goHistory), [goHistory])

  /**
   * App shortcuts. Also called with keys forwarded from inside an HTML document,
   * which has the keyboard focus while you read it.
   * Ctrl+K / Ctrl+P search (like VS Code), Ctrl+E recent, Ctrl+, settings, Alt+←/→ history.
   */
  const runShortcut = useCallback(
    (key: string) => {
      if (key === 'ctrl+k' || key === 'ctrl+p') {
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (key === 'ctrl+e') setRecentOpen((o) => !o)
      else if (key === 'ctrl+,') setSettingsOpen(true)
      else if (key === 'back' || key === 'forward') goHistory(key)
    },
    [goHistory]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      let key: string | null = null
      if ((e.ctrlKey || e.metaKey) && ['k', 'p', 'e', ','].includes(e.key.toLowerCase())) key = `ctrl+${e.key.toLowerCase()}`
      if (e.altKey && e.key === 'ArrowLeft') key = 'back'
      if (e.altKey && e.key === 'ArrowRight') key = 'forward'
      if (!key) return
      e.preventDefault()
      runShortcut(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runShortcut])

  const addFolders = useCallback(async () => {
    try {
      const { snapshot, refused } = await window.api.addFolders()
      setLib(snapshot)
      refused.forEach((msg) => notify(msg))
    } catch (err) {
      notify(err)
    }
  }, [notify])

  const removeFolder = useCallback(
    async (key: string) => {
      if (dirtyRef.current && selected?.startsWith(`${key}/`)) {
        if (!window.confirm('Bài đang mở trong thư mục này có thay đổi chưa lưu. Vẫn bỏ thư mục?')) return
        setDirty(false)
      }
      try {
        setLib(await window.api.removeFolder(key))
      } catch (err) {
        notify(err)
      }
    },
    [notify, selected, setDirty]
  )

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
        appInfo={appInfo}
        recentOpen={recentOpen}
        onRecentOpen={setRecentOpen}
        onAddFolders={addFolders}
        onRemoveFolder={removeFolder}
        onOpenSettings={() => setSettingsOpen(true)}
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
            onInfo={inform}
            onDirtyChange={setDirty}
            onShortcut={runShortcut}
            history={historyPos}
            onHistory={goHistory}
            rootName={(lib?.roots.length ?? 0) > 1 ? (lib?.roots.find((r) => r.key === current.root)?.name ?? null) : null}
          />
        ) : (
          <Welcome hasLibrary={(lib?.roots.length ?? 0) > 0} docs={docs} recent={lib?.recent ?? {}} onChoose={addFolders} onOpen={openDoc} />
        )}
      </main>
      {settingsOpen && (
        <SettingsDialog
          ui={ui}
          onChange={changeUi}
          onClose={() => setSettingsOpen(false)}
          roots={lib?.roots ?? []}
          onAddFolders={addFolders}
          onRemoveFolder={removeFolder}
          appInfo={appInfo}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}

interface WelcomeProps {
  hasLibrary: boolean
  docs: DocEntry[]
  recent: Record<string, number>
  onChoose: () => void
  onOpen: (path: string) => void
}

function Welcome({ hasLibrary, docs, recent, onChoose, onOpen }: WelcomeProps) {
  const recentDocs = docs
    .filter((d) => recent[d.path])
    .sort((a, b) => recent[b.path] - recent[a.path])
    .slice(0, 8)
  if (!hasLibrary) {
    return (
      <div className="welcome">
        <h1>Study Docs</h1>
        <p>Thêm một hoặc nhiều thư mục chứa tài liệu học của bạn (.md, .html), ở bất kỳ ổ đĩa nào. App không sửa file nếu bạn không bấm Sửa chữ hoặc Raw.</p>
        <button className="btn primary" onClick={onChoose}>
          Thêm thư mục tài liệu
        </button>
      </div>
    )
  }
  return (
    <div className="welcome">
      <h1>{docs.length} tài liệu</h1>
      <p>
        Chọn một bài ở thanh bên trái, hoặc nhấn <kbd>Ctrl</kbd> + <kbd>K</kbd> để tìm kiếm. Tìm không cần gõ dấu:
        "su kien" vẫn ra "sự kiện".
      </p>
      {recentDocs.length > 0 && (
        <div className="welcome-recent">
          <div className="group-title">Mở gần đây</div>
          {recentDocs.map((d) => (
            <button key={d.path} className="row doc" onClick={() => onOpen(d.path)} title={d.rel}>
              <span className={`kind kind-${d.kind}`}>{d.kind.toUpperCase()}</span>
              <span className="row-title">{d.title}</span>
              <span className="row-time">{timeAgo(recent[d.path])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
