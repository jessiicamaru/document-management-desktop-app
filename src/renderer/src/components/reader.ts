// What DocView needs from a document view (HtmlView, MarkdownView), whatever the format.

import type { HtmlBlockEdit } from '../../../shared/types'

/** One heading (h1-h3) in the outline panel. */
export interface OutlineItem {
  level: number
  text: string
}

/** Text edits made in place, ready to save. */
export type DocChanges = { kind: 'html'; edits: HtmlBlockEdit[] } | { kind: 'md'; source: string | null }

export interface ReaderHandle {
  /** Scrolls to the n-th heading of the outline. */
  gotoHeading(index: number): void
  /** Scrolls to a saved reading position (px from the top). */
  restoreScroll(y: number): void
  /** Collects in-place text edits. Throws if they can't be saved safely. */
  collectChanges(): Promise<DocChanges>
}

/** Props every document view takes for the outline and reading position. */
export interface ReaderCallbacks {
  onOutline: (items: OutlineItem[]) => void
  /** Scroll position and the heading being read (-1 before the first heading). */
  onReading: (y: number, activeHeading: number) => void
  /** Rendering finished (diagrams included), so a saved position can be restored. */
  onReady: () => void
}
