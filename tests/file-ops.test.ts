import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkName, noteFileName, noteTemplate, renamedFileName } from '../src/main/file-ops'
import { MetaStore } from '../src/main/meta-store'
import { CalendarStore } from '../src/main/calendar-store'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'files-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('names of new notes and folders', () => {
  it('refuses names Windows would refuse, or that would hide the file', () => {
    for (const bad of ['', '   ', 'a/b', 'a\\b', 'a:b', 'what?', 'CON', 'nul.md', 'lpt1', 'tên.', 'tên .', '.ẩn']) {
      expect(() => checkName(bad), bad).toThrow()
    }
    expect(checkName('  Bài 3 - TCP và UDP  ')).toBe('Bài 3 - TCP và UDP')
  })

  it('adds the extension of the chosen type, unless it is already there', () => {
    expect(noteFileName('Bài 1', 'md')).toBe('Bài 1.md')
    expect(noteFileName('Bài 1.md', 'md')).toBe('Bài 1.md')
    expect(noteFileName('Bài 1', 'html')).toBe('Bài 1.html')
    expect(noteFileName('Trang.htm', 'html')).toBe('Trang.htm')
    expect(noteFileName('v1.2', 'md')).toBe('v1.2.md')
  })

  it('a rename keeps the old extension when it is left out', () => {
    expect(renamedFileName('Bài 2', 'Bài 1.md')).toBe('Bài 2.md')
    expect(renamedFileName('Bài 2.md', 'Bài 1.md')).toBe('Bài 2.md')
    expect(renamedFileName('Bài 2.MD', 'Bài 1.md')).toBe('Bài 2.MD')
    expect(renamedFileName('Trang', 'Trang cũ.html')).toBe('Trang.html')
  })

  it('new notes start with their title; HTML escapes it', () => {
    expect(noteTemplate('Bài 1.md', 'md')).toBe('# Bài 1\n\n')
    const html = noteTemplate('A <b> & "c".html', 'html')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>')
    expect(html).toContain('<h1>A &lt;b&gt; &amp; &quot;c&quot;</h1>')
  })
})

describe('tags and calendar links follow a rename or move', () => {
  it('a folder takes the entries of everything below it', async () => {
    const meta = await MetaStore.open(tmp())
    await meta.update('mang/b1.md', { tags: ['tcp'] })
    await meta.update('mang/lab/l1.md', { tags: ['lab'] })
    await meta.update('mang-khac.md', { tags: ['khac'] })
    expect(await meta.moveEntries('mang', 'hk1/mang')).toBe(2)
    expect(Object.keys(meta.all()).sort()).toEqual(['hk1/mang/b1.md', 'hk1/mang/lab/l1.md', 'mang-khac.md'])
    expect(await meta.moveEntries('mang-khac.md', 'khac.md')).toBe(1)
    expect(meta.all()['khac.md'].tags).toEqual(['khac'])
  })

  it('calendar links and notes folders follow, case-insensitively', async () => {
    const cal = await CalendarStore.open(tmp())
    const uid = await cal.create({ summary: 'x', allDay: true, start: '2026-11-17', end: '2026-11-18', location: '', description: '', color: '', rrule: '', exdates: [], reminder: -1 })
    const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
    await cal.link(uid, null, { path: 'D:\\HK1\\Mang\\b1.md', name: 'b1.md' }, same)
    await cal.link(uid, null, { path: 'D:\\HK1\\Mang', name: 'Mang', kind: 'folder' }, same)
    await cal.link(uid, null, { path: 'D:\\HK1\\Mang khac.md', name: 'Mang khac.md' }, same)
    await cal.setNotesFolder(uid, 'D:\\HK1\\mang\\ghi-chep')
    await cal.movePath('D:\\HK1\\mang', 'D:\\HK1\\Lập trình mạng', (p) => p.toLowerCase())
    expect(cal.linksOf(uid, '').map((l) => `${l.link.path} | ${l.link.name}`)).toEqual([
      'D:\\HK1\\Lập trình mạng\\b1.md | b1.md',
      'D:\\HK1\\Lập trình mạng | Lập trình mạng',
      'D:\\HK1\\Mang khac.md | Mang khac.md'
    ])
    expect(cal.notesFolder(uid)).toBe('D:\\HK1\\Lập trình mạng\\ghi-chep')
  })
})

describe('moving to another workspace folder', () => {
  it('takes the entries of a file or folder out of one store, keyed by what follows', async () => {
    const meta = await MetaStore.open(tmp())
    await meta.update('mang/b1.md', { tags: ['tcp'] })
    await meta.update('mang/lab/l1.md', { tags: ['lab'] })
    await meta.update('khac.md', { tags: ['x'] })
    const taken = await meta.takeEntries('mang')
    expect(Object.keys(taken).sort()).toEqual(['/b1.md', '/lab/l1.md'])
    expect(Object.keys(meta.all())).toEqual(['khac.md'])
    const other = await MetaStore.open(tmp())
    await other.importDocs(Object.fromEntries(Object.entries(taken).map(([k, v]) => [`hk2/mang${k}`, v])))
    expect(other.all()['hk2/mang/b1.md'].tags).toEqual(['tcp'])
  })
})
