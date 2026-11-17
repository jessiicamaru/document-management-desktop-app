// Inline text editing for HTML documents.
//
// 1. In edit mode the doc:// protocol serves the page with a small script appended
//    (editModeInjection). The page's own scripts are switched off with a CSP nonce, so the
//    page's DOM is exactly what the HTML parser produced from the file.
// 2. That script makes every "text block" (a paragraph, heading, list item, table cell... that
//    only contains text and inline tags) editable as plain text, and remembers its position
//    in the tree. Enter/formatting are blocked: only typing and deleting characters.
// 3. On save, the changed blocks are sent back. applyHtmlEdits parses the original file with
//    parse5 (the same spec parser algorithm the browser uses), finds each block by position,
//    and replaces only the text between its start and end tag. Every other byte of the file
//    stays exactly as it was.
//
// No Electron imports here, so this file is unit tested directly.

import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { HtmlBlockEdit } from '../shared/types'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const isElement = (n: Node): n is Element => 'tagName' in n

export class HtmlEditError extends Error {}

export function applyHtmlEdits(source: string, edits: HtmlBlockEdit[]): string {
  // parse5 reports offsets into the text it parsed; keep a byte-order mark out of the way.
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const text = bom ? source.slice(1) : source
  const doc = parse(text, { sourceCodeLocationInfo: true })
  const html = doc.childNodes.find(isElement)
  if (!html) throw new HtmlEditError('File HTML không có thẻ <html>.')

  const ranges = edits.map((edit) => {
    let node: Element = html
    for (const index of edit.path) {
      const child = node.childNodes.filter(isElement)[index]
      if (!child) throw new HtmlEditError('Không tìm thấy đoạn văn đã sửa trong file. File có thể vừa bị thay đổi.')
      node = child
    }
    if (node.tagName !== edit.tag) {
      throw new HtmlEditError(`Đoạn văn đã sửa không khớp với file (<${edit.tag}> ≠ <${node.tagName}>). Hãy sửa trong raw.`)
    }
    const loc = node.sourceCodeLocation
    if (!loc?.startTag || !loc.endTag) {
      throw new HtmlEditError(`Thẻ <${edit.tag}> trong file không có thẻ đóng nên không sửa trực tiếp được. Hãy sửa đoạn này trong raw.`)
    }
    return { start: loc.startTag.endOffset, end: loc.endTag.startOffset, html: edit.html }
  })

  // Replace from the end of the file backwards so earlier offsets stay valid.
  ranges.sort((a, b) => b.start - a.start)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].end > ranges[i - 1].start) throw new HtmlEditError('Các đoạn sửa chồng lên nhau.')
  }
  let out = text
  for (const r of ranges) out = out.slice(0, r.start) + r.html + out.slice(r.end)
  return bom + out
}

/**
 * Appended to the end of the page in edit mode. Runs with `nonce`; everything else is blocked.
 * Talks to the app only through postMessage (the iframe is sandboxed, cross-origin).
 */
export function editModeInjection(nonce: string): string {
  return `
<style data-studydocs>
  [data-sd-block] { outline: 1px dashed transparent; outline-offset: 2px; border-radius: 3px; cursor: text; }
  [data-sd-block]:hover { outline-color: rgba(180, 83, 31, .45); }
  [data-sd-block]:focus { outline: 2px solid rgba(180, 83, 31, .8); background: rgba(180, 83, 31, .05); }
  [data-sd-block][data-sd-dirty] { box-shadow: inset 3px 0 0 rgba(47, 93, 138, .7); }
</style>
<script nonce="${nonce}" data-studydocs>
(() => {
  const HTML_NS = 'http://www.w3.org/1999/xhtml'
  const INLINE = new Set(['A','ABBR','B','BDI','BDO','BR','CITE','CODE','DATA','DEL','DFN','EM','I','INS','KBD','MARK','Q','S','SAMP','SMALL','SPAN','STRONG','SUB','SUP','TIME','U','VAR','WBR'])
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','TEXTAREA','SELECT','BUTTON','INPUT','IFRAME','CANVAS','VIDEO','AUDIO','OBJECT'])
  const isOurs = (el) => el.hasAttribute('data-studydocs')
  const onlyInline = (el) => [...el.children].every((c) => c.namespaceURI === HTML_NS && INLINE.has(c.tagName) && onlyInline(c))
  const pathOf = (el) => {
    const path = []
    while (el !== document.documentElement) {
      const parent = el.parentElement
      path.unshift([...parent.children].indexOf(el))
      el = parent
    }
    return path
  }

  // A block = the outermost element that has text and only inline tags inside.
  const blocks = []
  const walk = (el) => {
    for (const child of el.children) {
      if (isOurs(child) || child.namespaceURI !== HTML_NS || SKIP.has(child.tagName)) continue
      if (child.textContent.trim() && onlyInline(child)) {
        blocks.push({ el: child, path: pathOf(child), tag: child.tagName.toLowerCase(), original: child.innerHTML })
      } else {
        walk(child)
      }
    }
  }
  walk(document.body)

  const send = (msg) => parent.postMessage({ source: 'studydocs', ...msg }, '*')
  const dirtyCount = () => blocks.filter((b) => b.el.innerHTML !== b.original).length

  for (const b of blocks) {
    b.el.setAttribute('data-sd-block', '')
    b.el.contentEditable = 'plaintext-only'
    b.el.spellcheck = false
    // Text only: no new paragraphs/lines, no formatting, no dropping content in.
    b.el.addEventListener('beforeinput', (e) => {
      if (!/^(insertText|insertReplacementText|insertFromPaste|insertCompositionText|deleteContent|deleteWord|deleteSoftLine|deleteHardLine|deleteByCut|historyUndo|historyRedo)/.test(e.inputType)) e.preventDefault()
    })
    b.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault() })
    b.el.addEventListener('input', () => {
      b.el.toggleAttribute('data-sd-dirty', b.el.innerHTML !== b.original)
      send({ type: 'dirty', count: dirtyCount() })
    })
  }
  // Links inside editable text should not navigate while editing.
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) e.preventDefault() }, true)
  // Ctrl+S inside the page saves too.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); send({ type: 'save' }) }
    if (e.key === 'Escape') send({ type: 'cancel' })
  }, true)

  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.source !== 'studydocs-app') return
    if (e.data.type === 'collect') {
      const edits = blocks.filter((b) => b.el.innerHTML !== b.original).map((b) => ({ path: b.path, tag: b.tag, html: b.el.innerHTML }))
      send({ type: 'edits', id: e.data.id, edits })
    }
  })
  send({ type: 'ready', blocks: blocks.length })
})()
</script>`
}
