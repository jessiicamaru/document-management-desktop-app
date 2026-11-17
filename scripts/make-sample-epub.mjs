// Builds a small EPUB book for trying the reader: sample-library/sach/Git cơ bản.epub
// Run with: node scripts/make-sample-epub.mjs
import JSZip from 'jszip'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const chapters = [
  {
    id: 'c1',
    title: 'Chương 1. Git là gì?',
    body: `<p>Git là một <strong>hệ thống quản lý phiên bản phân tán</strong>. Mỗi máy giữ toàn bộ lịch sử của dự án, nên vẫn làm việc được khi không có mạng.</p>
<p>Mỗi lần lưu lại trạng thái của dự án gọi là một <em>commit</em>. Commit giống một tấm ảnh chụp toàn bộ thư mục tại thời điểm đó, kèm lời mô tả vì sao thay đổi.</p>
<p>Ba vùng cần nhớ: thư mục làm việc, vùng chuẩn bị (staging) và kho lưu trữ (repository).</p>`
  },
  {
    id: 'c2',
    title: 'Chương 2. Nhánh và hợp nhất',
    body: `<p>Một <strong>nhánh</strong> (branch) chỉ là một con trỏ tới một commit. Tạo nhánh rất rẻ, nên hãy tạo nhánh cho mỗi tính năng.</p>
<p>Khi tính năng xong, ta <em>hợp nhất</em> (merge) nhánh đó vào nhánh chính. Nếu hai nhánh sửa cùng một dòng, Git báo xung đột để bạn tự quyết định.</p>`
  },
  {
    id: 'c3',
    title: 'Chương 3. Làm việc với remote',
    body: `<p>Remote là bản sao của kho nằm ở nơi khác, ví dụ trên GitHub. Lệnh <code>git push</code> gửi commit lên remote, <code>git pull</code> lấy commit mới về.</p>
<p>Quy tắc vàng: luôn <strong>pull trước khi push</strong> để tránh ghi đè công việc của người khác.</p>`
  }
]

const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="vi" xml:lang="vi">
<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" href="style.css"/></head>
<body><h1>${title}</h1>${body}</body>
</html>`

export async function buildSampleEpub() {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' }) // must be first and uncompressed
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:5b8b0c1e-0000-4000-8000-studydocs01</dc:identifier>
    <dc:title>Git cơ bản</dc:title>
    <dc:language>vi</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${chapters.map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n    ')}
  </spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    xhtml('Mục lục', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${chapters.map((c) => `<li><a href="${c.id}.xhtml">${c.title}</a></li>`).join('')}</ol></nav>`)
  )
  zip.file('OEBPS/style.css', 'body { line-height: 1.7; } h1 { font-size: 1.5em; } code { background: rgba(0,0,0,.06); padding: 0 4px; }')
  for (const c of chapters) zip.file(`OEBPS/${c.id}.xhtml`, xhtml(c.title, c.body))
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
}

// Run directly: write the file into sample-library/.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sample-library', 'sach', 'Git cơ bản.epub')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, await buildSampleEpub())
  console.log('wrote', out)
}
