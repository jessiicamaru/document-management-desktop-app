import { useMemo, useState, type RefObject } from 'react'
import type { DocEntry, LibrarySnapshot } from '../../../shared/types'
import { buildTree, loadLocal, makeSnippet, metaOf, saveLocal, STATUSES, type TreeFolder } from '../lib/docs'
import type { StatusFilter } from '../App'

export interface SearchHit {
  doc: DocEntry
  terms: string[]
}

interface Props {
  lib: LibrarySnapshot | null
  docs: DocEntry[]
  hits: SearchHit[] | null
  query: string
  onQuery: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  statusFilter: StatusFilter
  onStatusFilter: (s: StatusFilter) => void
  tagFilter: string | null
  onTagFilter: (t: string | null) => void
  selected: string | null
  onOpen: (path: string) => void
  onChooseLibrary: () => void
}

export default function Sidebar(props: Props) {
  const { lib, docs, hits, query, onQuery, selected, onOpen } = props
  const allDocs = lib?.docs ?? []
  const meta = lib?.meta ?? {}
  const libraryName = lib?.root ? lib.root.split(/[\\/]/).filter(Boolean).pop() : null

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allDocs.length }
    for (const d of allDocs) {
      const s = metaOf(meta, d.path).status
      counts[s] = (counts[s] ?? 0) + 1
    }
    return counts
  }, [allDocs, meta])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of allDocs) for (const t of metaOf(meta, d.path).tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'vi'))
  }, [allDocs, meta])

  const recent = useMemo(
    () =>
      allDocs
        .filter((d) => meta[d.path]?.lastOpened)
        .sort((a, b) => (meta[b.path]!.lastOpened ?? 0) - (meta[a.path]!.lastOpened ?? 0))
        .slice(0, 5),
    [allDocs, meta]
  )

  const filtering = props.statusFilter !== 'all' || props.tagFilter !== null

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="library-name" title={lib?.root ?? ''}>
          {libraryName ?? 'Chưa chọn thư mục'}
        </div>
        <button className="icon-btn" title="Đổi thư mục tài liệu" onClick={props.onChooseLibrary}>
          <FolderIcon />
        </button>
      </div>

      <div className="search">
        <input
          ref={props.searchRef}
          value={query}
          placeholder="Tìm tài liệu…  (Ctrl+K)"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onQuery('')
            if (e.key === 'Enter' && hits?.[0]) onOpen(hits[0].doc.path)
          }}
        />
      </div>

      <div className="filters">
        <Chip active={props.statusFilter === 'all'} onClick={() => props.onStatusFilter('all')}>
          Tất cả <span className="count">{statusCounts.all ?? 0}</span>
        </Chip>
        {STATUSES.map((s) => (
          <Chip
            key={s.id}
            className={`status-${s.id}`}
            active={props.statusFilter === s.id}
            onClick={() => props.onStatusFilter(props.statusFilter === s.id ? 'all' : s.id)}
          >
            {s.label} <span className="count">{statusCounts[s.id] ?? 0}</span>
          </Chip>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="filters tags">
          {tags.map(([t, n]) => (
            <Chip key={t} active={props.tagFilter === t} onClick={() => props.onTagFilter(props.tagFilter === t ? null : t)}>
              #{t} <span className="count">{n}</span>
            </Chip>
          ))}
        </div>
      )}

      <div className="doc-list">
        {hits ? (
          <SearchResults hits={hits} query={query} selected={selected} onOpen={onOpen} />
        ) : (
          <>
            {!filtering && recent.length > 0 && (
              <div className="group">
                <div className="group-title">Mở gần đây</div>
                {recent.map((d) => (
                  <DocRow key={d.path} doc={d} depth={0} selected={selected === d.path} onOpen={onOpen} />
                ))}
              </div>
            )}
            <div className="group">
              {!filtering && recent.length > 0 && <div className="group-title">Tất cả tài liệu</div>}
              <Tree root={buildTree(docs)} libraryKey={lib?.root ?? ''} selected={selected} onOpen={onOpen} />
              {docs.length === 0 && lib?.root && <div className="empty">Không có tài liệu nào khớp.</div>}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

function Chip(props: { active: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button className={`chip ${props.className ?? ''} ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

function Tree({ root, libraryKey, selected, onOpen }: { root: TreeFolder; libraryKey: string; selected: string | null; onOpen: (p: string) => void }) {
  // Remember which folders you collapsed, per library.
  const storageKey = `collapsed:${libraryKey}`
  const [collapsed, setCollapsed] = useState<string[]>(() => loadLocal(storageKey, []))
  const toggle = (path: string): void => {
    const next = collapsed.includes(path) ? collapsed.filter((p) => p !== path) : [...collapsed, path]
    setCollapsed(next)
    saveLocal(storageKey, next)
  }

  const renderFolder = (folder: TreeFolder, depth: number): React.ReactNode => (
    <>
      {folder.folders.map((f) => {
        const open = !collapsed.includes(f.path)
        return (
          <div key={f.path}>
            <button className="row folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggle(f.path)}>
              <span className={`chevron ${open ? 'open' : ''}`}>▸</span>
              <span className="row-title">{f.name}</span>
            </button>
            {open && renderFolder(f, depth + 1)}
          </div>
        )
      })}
      {folder.docs.map((d) => (
        <DocRow key={d.path} doc={d} depth={depth} selected={selected === d.path} onOpen={onOpen} />
      ))}
    </>
  )
  return <>{renderFolder(root, 0)}</>
}

function DocRow({ doc, depth, selected, onOpen }: { doc: DocEntry; depth: number; selected: boolean; onOpen: (p: string) => void }) {
  return (
    <button
      className={`row doc ${selected ? 'selected' : ''}`}
      style={{ paddingLeft: 10 + depth * 14 + 14 }}
      onClick={() => onOpen(doc.path)}
      title={doc.path}
    >
      <span className={`kind kind-${doc.kind}`}>{doc.kind === 'md' ? 'MD' : 'HTML'}</span>
      <span className="row-title">{doc.title}</span>
    </button>
  )
}

function SearchResults({ hits, query, selected, onOpen }: { hits: SearchHit[]; query: string; selected: string | null; onOpen: (p: string) => void }) {
  if (hits.length === 0) return <div className="empty">Không tìm thấy kết quả.</div>
  return (
    <div className="group">
      <div className="group-title">{hits.length} kết quả</div>
      {hits.map(({ doc, terms }) => {
        const snip = makeSnippet(doc.text, query, terms)
        const folder = doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) : ''
        return (
          <button key={doc.path} className={`hit ${selected === doc.path ? 'selected' : ''}`} onClick={() => onOpen(doc.path)}>
            <div className="hit-title">
              <span className={`kind kind-${doc.kind}`}>{doc.kind === 'md' ? 'MD' : 'HTML'}</span>
              {doc.title}
            </div>
            {folder && <div className="hit-path">{folder}</div>}
            <div className="hit-snippet">
              {snip.before}
              <mark>{snip.match}</mark>
              {snip.after}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </svg>
  )
}
