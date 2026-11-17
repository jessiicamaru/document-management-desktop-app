// Types for the parts of foliate-js mobi.js the app uses.

export interface MobiTocItem {
  label: string
  href: string
  subitems?: MobiTocItem[]
}

export interface MobiSection {
  id?: number
  /** Blob URL of the chapter as a full (X)HTML document, with resources as blob URLs. */
  load?: () => Promise<string>
  createDocument?: () => Promise<Document>
  size?: number
  linear?: string
}

export interface MobiBook {
  sections: MobiSection[]
  toc?: MobiTocItem[]
  metadata: { title?: string; author?: string[]; language?: string }
  resolveHref(href: string): { index: number; anchor: (doc: Document) => Element | null } | Promise<{ index: number; anchor: (doc: Document) => Element | null } | undefined>
  destroy(): void
}

export declare function isMOBI(file: Blob): Promise<boolean>

export declare class MOBI {
  constructor(options: { unzlib: (data: Uint8Array) => Promise<Uint8Array> })
  headers?: {
    palmdoc: { compression: number; numTextRecords: number; encryption: number }
    mobi: { encoding: number; title: ArrayBuffer }
    exth: Record<string, unknown> | null
  }
  open(file: Blob): Promise<MobiBook>
  /** Decompressed bytes of text record `index` (0-based). */
  loadText(index: number): Promise<Uint8Array>
  decode(data: Uint8Array | ArrayBuffer): string
}
