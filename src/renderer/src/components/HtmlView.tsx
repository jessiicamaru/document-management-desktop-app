import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { DocEntry, HtmlBlockEdit } from '../../../shared/types'
import { docUrl } from '../lib/docs'

export interface HtmlViewHandle {
  /** Asks the page for the blocks you changed (see editModeInjection in src/main/html-edit.ts). */
  collectEdits(): Promise<HtmlBlockEdit[]>
}

interface Props {
  doc: DocEntry
  hash: string
  /** When set, the page is shown in text-edit mode, pinned to this file version. */
  editMtime: number | null
  onDirty: (dirty: boolean) => void
  onSaveShortcut: () => void
  onCancelShortcut: () => void
}

/**
 * HTML documents run in a sandboxed iframe without "allow-same-origin": the page can use
 * its own CSS/JS but cannot touch the app or your files. ?v= reloads it when the file
 * changes; #hash jumps to a section when you followed a link like other.html#part.
 */
const HtmlView = forwardRef<HtmlViewHandle, Props>(function HtmlView(props, ref) {
  const { doc, hash, editMtime, onDirty, onSaveShortcut, onCancelShortcut } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pending = useRef(new Map<number, (edits: HtmlBlockEdit[]) => void>())
  const callbacks = useRef({ onDirty, onSaveShortcut, onCancelShortcut })
  callbacks.current = { onDirty, onSaveShortcut, onCancelShortcut }

  // Messages from the editor script inside the page.
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frameRef.current?.contentWindow || e.data?.source !== 'studydocs') return
      const msg = e.data
      if (msg.type === 'dirty') callbacks.current.onDirty(msg.count > 0)
      if (msg.type === 'save') callbacks.current.onSaveShortcut()
      if (msg.type === 'cancel') callbacks.current.onCancelShortcut()
      if (msg.type === 'edits') {
        pending.current.get(msg.id)?.(msg.edits)
        pending.current.delete(msg.id)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useImperativeHandle(ref, () => ({
    collectEdits: () =>
      new Promise((resolve, reject) => {
        const win = frameRef.current?.contentWindow
        if (!win) return reject(new Error('Trang chưa tải xong'))
        const id = Date.now() + Math.random()
        pending.current.set(id, resolve)
        win.postMessage({ source: 'studydocs-app', type: 'collect', id }, '*')
        setTimeout(() => {
          if (pending.current.delete(id)) reject(new Error('Trang không phản hồi, chưa lưu được.'))
        }, 3000)
      })
  }))

  const fragment = hash ? `#${encodeURIComponent(hash)}` : ''
  const src = editMtime !== null ? `${docUrl(doc.path)}?edit=1&v=${editMtime}` : `${docUrl(doc.path)}?v=${doc.mtime}${fragment}`

  return (
    <iframe
      ref={frameRef}
      className={`html-frame ${editMtime !== null ? 'editing' : ''}`}
      src={src}
      sandbox="allow-scripts allow-popups"
      title={doc.title}
    />
  )
})

export default HtmlView
