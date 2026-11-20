// A note just created in the app opens ready for writing: App asks, DocView takes the request
// when it shows that note.

let pending: string | null = null

export function requestWriting(docId: string): void {
  pending = docId
}

/** True once for the note that was asked for. */
export function takeWritingRequest(docId: string): boolean {
  if (pending !== docId) return false
  pending = null
  return true
}
