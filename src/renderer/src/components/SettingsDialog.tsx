import { useEffect, useRef, useState } from 'react'
import { DEFAULT_UI, type AppInfo, type RootInfo, type UiSettings } from '../../../shared/types'
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
}

export default function SettingsDialog({ ui, onChange, onClose, roots, onAddFolders, onRemoveFolder, appInfo }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const set = <K extends keyof UiSettings>(key: K, value: UiSettings[K]): void => onChange({ ...ui, [key]: value })

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const checkUpdates = async (): Promise<void> => {
    setUpdateMsg('Đang kiểm tra…')
    try {
      await window.api.checkForUpdates()
      setUpdateMsg('Đã kiểm tra. Nếu có bản mới, app sẽ tự tải và báo ở thanh trên cùng.')
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
        <p className="hint">Có thể thêm thư mục ở nhiều ổ đĩa khác nhau (C:, D:, USB...). Tag và trạng thái học của mỗi thư mục nằm trong chính thư mục đó.</p>
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
