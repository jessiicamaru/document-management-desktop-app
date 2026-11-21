import { describe, expect, it } from 'vitest'
import { plainPageStyle } from '../src/main/page-style'

describe('reading style for plain HTML pages', () => {
  it('is added to a page without a style of its own', () => {
    const css = plainPageStyle('<!doctype html><html><body><h1>Ghi chú</h1><table><tr><td>1</td></tr></table></body></html>')
    expect(css).toContain('<style data-studydocs>')
    expect(css).toContain(':where(th, td)')
    expect(css).toContain('prefers-color-scheme: dark')
  })

  it('leaves pages with their own look alone', () => {
    expect(plainPageStyle('<html><head><style>p{color:red}</style></head><body></body></html>')).toBe('')
    expect(plainPageStyle('<html><head><link rel="stylesheet" href="a.css"></head></html>')).toBe('')
    expect(plainPageStyle("<html><head><link href='a.css' rel='preload stylesheet'></head></html>")).toBe('')
  })

  it('every rule weighs nothing against the page (wrapped in :where)', () => {
    const css = plainPageStyle('<p>x</p>').replace(/<\/?style[^>]*>/g, '')
    const selectors = [...css.matchAll(/^\s*([^@{}\s][^{}]*)\{/gm)].map((m) => m[1].trim())
    expect(selectors.length).toBeGreaterThan(10)
    for (const s of selectors) expect(s.startsWith(':where(')).toBe(true)
  })
})

describe('reading style colours', () => {
  it('uses the accent colour of the app, and only a real colour', () => {
    expect(plainPageStyle('<p>x</p>', '#2f5d8a')).toContain('--sd-accent-base: #2f5d8a;')
    expect(plainPageStyle('<p>x</p>', 'red;}</style><script>')).toContain('--sd-accent-base: #b4531f;')
  })
})
