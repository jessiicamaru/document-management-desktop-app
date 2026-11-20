// A small form for names: new note (name + .md/.html), new folder, rename.
// Errors from saving (name taken, characters Windows doesn't allow...) show inside the dialog.

import { useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { errorMessage } from '../lib/docs'

export interface NameField {
  label: string
  value: string
  placeholder?: string
}

export interface NameDialogOptions {
  title: string
  fields: NameField[]
  /** Show the .md / .html choice, starting with this one. */
  kind?: 'md' | 'html'
  okLabel: string
  hint?: string
  /** Throws to keep the dialog open with the message. */
  onSubmit: (values: string[], kind: 'md' | 'html') => Promise<void>
}

export default function NameDialog({ options, onClose }: { options: NameDialogOptions; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState(() => options.fields.map((f) => f.value))
  const [kind, setKind] = useState<'md' | 'html'>(options.kind ?? 'md')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ref.current?.showModal()
    const first = ref.current?.querySelector<HTMLInputElement>('input')
    first?.focus()
    // Renaming "Bài 1.md": select "Bài 1", like Explorer.
    if (first) first.setSelectionRange(0, first.value.replace(/\.[^.]+$/, '').length || first.value.length)
  }, [])

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await options.onSubmit(values, kind)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="settings name-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.nativeEvent.stopPropagation()}
    >
      <header>
        <h2>{options.title}</h2>
        <button className="icon-btn" aria-label={t('Đóng')} onClick={onClose}>
          ×
        </button>
      </header>
      <form
        className="name-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {options.fields.map((f, i) => (
          <label key={f.label}>
            <span>{f.label}</span>
            <input
              value={values[i]}
              placeholder={f.placeholder}
              onChange={(e) => {
                const next = [...values]
                next[i] = e.target.value
                setValues(next)
              }}
            />
          </label>
        ))}
        {options.kind && (
          <div className="name-kind">
            <span>{t('Loại')}</span>
            <div className="segmented plain" role="radiogroup" aria-label={t('Loại')}>
              <button type="button" role="radio" aria-checked={kind === 'md'} className={kind === 'md' ? 'active' : ''} onClick={() => setKind('md')}>
                Markdown (.md)
              </button>
              <button type="button" role="radio" aria-checked={kind === 'html'} className={kind === 'html' ? 'active' : ''} onClick={() => setKind('html')}>
                HTML (.html)
              </button>
            </div>
          </div>
        )}
        {options.hint && <p className="hint">{options.hint}</p>}
        {error && (
          <p className="name-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
      <footer>
        <span />
        <div className="footer-buttons">
          <button className="btn small" onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button className="btn primary small" disabled={busy} onClick={() => void submit()}>
            {options.okLabel}
          </button>
        </div>
      </footer>
    </dialog>
  )
}
