// What DocView needs from a document view (HtmlView, MarkdownView, EpubView), whatever the format.

import type { SelectionInfo } from '../../../shared/anchor'
import type { Annotation, HtmlBlockEdit } from '../../../shared/types'

/** One entry in the outline panel (a heading, or a chapter of a book). */
export interface OutlineItem {
  level: number
  text: string
}

/** Text edits made in place, ready to save. */
export type DocChanges = { kind: 'html'; edits: HtmlBlockEdit[] } | { kind: 'md'; source: string | null } | { kind: 'none' }

/** A rectangle in the app window's coordinates. */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Text you selected, ready to become a highlight. `rect` is in app window coordinates. */
export type TextSelection = Omit<SelectionInfo, 'start' | 'end'> & { rect: ScreenRect; cfi?: string }

export interface ReaderHandle {
  /** Scrolls to the n-th outline entry. */
  gotoHeading(index: number): void
  /** Scrolls to a saved reading position (px from the top). */
  restoreScroll(y: number): void
  /** Collects in-place text edits. Throws if they can't be saved safely. */
  collectChanges(): Promise<DocChanges>
  /** Draws these highlights (replacing the ones shown before). */
  setAnnotations(items: Annotation[]): void
  /** Scrolls to a highlight and makes it blink. */
  gotoAnnotation(id: string): void
  clearSelection(): void
}

/** Props every document view takes for the outline, reading position and highlights. */
export interface ReaderCallbacks {
  onOutline: (items: OutlineItem[]) => void
  /** Scroll position and the outline entry being read (-1 before the first one). */
  onReading: (y: number, activeHeading: number) => void
  /** Rendering finished (diagrams included), so a saved position can be restored. */
  onReady: () => void
  /** You selected text (or cleared the selection: null). */
  onSelection: (selection: TextSelection | null) => void
  /** You clicked a highlight. */
  onAnnotationClick: (id: string, rect: ScreenRect) => void
  /** After drawing: highlights whose text could not be found in the document any more. */
  onAnchored: (missingIds: string[]) => void
}

/** A new random id for a highlight. */
export function newAnnotationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
