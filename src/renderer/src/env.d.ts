/// <reference types="vite/client" />
import type { DocsApi } from '../../shared/types'

declare global {
  interface Window {
    api: DocsApi
  }
}

export {}
