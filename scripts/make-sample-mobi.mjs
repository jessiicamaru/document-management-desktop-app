// Builds a small Kindle book (MOBI, PalmDOC, UTF-8) for trying the reader:
// sample-library/sach/Docker nhanh.mobi        Run with: node scripts/make-sample-mobi.mjs
//
// A real Kindle book has more (compression, images, an index for the table of contents),
// but this is the same format: a Palm database whose first record holds the headers and
// whose next records hold the book's HTML, 4096 bytes each. Its table of contents is the
// old-style one: a <guide> reference to a page of `filepos` links (byte offsets).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TITLE = 'Docker nhanh'

const chapters = [
  {
    title: 'Chương 1. Container là gì?',
    body: '<p>Container đóng gói <b>ứng dụng cùng mọi thứ nó cần</b>: thư viện, cấu hình, công cụ. Chạy ở máy nào cũng giống nhau.</p><p>Khác máy ảo, container dùng chung nhân hệ điều hành nên khởi động trong vài giây.</p>'
  },
  {
    title: 'Chương 2. Image và Dockerfile',
    body: '<p>Image là khuôn để tạo container. <i>Dockerfile</i> mô tả cách dựng image, từng lớp một.</p><p>Mỗi lệnh trong Dockerfile tạo một lớp; lớp không đổi được dùng lại từ bộ nhớ đệm.</p>'
  },
  {
    title: 'Chương 3. Volume và mạng',
    body: '<p>Dữ liệu trong container mất khi xoá container. Dùng <b>volume</b> để giữ dữ liệu lâu dài.</p><p>Các container trong cùng một mạng gọi nhau bằng tên dịch vụ.</p>'
  }
]

const pad = (n) => String(n).padStart(10, '0')

/** The book's HTML, with filepos links pointing at the right byte offsets. */
function bookHtml() {
  const parts = (positions) => [
    `<html><head><guide><reference type="toc" title="Mục lục" filepos=${pad(positions.toc)} /></guide></head><body>`,
    `<h2>Mục lục</h2>`,
    ...chapters.map((c, i) => `<p><a filepos=${pad(positions.chapters[i])}>${c.title}</a></p>`),
    ...chapters.map((c) => `<mbp:pagebreak/><h1>${c.title}</h1>${c.body}`),
    '</body></html>'
  ]
  // Lay out once with dummy positions (fixed width), then measure where each part starts.
  const dummy = { toc: 0, chapters: chapters.map(() => 0) }
  const sizes = parts(dummy).map((p) => Buffer.byteLength(p))
  const at = (i) => sizes.slice(0, i).reduce((a, b) => a + b, 0)
  const positions = { toc: at(1), chapters: chapters.map((_, i) => at(2 + chapters.length + i)) }
  return Buffer.from(parts(positions).join(''), 'utf8')
}

export function buildSampleMobi() {
  const text = bookHtml()
  const textRecords = []
  for (let i = 0; i < text.length; i += 4096) textRecords.push(text.subarray(i, i + 4096))

  // Record 0: PalmDOC header (16 bytes) + MOBI header (232 bytes) + full title.
  const title = Buffer.from(TITLE, 'utf8')
  const rec0 = Buffer.alloc(16 + 232 + title.length + 4)
  rec0.writeUInt16BE(1, 0) // no compression
  rec0.writeUInt32BE(text.length, 4)
  rec0.writeUInt16BE(textRecords.length, 8)
  rec0.writeUInt16BE(4096, 10)
  rec0.writeUInt16BE(0, 12) // not encrypted
  rec0.write('MOBI', 16, 'latin1')
  rec0.writeUInt32BE(232, 20) // header length
  rec0.writeUInt32BE(2, 24) // a book
  rec0.writeUInt32BE(65001, 28) // UTF-8
  rec0.writeUInt32BE(0x5d0c5d0c, 32)
  rec0.writeUInt32BE(6, 36) // MOBI version 6
  rec0.writeUInt32BE(16 + 232, 84) // title offset
  rec0.writeUInt32BE(title.length, 88)
  rec0.writeUInt8(42, 95) // Vietnamese
  rec0.writeUInt32BE(textRecords.length + 1, 108) // first resource record (none)
  rec0.writeUInt32BE(0, 128) // no EXTH
  rec0.writeUInt32BE(0, 240) // no trailing entries
  rec0.writeUInt32BE(0xffffffff, 244) // no index
  title.copy(rec0, 16 + 232)

  const records = [rec0, ...textRecords]
  const header = Buffer.alloc(78 + records.length * 8 + 2)
  header.write(TITLE.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 31), 0, 'latin1')
  header.write('BOOK', 60, 'latin1')
  header.write('MOBI', 64, 'latin1')
  header.writeUInt16BE(records.length, 76)
  let offset = header.length
  records.forEach((r, i) => {
    header.writeUInt32BE(offset, 78 + i * 8)
    header.writeUInt32BE(i * 2, 78 + i * 8 + 4) // unique id
    offset += r.length
  })
  return Buffer.concat([header, ...records])
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sample-library', 'sach', `${TITLE}.mobi`)
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, buildSampleMobi())
  console.log('Wrote', out)
}
