// Kindle books (.mobi, .azw3) are turned into an EPUB in memory (issue #20), so the EPUB
// reader shows them with everything it has: page turning, outline, highlights, Ctrl+F and
// the reading position. The conversion is the same every time, so saved positions and
// highlights (EPUB CFIs) keep pointing at the same place.
//
// foliate-js (src/vendor/foliate) does the hard part: decompressing the book and giving
// each chapter as an (X)HTML document whose images, fonts and styles are blob: URLs. The
// EPUB here only holds those chapters, a table of contents and the package file; the
// blob: URLs stay valid until dispose() is called.

import JSZip from 'jszip'
import { MOBI, type MobiTocItem } from '../../../vendor/foliate/mobi.js'
import { t } from '../../../shared/i18n'

/** Fonts inside Kindle books are zlib-compressed. */
async function unzlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface ConvertedBook {
  epub: ArrayBuffer
  /** Frees the images/styles of the book (blob: URLs). */
  dispose: () => void
}

export async function mobiToEpub(bytes: Uint8Array): Promise<ConvertedBook> {
  const book = await new MOBI({ unzlib }).open(new Blob([bytes as BlobPart]))
  const inner = (book as unknown as { mobi?: { headers?: { palmdoc?: { encryption?: number } } } }).mobi
  if (inner?.headers?.palmdoc?.encryption) {
    book.destroy()
    throw new Error(t('Sách này có DRM (mua trên Kindle) nên không mở được.'))
  }
  try {
    // 1. Chapters, as documents (so the table of contents can point inside them).
    const chapters: { index: number; file: string; doc: Document }[] = []
    for (const [index, section] of book.sections.entries()) {
      if (!section.load) continue // not part of the reading order
      const text = await (await fetch(await section.load())).text()
      let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml')
      if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html')
      chapters.push({ index, file: `text/c${index}.xhtml`, doc })
    }
    if (!chapters.length) throw new Error(t('Không đọc được nội dung cuốn sách này.'))

    // 2. Table of contents: each entry becomes a link to its chapter (and the place inside it).
    let ids = 0
    const navItem = async (item: MobiTocItem): Promise<string> => {
      let href = chapters[0].file
      try {
        const target = await book.resolveHref(item.href)
        const chapter = target && chapters.find((c) => c.index === target.index)
        if (chapter) {
          href = chapter.file
          const el = target.anchor(chapter.doc)
          if (el) {
            if (!el.id) el.id = `sd-toc-${ids++}`
            href += `#${el.id}`
          }
        }
      } catch {
        // a broken entry still shows; it goes to the start of the book
      }
      let sub = ''
      for (const child of item.subitems ?? []) sub += await navItem(child)
      return `<li><a href="${xmlEscape(href)}">${xmlEscape(item.label.trim() || '…')}</a>${sub ? `<ol>${sub}</ol>` : ''}</li>`
    }
    let nav = ''
    for (const item of book.toc ?? []) nav += await navItem(item)
    if (!nav) nav = chapters.map((c, i) => t('<li><a href="{0}">Phần {1}</a></li>', { 0: c.file, 1: i + 1 })).join('')

    // 3. The EPUB itself.
    const title = book.metadata.title?.trim() || t('Sách')
    const lang = book.metadata.language || 'und'
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    const serializer = new XMLSerializer()
    for (const c of chapters) zip.file(c.file, `<?xml version="1.0" encoding="utf-8"?>\n${serializer.serializeToString(c.doc)}`)
    zip.file(
      'nav.xhtml',
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${xmlEscape(title)}</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`
    )
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">studydocs-kindle</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>${xmlEscape(lang)}</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapters.map((c) => `    <item id="c${c.index}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
${chapters.map((c) => `    <itemref idref="c${c.index}"/>`).join('\n')}
  </spine>
</package>`
    )
    const epub = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })
    return { epub, dispose: () => book.destroy() }
  } catch (err) {
    book.destroy()
    throw err
  }
}
