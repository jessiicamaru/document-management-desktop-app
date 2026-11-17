// Draws the question asked with ask() / confirmDialog() (see lib/ask.ts), one at a time,
// as a modal <dialog> on top of everything (also on top of Settings).

import { useEffect, useRef, useState } from 'react'
import { subscribeAsks, type PendingAsk } from '../lib/ask'

export default function AskHost() {
  const [queue, setQueue] = useState<PendingAsk[]>([])
  useEffect(() => subscribeAsks(setQueue), [])
  const current = queue[0]
  return current ? <AskDialog key={current.id} item={current} /> : null
}

function AskDialog({ item }: { item: PendingAsk }) {
  const ref = useRef<HTMLDialogElement>(null)
  const cancelId = item.cancelId ?? item.buttons.length - 1
  const defaultId = item.defaultId ?? cancelId
  const answered = useRef(false)
  const answer = (index: number): void => {
    if (answered.current) return
    answered.current = true
    ref.current?.close()
    item.resolve(index)
  }

  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>(`[data-index="${defaultId}"]`)?.focus()
  }, [defaultId])

  return (
    <dialog
      ref={ref}
      className="ask"
      aria-labelledby={`ask-${item.id}`}
      onCancel={(e) => {
        e.preventDefault() // Esc
        answer(cancelId)
      }}
      onClick={(e) => {
        if (e.target === ref.current) answer(cancelId) // click on the backdrop
      }}
      // Keys belong to the question: Esc must not also cancel an edit behind it, etc.
      onKeyDown={(e) => e.nativeEvent.stopPropagation()}
    >
      <div className="ask-body">
        <p id={`ask-${item.id}`} className="ask-message">
          {item.message}
        </p>
        {item.detail && <p className="ask-detail">{item.detail}</p>}
      </div>
      <div className="ask-buttons">
        {item.buttons.map((label, i) => (
          <button
            key={i}
            data-index={i}
            data-answer={i === cancelId ? 'cancel' : 'ok'}
            className={`btn small ${i === item.dangerId ? 'danger-fill' : i !== cancelId && i === 0 ? 'primary' : ''}`}
            onClick={() => answer(i)}
          >
            {label}
          </button>
        ))}
      </div>
    </dialog>
  )
}
