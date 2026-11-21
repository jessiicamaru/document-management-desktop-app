import { describe, expect, it } from 'vitest'
import { noteTemplate } from '../src/main/file-ops'
import { readingCss, withReadingStyle } from '../src/main/page-style'

/** A note made by the first template (v0.12 to v0.15), as written in the file. */
const oldNote = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Packages</title>
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
<h1>Packages Updating Note</h1>
</body>
</html>
`

const switchedOff = (html: string): number => (html.match(/<style data-studydocs-note media="not all">/g) ?? []).length
const styled = (html: string): boolean => html.includes('<style data-studydocs>') && html.includes(':where(th, td)')

describe('the look of app notes and plain pages', () => {
  it('a new HTML note carries the style in its file', () => {
    const note = noteTemplate('Ghi chú.html', 'html')
    expect(note).toContain('<style data-studydocs-note>')
    expect(note).toContain(':where(th, td)')
  })

  it('in the app, a new note shows the current style in the chosen accent; its own block is switched off', () => {
    const shown = withReadingStyle(noteTemplate('Ghi chú.html', 'html'), '#2f5d8a')
    expect(switchedOff(shown)).toBe(1)
    expect(styled(shown)).toBe(true)
    expect(shown).toContain('--sd-accent-base: #2f5d8a;')
  })

  it('a note made by the first template gets the new style too', () => {
    const shown = withReadingStyle(oldNote)
    expect(switchedOff(shown)).toBe(1)
    expect(styled(shown)).toBe(true)
    // Switched off in place: the page keeps the same elements.
    expect(shown.replace('<style data-studydocs-note media="not all">', '<style>').startsWith(oldNote.slice(0, oldNote.indexOf('</html>')))).toBe(true)
  })

  it('an old note whose style was changed by hand keeps it', () => {
    const mine = oldNote.replace('max-width: 760px; margin: 40px auto;', 'max-width: 900px; margin: 40px auto;')
    expect(withReadingStyle(mine)).toBe(mine)
  })

  it('a page without any style gets it', () => {
    expect(styled(withReadingStyle('<!doctype html><html><body><table><tr><td>1</td></tr></table></body></html>'))).toBe(true)
  })

  it('imported pages with a style of their own are left alone', () => {
    for (const page of [
      '<html><head><style>p{color:red}</style></head><body></body></html>',
      '<html><head><link rel="stylesheet" href="a.css"></head></html>',
      "<html><head><link href='a.css' rel='preload stylesheet'></head></html>",
      // the app's block and a style of the page's own: the page's own look wins, nothing is touched
      `<html><head><style data-studydocs-note>p{}</style><style>p{color:red}</style></head></html>`
    ]) {
      expect(withReadingStyle(page)).toBe(page)
    }
  })

  it('every rule weighs nothing against the page (wrapped in :where)', () => {
    const selectors = [...readingCss().matchAll(/^\s*([^@{}\s][^{}]*)\{/gm)].map((m) => m[1].trim())
    expect(selectors.length).toBeGreaterThan(10)
    for (const s of selectors) expect(s.startsWith(':where(')).toBe(true)
  })

  it('only a real colour is used as the accent', () => {
    expect(readingCss('#2f5d8a')).toContain('--sd-accent-base: #2f5d8a;')
    expect(readingCss('red;}</style><script>')).toContain('--sd-accent-base: #b4531f;')
  })
})
