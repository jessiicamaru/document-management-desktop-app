/// <reference types="vite/client" />
import type { DocsApi } from '../../shared/types'

declare global {
  interface Window {
    api: DocsApi
    /** Print window only: resolves when the Markdown page is fully drawn and can be printed. */
    __studydocsPrintReady?: Promise<void>
    /** Print window only: called by PrintPage when drawing is done. */
    __studydocsPrintDone?: () => void
  }
}

export {}
