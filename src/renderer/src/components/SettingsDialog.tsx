import { useEffect, useRef, useState } from 'react'
import { DEFAULT_UI, type AppInfo, type LibrarySnapshot, type RecoveryItem, type RootInfo, type UiSettings } from '../../../shared/types'
import { errorMessage } from '../lib/docs'
import { t } from '../../../shared/i18n'

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
  /** Open on this tab instead of the last one. */
  startTab?: Tab
}

export type SettingsTab = 'appearance' | 'reading' | 'library' | 'data' | 'about'
type Tab = SettingsTab
/** The tab shown last, for as long as the app runs. */
let lastTab: Tab = 'appearance'
const TABS: [Tab, string][] = [
  ['appearance', 'Giao diện'],
  ['reading', 'Đọc'],
  ['library', 'Thư viện'],
  ['data', 'Dữ liệu'],
  ['about', 'Cập nhật']
]

export default function SettingsDialog({ ui, onChange, onClose, roots, onAddFolders, onRemoveFolder, appInfo, lib, startTab }: Props) {
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
  // "Khôi phục…" opens the Dữ liệu tab; otherwise the tab used last (also after the window
  // is drawn again for a new language).
  const [tab, setTabState] = useState<Tab>(() => startTab ?? lastTab)
  const setTab = (next: Tab): void => {
    lastTab = next
    setTabState(next)
  }

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const checkUpdates = async (): Promise<void> => {
    setUpdateMsg(t('Đang kiểm tra…'))
    try {
      const { result, version } = await window.api.checkForUpdates()
      setUpdateMsg(
        result === 'latest'
          ? t('Bạn đang dùng bản mới nhất ({0}).', { 0: version })
          : result === 'downloading'
            ? t('Có bản mới {0}. App đang tải ngầm; tải xong sẽ hiện nút "Khởi động lại để cập nhật".', { 0: version })
            : t('Bản {0} đã tải xong. Bấm "Khởi động lại để cập nhật" ở thanh trên cùng, hoặc tắt app để cài.', { 0: version })
      )
    } catch (err) {
      setUpdateMsg(errorMessage(err))
    }
  }

  return (
    <dialog ref={dialogRef} className="settings" onClose={onClose} onCancel={onClose}>
      <header>
        <h2>{t('Cài đặt')}</h2>
        <button className="icon-btn" aria-label={t('Đóng')} onClick={() => dialogRef.current?.close()}>
          ×
        </button>
      </header>
      <div className="settings-main">
      <nav className="settings-tabs" role="tablist" aria-label={t('Nhóm cài đặt')}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {t(label)}
            {id === 'data' && (lib?.recovery.length ?? 0) > 0 && <span className="tab-dot" aria-label={t('cần xử lý')} />}
          </button>
        ))}
      </nav>
      {/* Only this part scrolls; the title, the tabs and the buttons stay in place. */}
      <div className="settings-body" role="tabpanel">
      {message && (
        <div className={`dialog-msg ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}

      {tab === 'appearance' && (
        <>
        <section>
          <h3>{t('Giao diện')}</h3>
          {/* Written in both languages, so it can be found whatever the current one is. */}
          <Row label="Ngôn ngữ / Language">
            <Segmented
              value={ui.language}
              options={[
                ['vi', 'Tiếng Việt'],
                ['en', 'English']
              ]}
              onChange={(v) => set('language', v)}
            />
          </Row>
          <Row label={t('Chế độ màu')}>
            <Segmented
              value={ui.theme}
              options={[
                ['system', t('Theo Windows')],
                ['light', t('Sáng')],
                ['dark', t('Tối')]
              ]}
              onChange={(v) => set('theme', v)}
            />
          </Row>
          <Row label={t('Màu nhấn')}>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  className={`swatch ${ui.accent.toLowerCase() === a.value ? 'active' : ''}`}
                  style={{ background: a.value }}
                  title={t(a.name)}
                  aria-label={t(a.name)}
                  onClick={() => set('accent', a.value)}
                />
              ))}
              <label className="swatch custom" title={t('Chọn màu khác')}>
                <input type="color" value={ui.accent} onChange={(e) => set('accent', e.target.value)} />
              </label>
            </div>
          </Row>
        </section>
        </>
      )}
      {tab === 'reading' && (
        <>
        <section>
          <h3>{t('Đọc Markdown')}</h3>
          <Row label={t('Cỡ chữ: {0}px', { 0: ui.readingSize })}>
            <input
              type="range"
              min={13}
              max={24}
              value={ui.readingSize}
              onChange={(e) => set('readingSize', Number(e.target.value))}
            />
          </Row>
          <Row label={t('Kiểu chữ')}>
            <Segmented
              value={ui.readingFont}
              options={[
                ['sans', t('Không chân')],
                ['serif', t('Có chân')]
              ]}
              onChange={(v) => set('readingFont', v)}
            />
          </Row>
          <Row label={t('Độ rộng trang')}>
            <Segmented
              value={ui.readingWidth}
              options={[
                ['narrow', t('Hẹp')],
                ['normal', t('Vừa')],
                ['wide', t('Rộng')]
              ]}
              onChange={(v) => set('readingWidth', v)}
            />
          </Row>
          <p className="hint">{t('Bài HTML giữ nguyên giao diện riêng của nó; chỉ đổi theo chế độ Sáng/Tối nếu bài có hỗ trợ.')}</p>
        </section>

        <section>
          <h3>{t('Đọc sách (EPUB, Kindle)')}</h3>
          <Row label={t('Số trang trên màn hình')}>
            <Segmented
              value={ui.epubSpread}
              options={[
                ['single', t('Một trang')],
                ['auto', t('Hai trang khi cửa sổ rộng')]
              ]}
              onChange={(v) => set('epubSpread', v)}
            />
          </Row>
          <p className="hint">{t('Màu, kiểu chữ và cỡ chữ của sách theo phần "Đọc Markdown" ở trên.')}</p>
        </section>
        </>
      )}
      {tab === 'library' && (
        <>
        <section>
          <h3>{t('Thư mục trong workspace')}</h3>
          {roots.length === 0 && <p className="hint">{t('Chưa có thư mục nào.')}</p>}
          {roots.map((r) => (
            <Row
              key={r.key}
              label={
                <span>
                  <b>{r.name}</b>
                  {!r.available && <span className="root-missing">{t('không tìm thấy')}</span>}
                  <br />
                  <span className="path">{r.path}</span>
                </span>
              }
            >
              <button
                className="btn small"
                onClick={() => {
                  if (window.confirm(t('Bỏ thư mục "{0}" khỏi workspace? File trên ổ đĩa không bị xoá.', { 0: r.name }))) onRemoveFolder(r.key)
                }}
              >{t('Bỏ')}</button>
            </Row>
          ))}
          <button className="btn" onClick={onAddFolders}>{t('+ Thêm thư mục…')}</button>
          <p className="hint">{t('Có thể thêm thư mục ở nhiều ổ đĩa khác nhau (C:, D:, USB...). Tag, trạng thái và ghi chú được lưu trong dữ liệu của app (%APPDATA%\\Study Docs\\data), không ghi gì vào thư mục tài liệu.')}</p>
        </section>

        <section>
          <h3>{t('Thanh bên')}</h3>
          <Row label={t('Sắp xếp bài trong thư mục')}>
            <Segmented
              value={ui.sidebarSort}
              options={[
                ['name', t('Theo tên')],
                ['modified', t('Mới sửa trước')]
              ]}
              onChange={(v) => set('sidebarSort', v)}
            />
          </Row>
          <Row label={t('File ảnh (.png, .jpg, .svg...)')}>
            <Segmented
              value={ui.showImages ? 'show' : 'hide'}
              options={[
                ['show', t('Hiện')],
                ['hide', t('Ẩn')]
              ]}
              onChange={(v) => set('showImages', v === 'show')}
            />
          </Row>
          <p className="hint">{t('Bấm vào danh sách bài rồi dùng ↑/↓ để chọn, Enter để mở, ←/→ để thu/mở thư mục. Ẩn ảnh nếu thư mục ghi chú có nhiều ảnh minh hoạ.')}</p>
        </section>
        </>
      )}
      {tab === 'data' && (
        <>
          {lib && lib.recovery.length > 0 && <RecoverySection items={lib.recovery} onError={reportError} onInfo={reportInfo} />}
        <section>
          <h3>{t('Sao lưu dữ liệu')}</h3>
          <Row label={t('Tag, trạng thái, highlight và ghi chú của mọi thư mục và file lẻ')}>
            <div className="recovery-actions">
              <button
                className="btn small"
                onClick={async () => {
                  try {
                    const file = await window.api.exportData()
                    if (file) reportInfo(t('Đã sao lưu vào {0}', { 0: file }))
                  } catch (err) {
                    reportError(err)
                  }
                }}
              >{t('Sao lưu ra file…')}</button>
              <button
                className="btn small"
                onClick={async () => {
                  try {
                    const n = await window.api.importData()
                    if (n !== null) reportInfo(t('Đã khôi phục dữ liệu của {0} bài (gộp với dữ liệu hiện có)', { 0: n }))
                  } catch (err) {
                    reportError(err)
                  }
                }}
              >{t('Khôi phục từ file…')}</button>
            </div>
          </Row>
          <p className="hint">{t('Dùng khi chuyển sang máy khác hoặc cài lại Windows. Khôi phục không xoá gì: dữ liệu trong file được gộp vào dữ liệu đang có.')}</p>
        </section>

          {lib && <TagsSection lib={lib} onError={reportError} onInfo={reportInfo} />}
        </>
      )}
      {tab === 'about' && (
        <>
        <section>
          <h3>{t('Cập nhật')}</h3>
          <Row label={t('Phiên bản {0}', { 0: appInfo?.version ?? '' })}>
            <button className="btn" onClick={checkUpdates}>{t('Kiểm tra cập nhật')}</button>
          </Row>
          {updateMsg && <p className="hint">{updateMsg}</p>}
        </section>
        </>
      )}
      </div>
      </div>

      <footer>
        <button className="btn" onClick={() => onChange({ ...DEFAULT_UI, language: ui.language })}>{t('Khôi phục mặc định')}</button>
        <button className="btn primary small" onClick={() => dialogRef.current?.close()}>
          {t('Xong')}
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
    void run(async () => t('Đã đổi tag ở {0} bài', { 0: await window.api.renameTag(from, to) }))
  }

  return (
    <section className="tags-section">
      <h3>{t('Tag')}</h3>
      {tags.length === 0 && <p className="hint">{t('Chưa có tag nào. Thêm tag ở đầu mỗi bài.')}</p>}
      <div className="tag-list">
        {tags.map(([tag, n]) => (
          <div key={tag} className="tag-row">
            {editing === tag ? (
              <input
                autoFocus
                value={name}
                aria-label={t('Tên mới cho tag {0}', { 0: tag })}
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
            <span className="tag-count">{n}{' '}{t('bài')}</span>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => {
                setName(tag)
                setEditing(tag)
              }}
            >{t('Đổi tên')}</button>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('Bỏ tag "{0}" khỏi {1} bài? Bài không bị xoá.', { 0: tag, 1: n }))) void run(async () => t('Đã bỏ tag ở {0} bài', { 0: await window.api.deleteTag(tag) }))
              }}
            >{t('Xoá')}</button>
          </div>
        ))}
      </div>
      <Row label={<span>{t('Dữ liệu của file đã xoá')}{lib.scanning ? t(' (đang quét…)') : t(': {0} mục', { 0: lib.orphans })}</span>}>
        <button
          className="btn small"
          disabled={busy || lib.scanning || !lib.orphans}
          onClick={() => {
            if (window.confirm(t('Xoá tag, trạng thái và ghi chú của {0} mục thuộc file không còn trong thư mục? Không hoàn tác được.', { 0: lib.orphans }))) {
              void run(async () => t('Đã dọn {0} mục', { 0: await window.api.cleanOrphans() }))
            }
          }}
        >{t('Dọn dẹp')}</button>
      </Row>
      <p className="hint">{t('File đổi tên hoặc chuyển chỗ (cùng nội dung) được app tự nhận ra; chỉ dữ liệu của file đã mất hẳn mới bị dọn.')}</p>
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
      <h3>{t('Khôi phục dữ liệu')}</h3>
      <p className="hint">{t('Đây là bản sao lưu của dữ liệu bị hỏng (thường do xung đột khi đồng bộ). "Gộp lại" đưa tag, trạng thái và ghi chú trong đó trở lại mà không mất dữ liệu hiện tại. Nếu app không đọc được bản đó, mở thư mục, sửa file bằng tay rồi bấm lại.')}</p>
      {items.map((it) => (
        <div key={it.root + it.file} className="setting-row">
          <div className="setting-label">
            <b>{it.store === 'meta' ? t('Tag và trạng thái') : t('Highlight và ghi chú')}</b> · {it.rootName}
            <br />
            <span className="path">{it.file}</span>
          </div>
          <div className="recovery-actions">
            <button
              className="btn small primary"
              disabled={busy}
              onClick={() => void act(async () => onInfo(t('Đã gộp lại dữ liệu của {0} bài', { 0: await window.api.restoreBackup(it.root, it.file) })))}
            >{t('Gộp lại')}</button>
            <button className="btn small" disabled={busy} onClick={() => void act(() => window.api.revealBackup(it.root, it.file))}>{t('Mở thư mục')}</button>
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('Bỏ bản sao lưu này vào Thùng rác?'))) void act(() => window.api.discardBackup(it.root, it.file))
              }}
            >{t('Bỏ')}</button>
          </div>
        </div>
      ))}
    </section>
  )
}
