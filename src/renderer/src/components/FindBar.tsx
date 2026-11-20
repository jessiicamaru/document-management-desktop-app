// Ctrl+F bar shown over the open document (issue #17).

import { useEffect, useRef, useState } from 'react'
import type { FindResult, ReaderHandle } from './reader'
import { t } from '../../../shared/i18n'

interface Props {
  reader: React.RefObject<ReaderHandle | null>
  /** Changes each time Ctrl+F is pressed, so a second Ctrl+F selects the text again. */
  focusKey: number
  onClose: () => void
}

export default function FindBar({ reader, focusKey, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<FindResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  // Search shortly after typing stops (books are searched chapter by chapter).
  useEffect(() => {
    if (!query.trim()) {
      reader.current?.clearFind()
      setResult(null)
      return
    }
    let alive = true
    const timer = setTimeout(async () => {
      setBusy(true)
      const r = await reader.current?.find(query)
      if (alive) {
        setResult(r ?? null)
        setBusy(false)
      }
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, reader])

  // Closing the bar removes the marks.
  useEffect(() => () => reader.current?.clearFind(), [reader])

  const step = async (dir: 1 | -1): Promise<void> => {
    if (!result?.total) return
    setResult((await reader.current?.findStep(dir)) ?? result)
  }

  return (
    <div className="find-bar" role="search">
      <input
        ref={input}
        value={query}
        placeholder={t('Tìm trong bài…')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void step(e.shiftKey ? -1 : 1)
          }
          if (e.key === 'Escape') {
            // Esc closes the find bar only (while editing, it would also cancel the edit).
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <span className="find-count">
        {busy ? '…' : result ? (result.total ? `${result.index + 1}/${result.total}` : t('Không thấy')) : ''}
      </span>
      <button className="icon-btn" title={t('Kết quả trước (Shift+Enter)')} onClick={() => void step(-1)} disabled={!result?.total}>
        ↑
      </button>
      <button className="icon-btn" title={t('Kết quả sau (Enter)')} onClick={() => void step(1)} disabled={!result?.total}>
        ↓
      </button>
      <button className="icon-btn" title={t('Đóng (Esc)')} onClick={onClose}>
        ×
      </button>
    </div>
  )
}
