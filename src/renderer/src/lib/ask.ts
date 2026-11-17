// In-app question dialogs, instead of the browser's confirm() (a plain Windows box with
// "OK / Cancel" in English). Shown by <AskHost/> in App.tsx; also used for questions the
// main process asks (see 'dialog:ask' in src/main/index.ts).
//
//   if (await confirmDialog({ message: t('Xoá highlight này?'), ok: t('Xoá'), danger: true })) ...

export interface AskOptions {
  message: string
  detail?: string
  /** Buttons from left to right; the answer is the index of the one clicked. */
  buttons: string[]
  /** Index answered by Esc or the × (default: the last button). */
  cancelId?: number
  /** Button that has the focus (Enter). Default: cancelId, so Enter never does the risky thing. */
  defaultId?: number
  /** Index of a button drawn in red (deleting, discarding changes). */
  dangerId?: number
}

export interface PendingAsk extends AskOptions {
  id: number
  resolve: (index: number) => void
}

let queue: PendingAsk[] = []
let nextId = 1
const listeners = new Set<(queue: PendingAsk[]) => void>()
const emit = (): void => listeners.forEach((l) => l(queue))

/** Asks a question; resolves with the index of the button clicked. */
export function ask(options: AskOptions): Promise<number> {
  return new Promise((resolve) => {
    const item: PendingAsk = {
      ...options,
      id: nextId++,
      resolve: (index) => {
        queue = queue.filter((q) => q !== item)
        emit()
        resolve(index)
      }
    }
    queue = [...queue, item]
    emit()
  })
}

/** Yes/no question: resolves true for the first ("ok") button. */
export async function confirmDialog(o: { message: string; detail?: string; ok: string; cancel: string; danger?: boolean }): Promise<boolean> {
  return (await ask({ message: o.message, detail: o.detail, buttons: [o.ok, o.cancel], cancelId: 1, dangerId: o.danger ? 0 : undefined })) === 0
}

export function subscribeAsks(listener: (queue: PendingAsk[]) => void): () => void {
  listeners.add(listener)
  listener(queue)
  return () => listeners.delete(listener)
}
