// A reading style for HTML pages that have none of their own (notes made in the app, pages
// saved as bare HTML): readable width and font, headings, tables with borders, code, quotes,
// in the app's light or dark colours. Only shown in the app; the file is not changed.
//
// Pages with a <style> or a stylesheet <link> keep their own look. Every rule is wrapped in
// :where() so it weighs nothing against a style="" attribute or anything else on the page.

const HAS_STYLE = /<style[\s>]|<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i

export function plainPageStyle(source: string): string {
  if (HAS_STYLE.test(source)) return ''
  return `
<style data-studydocs>
  :where(html) { color-scheme: light dark; }
  :where(body) {
    --sd-ink: #1f2328; --sd-soft: #5a6067; --sd-bg: #fffdf9; --sd-line: #e4ddd0; --sd-head: #f4eee4;
    --sd-zebra: #fbf8f2; --sd-code: #f3eee5; --sd-accent: #b4531f; --sd-quote: #faf5ec; --sd-mark: #f7dfa8;
    max-width: 820px; margin: 0 auto; padding: 36px 32px 110px;
    font: 16px/1.72 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    color: var(--sd-ink); background: var(--sd-bg); -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    :where(body) {
      --sd-ink: #e8e6e1; --sd-soft: #a7abb1; --sd-bg: #24272c; --sd-line: #3a3e45; --sd-head: #2d3137;
      --sd-zebra: #282b31; --sd-code: #2f3238; --sd-accent: #e39a6a; --sd-quote: #2a2d33; --sd-mark: #6b5420;
    }
  }
  :where(h1, h2, h3, h4, h5, h6) { line-height: 1.28; margin: 1.6em 0 .5em; font-weight: 700; letter-spacing: -.01em; }
  :where(h1) { font-size: 2.05em; margin-top: .2em; }
  :where(h2) { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--sd-line); }
  :where(h3) { font-size: 1.22em; }
  :where(h4) { font-size: 1.05em; }
  :where(p, ul, ol, dl, table, pre, blockquote, figure) { margin: .75em 0; }
  :where(ul, ol) { padding-left: 1.6em; }
  :where(li) { margin: .2em 0; }
  :where(li::marker) { color: var(--sd-accent); }
  :where(a) { color: var(--sd-accent); text-underline-offset: 2px; }
  :where(b, strong) { font-weight: 650; }
  :where(code, kbd, samp) { font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: .88em; }
  :where(code) { background: var(--sd-code); padding: .12em .38em; border-radius: 5px; }
  :where(pre) { background: var(--sd-code); padding: 14px 16px; border-radius: 10px; overflow-x: auto; line-height: 1.55; }
  :where(pre code) { background: none; padding: 0; }
  :where(blockquote) { margin-left: 0; padding: .4em 1.1em; color: var(--sd-soft); background: var(--sd-quote);
    border-left: 3px solid var(--sd-accent); border-radius: 0 8px 8px 0; }
  :where(table) { border-collapse: collapse; border: 1px solid var(--sd-line); border-radius: 8px; font-size: .95em; }
  :where(th, td) { border: 1px solid var(--sd-line); padding: 7px 13px; text-align: left; vertical-align: top; }
  :where(th) { background: var(--sd-head); font-weight: 650; }
  :where(tbody tr:nth-child(even) td) { background: var(--sd-zebra); }
  :where(img, video) { max-width: 100%; height: auto; border-radius: 8px; }
  :where(hr) { border: none; border-top: 1px solid var(--sd-line); margin: 2.2em 0; }
  :where(mark) { background: var(--sd-mark); color: inherit; border-radius: 3px; padding: 0 2px; }
  :where(figcaption) { color: var(--sd-soft); font-size: .9em; text-align: center; }
</style>`
}
