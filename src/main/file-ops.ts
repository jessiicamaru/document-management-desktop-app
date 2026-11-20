// Names and starting content of notes created in the app (see the 'fs:*' handlers in index.ts).
// No Electron imports here, so this file is unit tested directly.

import { t } from '../shared/i18n'

export type NoteKind = 'md' | 'html'

const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** A file or folder name as typed, checked for Windows. Throws a message for the user. */
export function checkName(input: string): string {
  const name = String(input ?? '').trim()
  if (!name) throw new Error(t('Hãy nhập tên.'))
  if (BAD_CHARS.test(name)) throw new Error(t('Tên không được có các ký tự \\ / : * ? " < > |'))
  if (name === '.' || name === '..' || RESERVED.test(name)) throw new Error(t('Windows không cho dùng tên "{0}".', { 0: name }))
  if (name.startsWith('.')) throw new Error(t('Tên bắt đầu bằng dấu chấm sẽ bị ẩn; hãy đặt tên khác.'))
  if (/[. ]$/.test(name)) throw new Error(t('Tên không được kết thúc bằng dấu chấm hoặc dấu cách.'))
  if (name.length > 200) throw new Error(t('Tên quá dài.'))
  return name
}

/** "Bài 1" + md -> "Bài 1.md"; a name that already ends with the right extension is kept. */
export function noteFileName(input: string, kind: NoteKind): string {
  const name = checkName(input)
  const has = kind === 'md' ? /\.(md|markdown)$/i : /\.html?$/i
  return has.test(name) ? name : `${name}.${kind}`
}

/** A rename keeps the extension when you leave it out ("Bài 2" for "Bài 1.md" -> "Bài 2.md"). */
export function renamedFileName(input: string, current: string): string {
  const name = checkName(input)
  const ext = /\.[^.]+$/.exec(current)?.[0] ?? ''
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** What a new note starts with: its title, and for HTML a small readable page. */
export function noteTemplate(fileName: string, kind: NoteKind): string {
  const title = fileName.replace(/\.(md|markdown|html?)$/i, '')
  if (kind === 'md') return `# ${title}\n\n`
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; font: 16px/1.65 "Segoe UI", system-ui, sans-serif; color: #1f2328; background: #fffdf9; }
  h1, h2, h3 { line-height: 1.25; }
  img { max-width: 100%; height: auto; }
  code { font-family: Consolas, monospace; background: #f1ece3; padding: 1px 4px; border-radius: 4px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ddd5c6; padding: 6px 10px; }
  @media (prefers-color-scheme: dark) {
    body { background: #24272c; color: #e8e6e1; }
    code { background: #2c2f35; }
    th, td { border-color: #3a3d43; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(t('Viết ở đây…'))}</p>
</body>
</html>
`
}
