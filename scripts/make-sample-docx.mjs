// Builds a small Word document for trying the reader: sample-library/frontend/CSS Flexbox.docx
// Run with: node scripts/make-sample-docx.mjs
// A .docx is a zip of XML files; this is about the smallest one Word itself opens.
import JSZip from 'jszip'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part) =>
      part.startsWith('**') ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(part.slice(2, -2))}</w:t></w:r>` : `<w:r><w:t xml:space="preserve">${esc(part)}</w:t></w:r>`
    )
    .join('')}</w:p>`

const body = [
  para('CSS Flexbox', 'Heading1'),
  para('Flexbox xếp các phần tử con theo **một trục**: hàng ngang hoặc cột dọc.'),
  para('Trục chính và trục phụ', 'Heading2'),
  para('justify-content căn theo trục chính, align-items căn theo trục phụ.'),
  para('Khi nào dùng Grid', 'Heading2'),
  para('Bố cục hai chiều (hàng và cột cùng lúc) thì dùng **CSS Grid**.')
].join('')

export async function buildSampleDocx() {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
  )
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  )
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`
  )
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`)
  zip.file(
    'docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>CSS Flexbox — ghi chú</dc:title></cp:coreProperties>'
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sample-library', 'frontend', 'CSS Flexbox.docx')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, await buildSampleDocx())
  console.log('Wrote', out)
}
