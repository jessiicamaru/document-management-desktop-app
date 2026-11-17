// Which library files may be opened with their default Windows app.
//
// An allowlist, not a blocklist: a blocklist always misses something (.py, .url, .chm,
// macro-enabled Office files, disk images...). Anything not listed here is only shown
// in Explorer, where you can decide yourself.

import path from 'node:path'

const SAFE_TO_OPEN = new Set([
  // documents
  '.pdf', '.txt', '.md', '.markdown', '.html', '.htm', '.epub', '.csv', '.rtf',
  // Office without macros
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif',
  // audio / video
  '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.mkv', '.mov'
])

export function canOpenWithDefaultApp(file: string): boolean {
  return SAFE_TO_OPEN.has(path.extname(file).toLowerCase())
}
