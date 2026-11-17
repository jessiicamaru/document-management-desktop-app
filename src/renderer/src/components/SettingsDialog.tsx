import { useEffect, useRef, useState } from 'react'
import { DEFAULT_UI, type AppInfo, type LibrarySnapshot, type RecoveryItem, type RootInfo, type UiSettings } from '../../../shared/types'
import { errorMessage } from '../lib/docs'

const ACCENTS = [
  { name: 'Cam đất', value: '#b4531f' },
  { name: 'Xanh dương', value: '#2f5d8a' },
  { name: 'Xanh lá', value: '#3b6b45' },
  { name: 'Tím', value: '#5b4a86' },
  { name: 'Hồng', value: '#b03a6f' },
  { name: 'Xanh ngọc', value: '#0f766e' },
  { name: 'Xám', value: '#4b5563' }
]

interface Props {
  ui: UiSettings
  onChange: (ui: UiSettings) => void
  onClose: () => void
  roots: RootInfo[]
  onAddFolders: () => void
  onRemoveFolder: (key: string) => void
  appInfo: AppInfo | null
  lib: LibrarySnapshot | null
}

export default function SettingsDialog({ ui, onChange, onClose, roots, onAddFolders, onRemoveFolder, appInfo, lib }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  // The app's toasts are hidden behind this modal dialog, so its own messages show here.
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const reportError = (err: unknown): void => {
    setMessage({ text: errorMessage(err), error: true })
  }
  const reportInfo = (text: string): void => {
    setMessage({ text, error: false })
  }
  const set = <K extends keyof UiSettings>(key: K, value: UiSettings[K]): void => onChange({ ...ui, [key]: value })

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const checkUpdates = async (): Promise<void> => {
    setUpdateMsg('Đang kiểm tra…')
    try {
      const { result, version } = await window.api.checkForUpdates()
      setUpdateMsg(
        result === 'latest'
          ? `Bạn đang dùng bản mới nhất (${version}).`
          : result === 'downloading'
            ? `Có bản mới ${version}. App đang tải ngầm; tải xong sẽ hiện nút "Khởi động lại để cập nhật".`
            : `Bản ${version} đã tải xong. Bấm "Khởi động lại để cập nhật" ở thanh trên cùng, hoặc tắt app để cài.`
      )
    } catch (err) {
      setUpdateMsg(errorMessage(err))
    }
  }

  return (
    <dialog ref={dialogRef} className="settings" onClose={onClose} onCancel={onClose}>
      <header>
        <h2>Cài đặt</h2>
        <button className="icon-btn" aria-label="Đóng" onClick={() => dialogRef.current?.close()}>
          ×
        </button>
      </header>
      {message && (
        <div className={`dialog-msg ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}

      {lib && lib.recovery.length > 0 && <RecoverySection items={lib.recovery} onError={reportError} onInfo={reportInfo} />}

      <section>
        <h3>Giao diện</h3>
        <Row label="Chế độ màu">
          <Segmented
            value={ui.theme}
            options={[
              ['system', 'Theo Windows'],
              ['light', 'Sáng'],
              ['dark', 'Tối']
            ]}
            onChange={(v) => set('theme', v)}
          />
        </Row>
        <Row label="Màu nhấn">
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                className={`swatch ${ui.accent.toLowerCase() === a.value ? 'active' : ''}`}
                style={{ background: a.value }}
                title={a.name}
                aria-label={a.name}
                onClick={() => set('accent', a.value)}
              />
            ))}
            <label className="swatch custom" title="Chọn màu khác">
              <input type="color" value={ui.accent} onChange={(e) => set('accent', e.target.value)} />
            </label>
          </div>
        </Row>
      </section>

      <section>
        <h3>Đọc Markdown</h3>
        <Row label={`Cỡ chữ: ${ui.readingSize}px`}>
          <input
            type="range"
            min={13}
            max={24}
            value={ui.readingSize}
            onChange={(e) => set('readingSize', Number(e.target.value))}
          />
        </Row>
        <Row label="Kiểu chữ">
          <Segmented
            value={ui.readingFont}
            options={[
              ['sans', 'Không chân'],
              ['serif', 'Có chân']
            ]}
            onChange={(v) => set('readingFont', v)}
          />
        </Row>
        <Row label="Độ rộng trang">
          <Segmented
            value={ui.readingWidth}
            options={[
              ['narrow', 'Hẹp'],
              ['normal', 'Vừa'],
              ['wide', 'Rộng']
            ]}
            onChange={(v) => set('readingWidth', v)}
          />
        </Row>
        <p className="hint">Bài HTML giữ nguyên giao diện riêng của nó; chỉ đổi theo chế độ Sáng/Tối nếu bài có hỗ trợ.</p>
      </section>

      <section>
        <h3>Đọc sách (EPUB, Kindle)</h3>
        <Row label="Số trang trên màn hình">
          <Segmented
            value={ui.epubSpread}
            options={[
              ['single', 'Một trang'],
              ['auto', 'Hai trang khi cửa sổ rộng']
            ]}
            onChange={(v) => set('epubSpread', v)}
          />
        </Row>
        <p className="hint">Màu, kiểu chữ và cỡ chữ của sách theo phần "Đọc Markdown" ở trên.</p>
      </section>

      <section>
        <h3>Thanh bên</h3>
        <Row label="Sắp xếp bài trong thư mục">
          <Segmented
            value={ui.sidebarSort}
            options={[
              ['name', 'Theo tên'],
              ['modified', 'Mới sửa trước']
            ]}
            onChange={(v) => set('sidebarSort', v)}
          />
        </Row>
        <p className="hint">Bấm vào danh sách bài rồi dùng ↑/↓ để chọn, Enter để mở, ←/→ để thu/mở thư mục.</p>
      </section>

      {lib && <TagsSection lib={lib} onError={reportError} onInfo={reportInfo} />}

      <section>
        <h3>Thư mục trong workspace</h3>
        {roots.length === 0 && <p className="hint">Chưa có thư mục nào.</p>}
        {roots.map((r) => (
          <Row
            key={r.key}
            label={
              <span>
                <b>{r.name}</b>
                {!r.available && <span className="root-missing">không tìm thấy</span>}
                <br />
                <span className="path">{r.path}</span>
              </span>
            }
          >
            <button
              className="btn small"
              onClick={() => {
                if (window.confirm(`Bỏ thư mục "${r.name}" khỏi workspace? File trên ổ đĩa không bị xoá.`)) onRemoveFolder(r.key)
              }}
            >
              Bỏ
            </button>
          </Row>
        ))}
        <button className="btn" onClick={onAddFolders}>
          + Thêm thư mục…
        </button>
        <p className="hint">Có thể thêm thư mục ở nhiều ổ đĩa khác nhau (C:, D:, USB...). Tag, trạng thái và ghi chú được lưu trong dữ liệu của app (%APPDATA%\Study Docs\data), không ghi gì vào thư mục tài liệu.</p>
      </section>

      <section>
        <h3>Sao lưu dữ liệu</h3>
        <Row label="Tag, trạng thái, highlight và ghi chú của mọi thư mục và file lẻ">
          <div className="recovery-actions">
            <button
              className="btn small"
              onClick={async () => {
                try {
                  const file = await window.api.exportData()
                  if (file) reportInfo(`Đã sao lưu vào ${file}`)
                } catch (err) {
                  reportError(err)
                }
              }}
            >
              Sao lưu ra file…
            </button>
            <button
              className="btn small"
              onClick={async () => {
                try {
                  const n = await window.api.importData()
                  if (n !== null) reportInfo(`Đã khôi phục dữ liệu của ${n} bài (gộp với dữ liệu hiện có)`)
                } catch (err) {
                  reportError(err)
                }
              }}
            >
              Khôi phục từ file…
            </button>
          </div>
        </Row>
        <p className="hint">Dùng khi chuyển sang máy khác hoặc cài lại Windows. Khôi phục không xoá gì: dữ liệu trong file được gộp vào dữ liệu đang có.</p>
      </section>

      <section>
        <h3>Cập nhật</h3>
        <Row label={`Phiên bản ${appInfo?.version ?? ''}`}>
          <button className="btn" onClick={checkUpdates}>
            Kiểm tra cập nhật
          </button>
        </Row>
        {updateMsg && <p className="hint">{updateMsg}</p>}
      </section>

      <footer>
        <button className="btn" onClick={() => onChange(DEFAULT_UI)}>
          Khôi phục mặc định
        </button>
        <button className="btn primary small" onClick={() => dialogRef.current?.close()}>
          Xong
        </button>
      </footer>
    </dialog>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">{label}</div>
      <div>{children}</div>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented plain">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** Rename or delete a tag on every document, and clean up data of deleted files (issue #22). */
function TagsSection({ lib, onError, onInfo }: { lib: LibrarySnapshot; onError: (err: unknown) => void; onInfo: (text: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const existing = new Set(lib.docs.map((d) => d.path))
  const counts = new Map<string, number>()
  for (const [id, m] of Object.entries(lib.meta)) {
    if (!existing.has(id)) continue
    for (const t of m.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const tags = [...counts].sort((a, b) => a[0].localeCompare(b[0], 'vi'))

  const run = async (job: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try {
      onInfo(await job())
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }
  const rename = (from: string): void => {
    const to = name.trim()
    setEditing(null)
    if (!to || to === from) return
    void run(async () => `Đã đổi tag ở ${await window.api.renameTag(from, to)} bài`)
  }

  return (
    <section className="tags-section">
      <h3>Tag</h3>
      {tags.length === 0 && <p className="hint">Chưa có tag nào. Thêm tag ở đầu mỗi bài.</p>}
      <div className="tag-list">
        {tags.map(([tag, n]) => (
          <div key={tag} className="tag-row">
            {editing === tag ? (
              <input
                autoFocus
                value={name}
                aria-label={`Tên mới cho tag ${tag}`}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => rename(tag)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename(tag)
                  if (e.key === 'Escape') {
                    // Cancel the rename, not the whole dialog.
                    e.preventDefault()
                    e.stopPropagation()
                    setEditing(null)
                  }
                }}
              />
            ) : (
              <span className="tag-name">#{tag}</span>
            )}
            <span className="tag-count">{n} bài</span>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => {
                setName(tag)
                setEditing(tag)
              }}
            >
              Đổi tên
            </button>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Bỏ tag "${tag}" khỏi ${n} bài? Bài không bị xoá.`)) void run(async () => `Đã bỏ tag ở ${await window.api.deleteTag(tag)} bài`)
              }}
            >
              Xoá
            </button>
          </div>
        ))}
      </div>
      <Row label={<span>Dữ liệu của file đã xoá{lib.scanning ? ' (đang quét…)' : `: ${lib.orphans} mục`}</span>}>
        <button
          className="btn small"
          disabled={busy || lib.scanning || !lib.orphans}
          onClick={() => {
            if (window.confirm(`Xoá tag, trạng thái và ghi chú của ${lib.orphans} mục thuộc file không còn trong thư mục? Không hoàn tác được.`)) {
              void run(async () => `Đã dọn ${await window.api.cleanOrphans()} mục`)
            }
          }}
        >
          Dọn dẹp
        </button>
      </Row>
      <p className="hint">File đổi tên hoặc chuyển chỗ (cùng nội dung) được app tự nhận ra; chỉ dữ liệu của file đã mất hẳn mới bị dọn.</p>
    </section>
  )
}

/** Backups of broken meta.json / notes.json data files that can be merged back (issue #25). */
function RecoverySection({ items, onError, onInfo }: { items: RecoveryItem[]; onError: (err: unknown) => void; onInfo: (text: string) => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await job()
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="recovery">
      <h3>Khôi phục dữ liệu</h3>
      <p className="hint">
        Đây là bản sao lưu của dữ liệu bị hỏng (thường do xung đột khi đồng bộ). "Gộp lại" đưa tag, trạng thái và ghi chú trong đó trở lại mà không mất dữ liệu hiện
        tại. Nếu app không đọc được bản đó, mở thư mục, sửa file bằng tay rồi bấm lại.
      </p>
      {items.map((it) => (
        <div key={it.root + it.file} className="setting-row">
          <div className="setting-label">
            <b>{it.store === 'meta' ? 'Tag và trạng thái' : 'Highlight và ghi chú'}</b> · {it.rootName}
            <br />
            <span className="path">{it.file}</span>
          </div>
          <div className="recovery-actions">
            <button
              className="btn small primary"
              disabled={busy}
              onClick={() => void act(async () => onInfo(`Đã gộp lại dữ liệu của ${await window.api.restoreBackup(it.root, it.file)} bài`))}
            >
              Gộp lại
            </button>
            <button className="btn small" disabled={busy} onClick={() => void act(() => window.api.revealBackup(it.root, it.file))}>
              Mở thư mục
            </button>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Bỏ bản sao lưu này vào Thùng rác?')) void act(() => window.api.discardBackup(it.root, it.file))
              }}
            >
              Bỏ
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
