import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pdfText } from '../src/main/pdf-text'
import { extractText } from '../src/main/library'

/** A minimal valid PDF with one line of text on each page. */
function makePdf(lines: string[]): Buffer {
  const objects: string[] = []
  const pageIds = lines.map((_, i) => 4 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${lines.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  lines.forEach((line, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`
    objects[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studydocs-pdf-'))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

describe('PDF text for search (issue #19)', () => {
  it('reads the text of every page', async () => {
    const file = path.join(dir, 'a.pdf')
    await writeFile(file, makePdf(['Event Sourcing keeps every event', 'Replay rebuilds the state']))
    const text = await extractText(file, 'pdf')
    expect(text).toContain('Event Sourcing keeps every event')
    expect(text).toContain('Replay rebuilds the state')
  })
  it('stops at the size limit', async () => {
    const file = path.join(dir, 'b.pdf')
    await writeFile(file, makePdf(['First page text', 'Second page text', 'Third page text']))
    expect((await pdfText(file, 10)).length).toBeLessThanOrEqual(10)
  })
  it('fails cleanly on a broken file', async () => {
    const file = path.join(dir, 'c.pdf')
    await writeFile(file, '%PDF-1.4 nothing here')
    await expect(pdfText(file, 1000)).rejects.toThrow()
  })
})
