import { describe, expect, it } from 'vitest'
import { canOpenWithDefaultApp } from '../src/main/open-policy'
import { detectEol, fromLf, toLf } from '../src/renderer/src/lib/eol'

describe('canOpenWithDefaultApp (issue #1)', () => {
  it.each(['a.pdf', 'b.PNG', 'c.docx', 'd.txt', 'e.mp4'])('opens %s', (f) => {
    expect(canOpenWithDefaultApp(f)).toBe(true)
  })
  it.each(['x.exe', 'x.py', 'x.url', 'x.chm', 'x.iso', 'x.docm', 'x.xlsm', 'x.msix', 'x.appinstaller', 'x.settingcontent-ms', 'x.lnk', 'x', 'x.pdf.exe'])(
    'refuses %s',
    (f) => {
      expect(canOpenWithDefaultApp(f)).toBe(false)
    }
  )
})

describe('line endings (issue #3)', () => {
  it('detects CRLF and LF', () => {
    expect(detectEol('a\r\nb\r\nc')).toBe('\r\n')
    expect(detectEol('a\nb\nc')).toBe('\n')
    expect(detectEol('no line break')).toBe('\n')
  })
  it('round-trips a CRLF file unchanged', () => {
    const file = '# Tiêu đề\r\n\r\nDòng một.\r\nDòng hai.\r\n'
    expect(fromLf(toLf(file), detectEol(file))).toBe(file)
  })
  it('keeps CRLF for lines added in the editor', () => {
    expect(fromLf('a\nb\nmới\n', '\r\n')).toBe('a\r\nb\r\nmới\r\n')
  })
})
