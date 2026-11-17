// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/components/MarkdownView'

describe('renderMarkdown: code colours and formulas (issue #18)', () => {
  it('colours code blocks by language and leaves unknown languages plain', () => {
    const html = renderMarkdown('```js\nconst a = 1 // x\n```\n\n```nope\n<b>hi</b>\n```\n')
    expect(html).toContain('class="hljs-keyword"')
    expect(html).toContain('class="hljs-comment"')
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;') // still escaped
  })
  it('draws inline and block formulas with KaTeX and keeps them through sanitising', () => {
    const html = renderMarkdown('Có $x^2$ ở đây.\n\n$$\n\\frac{a}{b}\n$$\n')
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
    expect(html).not.toContain('katex-error')
    expect(html).toContain('<math') // MathML kept for screen readers / copy
  })
  it('does not keep javascript: links from formulas', () => {
    const html = renderMarkdown('$\\href{javascript:alert(1)}{x}$')
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i)
  })
})
