// The look of HTML notes made in the app, and of bare HTML pages without CSS of their own:
// readable width and font, headings with a touch of colour, tables as cards, code, quotes, in
// the app's accent colour and light or dark.
//
// - A new HTML note carries this style in the file (<style data-studydocs-note>), so it also
//   looks right outside the app. In the app that block is switched off and the current style,
//   in the chosen accent colour, is shown instead, so notes follow later changes of the style.
//   Notes made with the first template (its plainer style) get it too.
// - Pages with a style of their own (imported pages) keep their own look, untouched.
// - Nothing is written to the file when a page is shown. Every selector is wrapped in :where()
//   so it weighs nothing against a style="" attribute or anything else on the page.

const HAS_STYLE = /<style[\s>]|<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i
const DEFAULT_ACCENT = '#b4531f'

/** The app's style block in a note made with New note. */
const NOTE_STYLE = /<style data-studydocs-note>([\s\S]*?)<\/style>/g
/** The style block of notes made with the first template (v0.12 to v0.15), known by its first rule. */
const OLD_NOTE_STYLE = /<style>(\s*body \{ max-width: 760px; margin: 40px auto; padding: 0 20px; font: 16px\/1\.65 "Segoe UI", system-ui, sans-serif;[\s\S]*?)<\/style>/g
const SWITCHED_OFF = /<style data-studydocs-note media="not all">[\s\S]*?<\/style>/g

/** What a new HTML note carries in its <head>. */
export function noteStyleBlock(): string {
  return `<style data-studydocs-note>${readingCss()}</style>`
}

/**
 * The page as shown in the app: an app note's own style block switched off (media="not all",
 * so the elements of the page keep their places) and the current style added; a page without
 * any style gets it too; a page with a style of its own is returned as it is.
 */
export function withReadingStyle(source: string, accent = DEFAULT_ACCENT): string {
  const off = (_m: string, body: string): string => `<style data-studydocs-note media="not all">${body}</style>`
  const shown = source.replace(NOTE_STYLE, off).replace(OLD_NOTE_STYLE, off)
  if (HAS_STYLE.test(shown.replace(SWITCHED_OFF, ''))) return source
  return `${shown}\n<style data-studydocs>${readingCss(accent)}</style>`
}

/** The rules of the style, in an accent colour. */
export function readingCss(accent = DEFAULT_ACCENT): string {
  const a = /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : DEFAULT_ACCENT
  return `
  :where(html) { color-scheme: light dark; }
  :where(body) {
    --sd-accent-base: ${a};
    --sd-accent: var(--sd-accent-base);
    --sd-accent-2: color-mix(in srgb, var(--sd-accent-base) 55%, #7b4fd0);
    --sd-ink: #1d2127; --sd-soft: #59606a; --sd-bg: #fffdf9; --sd-line: #e8e1d5;
    --sd-tint: color-mix(in srgb, var(--sd-accent) 9%, transparent);
    --sd-tint-2: color-mix(in srgb, var(--sd-accent) 16%, transparent);
    --sd-card: #ffffff; --sd-shadow: 0 1px 2px rgba(40, 30, 20, .05), 0 6px 22px rgba(40, 30, 20, .07);
    --sd-code: color-mix(in srgb, var(--sd-accent) 8%, #f5f1ea); --sd-mark: #f9dfa0;
    max-width: 840px; margin: 0 auto; padding: 44px 36px 120px;
    font: 16px/1.75 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    color: var(--sd-ink); -webkit-font-smoothing: antialiased;
    background:
      radial-gradient(900px 340px at 100% -60px, color-mix(in srgb, var(--sd-accent) 11%, transparent), transparent 70%),
      radial-gradient(700px 300px at -10% -80px, color-mix(in srgb, var(--sd-accent-2) 8%, transparent), transparent 70%),
      var(--sd-bg);
    background-repeat: no-repeat;
  }
  @media (prefers-color-scheme: dark) {
    :where(body) {
      --sd-accent: color-mix(in srgb, var(--sd-accent-base) 62%, white);
      --sd-accent-2: color-mix(in srgb, var(--sd-accent-base) 45%, #b39cff);
      --sd-ink: #e9e7e2; --sd-soft: #a8adb4; --sd-bg: #23262b; --sd-line: #393d44;
      --sd-tint: color-mix(in srgb, var(--sd-accent) 12%, transparent);
      --sd-tint-2: color-mix(in srgb, var(--sd-accent) 22%, transparent);
      --sd-card: #282b31; --sd-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 26px rgba(0, 0, 0, .28);
      --sd-code: color-mix(in srgb, var(--sd-accent) 12%, #2c2f35); --sd-mark: #6b5420;
    }
  }
  :where(::selection) { background: var(--sd-tint-2); }
  :where(html)::-webkit-scrollbar { width: 10px; height: 10px; }
  :where(html)::-webkit-scrollbar-track { background: transparent; }
  :where(html)::-webkit-scrollbar-button { display: none; }
  :where(html)::-webkit-scrollbar-thumb { background-color: rgba(128, 128, 128, .35); border: 3px solid transparent; border-radius: 999px; background-clip: padding-box; }
  :where(html)::-webkit-scrollbar-thumb:hover { background-color: rgba(128, 128, 128, .6); border-width: 2px; }

  :where(h1, h2, h3, h4, h5, h6) { line-height: 1.25; margin: 1.7em 0 .55em; font-weight: 750; letter-spacing: -.015em; }
  :where(h1) {
    font-size: 2.3em; margin-top: .1em; padding-bottom: .35em;
    background: linear-gradient(120deg, var(--sd-ink) 30%, var(--sd-accent) 75%, var(--sd-accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    border-bottom: 3px solid transparent;
    border-image: linear-gradient(90deg, var(--sd-accent), var(--sd-accent-2) 30%, transparent 60%) 1;
  }
  :where(h2) { font-size: 1.5em; padding-left: .65em; border-left: 4px solid var(--sd-accent); border-radius: 2px; }
  :where(h3) { font-size: 1.22em; color: var(--sd-accent); }
  :where(h4) { font-size: 1.05em; text-transform: uppercase; letter-spacing: .06em; color: var(--sd-soft); }

  :where(p, ul, ol, dl, table, pre, blockquote, figure, details) { margin: .85em 0; }
  :where(b, strong) { font-weight: 650; }
  :where(ul, ol) { padding-left: 1.5em; }
  :where(li) { margin: .3em 0; padding-left: .2em; }
  :where(li)::marker { color: var(--sd-accent); font-weight: 700; }
  :where(a) { color: var(--sd-accent); text-decoration: none; background: linear-gradient(currentColor, currentColor) 0 100% / 100% 1px no-repeat; transition: background-size .2s; }
  :where(a:hover) { background-size: 100% 2px; }

  :where(code, kbd, samp) { font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: .87em; }
  :where(code) { background: var(--sd-code); color: color-mix(in srgb, var(--sd-accent) 65%, var(--sd-ink)); padding: .15em .42em; border-radius: 6px; }
  :where(kbd) { padding: .1em .45em; border: 1px solid var(--sd-line); border-bottom-width: 2px; border-radius: 6px; background: var(--sd-card); }
  :where(pre) { background: var(--sd-code); padding: 16px 18px; border-radius: 12px; overflow-x: auto; line-height: 1.55;
    border: 1px solid var(--sd-line); box-shadow: inset 3px 0 0 var(--sd-accent); }
  :where(pre code) { background: none; padding: 0; color: inherit; }

  :where(blockquote) { margin-left: 0; padding: .7em 1.2em; color: var(--sd-soft);
    background: linear-gradient(90deg, var(--sd-tint-2), var(--sd-tint) 40%, transparent);
    border-left: 4px solid var(--sd-accent); border-radius: 0 12px 12px 0; }

  :where(table) { border-collapse: separate; border-spacing: 0; min-width: min(100%, 360px); font-size: .95em;
    background: var(--sd-card); border: 1px solid var(--sd-line); border-radius: 12px; overflow: hidden; box-shadow: var(--sd-shadow); }
  :where(th, td) { padding: 9px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--sd-line); }
  :where(th + th, td + td, th + td, td + th) { border-left: 1px solid color-mix(in srgb, var(--sd-line) 60%, transparent); }
  :where(tr:last-child > td, tr:last-child > th) { border-bottom: none; }
  :where(thead th, tr:first-child > th) {
    background: linear-gradient(180deg, var(--sd-tint-2), var(--sd-tint));
    color: color-mix(in srgb, var(--sd-accent) 75%, var(--sd-ink)); font-weight: 700;
    font-size: .88em; text-transform: uppercase; letter-spacing: .05em;
  }
  :where(tbody tr:nth-child(even) > td) { background: color-mix(in srgb, var(--sd-tint) 45%, transparent); }
  :where(tbody tr) { transition: background-color .15s; }
  :where(tbody tr:hover > td) { background: var(--sd-tint); }
  :where(td:first-child) { font-weight: 600; }

  :where(img, video) { max-width: 100%; height: auto; border-radius: 12px; box-shadow: var(--sd-shadow); }
  :where(hr) { border: none; height: 2px; margin: 2.4em 0; background: linear-gradient(90deg, transparent, var(--sd-accent), var(--sd-accent-2), transparent); opacity: .5; }
  :where(mark) { background: var(--sd-mark); color: inherit; border-radius: 4px; padding: 0 3px; }
  :where(figcaption) { color: var(--sd-soft); font-size: .9em; text-align: center; }
  :where(details) { padding: .5em 1em; border: 1px solid var(--sd-line); border-radius: 10px; background: var(--sd-card); }
  :where(summary) { cursor: pointer; font-weight: 600; color: var(--sd-accent); }
`
}
