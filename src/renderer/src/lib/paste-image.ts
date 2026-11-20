// Images pasted into a note (Raw, the Markdown editor, HTML editing).
//
// They are shrunk to at most MAX_WIDTH pixels wide and compressed as WebP, then either embedded
// in the file as a data: URL (one file is the whole note) or saved in an assets/ folder next to
// it (Settings → Library → Pasted images). Animated GIFs are kept as they are.

import { t } from '../../../shared/i18n'
import { ask } from './ask'

export const MAX_WIDTH = 1600
/** Embedded images bigger than this (after compression) ask whether to save a separate file. */
export const BIG_IMAGE = 2 * 1024 * 1024

export interface PreparedImage {
  bytes: Uint8Array
  mime: string
  ext: string
  width: number
  height: number
}

/** The first image of a paste or drop, if there is one. */
export function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // The decoded picture stays usable after the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/** Shrinks and compresses an image (GIFs are kept, they may be animated). */
export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  const original = new Uint8Array(await blob.arrayBuffer())
  const img = await loadImage(blob)
  const width = img.naturalWidth || 1
  const height = img.naturalHeight || 1
  if (blob.type === 'image/gif') return { bytes: original, mime: 'image/gif', ext: 'gif', width, height }
  const scale = Math.min(1, MAX_WIDTH / width)
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  // A small PNG or JPEG that would not get smaller stays as it is (when it needn't shrink).
  const keep = scale === 1 && /^image\/(png|jpeg|webp)$/.test(blob.type) && (!webp || webp.size >= original.length)
  if (keep || !webp) {
    const mime = keep ? blob.type : 'image/png'
    const bytes = keep ? original : new Uint8Array(await (await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))).arrayBuffer())
    return { bytes, mime, ext: mime === 'image/jpeg' ? 'jpg' : mime.slice(6), width: w, height: h }
  }
  return { bytes: new Uint8Array(await webp.arrayBuffer()), mime: 'image/webp', ext: 'webp', width: w, height: h }
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return `data:${mime};base64,${btoa(binary)}`
}

/** "240 KB", "1,3 MB". */
export function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The text to insert for an image, in the note's own language. */
export function imageMarkup(kind: 'md' | 'html', src: string, alt = ''): string {
  if (kind === 'md') return `![${alt.replace(/[[\]]/g, '')}](${src})`
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<img src="${esc(src)}" alt="${esc(alt)}">`
}

/**
 * Turns a pasted image into the src to insert: a data: URL, or a file in assets/ next to the
 * note. Null when cancelled.
 */
export async function imageSource(docId: string, blob: Blob, mode: 'embed' | 'assets'): Promise<string | null> {
  const image = await prepareImage(blob)
  let saveFile = mode === 'assets'
  if (!saveFile && image.bytes.length > BIG_IMAGE) {
    const answer = await ask({
      message: t('Ảnh này vẫn nặng {0} sau khi nén. Nhúng vào bài sẽ làm bài mở chậm.', { 0: sizeLabel(image.bytes.length) }),
      buttons: [t('Lưu ra file riêng'), t('Vẫn nhúng'), t('Huỷ')],
      cancelId: 2,
      defaultId: 0
    })
    if (answer === 2) return null
    saveFile = answer === 0
  }
  if (saveFile) return window.api.saveAsset(docId, image.bytes, image.ext)
  return toDataUrl(image.bytes, image.mime)
}
