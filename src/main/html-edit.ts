// Inline text editing for HTML documents.
//
// 1. In edit mode the doc:// protocol serves the page with a small script appended
//    (editModeInjection). The page's own scripts are switched off with a CSP nonce, so the
//    page's DOM is exactly what the HTML parser produced from the file.
// 2. That script makes every "text block" (a paragraph, heading, list item, table cell... that
//    only contains text, inline tags and pictures) editable, and remembers its position in the
//    tree. Inside a block: typing, bold/italic/underline/strike, links, pasted pictures.
//    Enter in a paragraph or list item starts a new one right after it; nothing else in the
//    page's structure can change.
// 3. On save, the changed blocks are sent back. applyHtmlEdits parses the original file with
//    parse5 (the same spec parser algorithm the browser uses), finds each block by position,
//    and replaces only the text between its start and end tag; new paragraphs go right after
//    its end tag. Every other byte of the file stays exactly as it was. What the page sends is
//    cleaned first (sanitizeInline): only inline tags, no scripts or on…="" handlers.
//
// No Electron imports here, so this file is unit tested directly.

import { parse, parseFragment, serialize } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { HtmlBlockEdit } from '../shared/types'
import { t } from '../shared/i18n'
import { anchoringSource } from './view-helper'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const isElement = (n: Node): n is Element => 'tagName' in n

export class HtmlEditError extends Error {}

type ParentNode = DefaultTreeAdapterMap['parentNode']
type ChildNode = DefaultTreeAdapterMap['childNode']

/** Tags allowed inside an edited block (the others are taken away, their text kept). */
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'])

/** What a block added while editing may be. */
const NEW_BLOCK_TAGS = new Set(['p', 'li', 'h2', 'h3', 'h4', 'ul', 'ol'])

/** The items of a new list, one per line: only <li>, each cleaned like a block. */
export function sanitizeList(html: string, indent: string): string {
  const items = parseFragment(html).childNodes.filter((n): n is Element => isElement(n) && n.tagName === 'li')
  return items.map((li) => `\n${indent}<li>${sanitizeInline(serialize(li))}</li>`).join('')
}

/**
 * The inner HTML of an edited block, made safe to write: inline tags only (others are unwrapped,
 * scripts and styles dropped), no on…="" handlers, no javascript: links. Other attributes
 * (class, style, title…) are kept, so a block's own look is not lost by editing it.
 */
export function sanitizeInline(html: string): string {
  const fragment = parseFragment(html)
  const clean = (parent: ParentNode): void => {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const node = parent.childNodes[i] as ChildNode
      if (node.nodeName === '#comment') {
        parent.childNodes.splice(i--, 1)
        continue
      }
      if (!isElement(node)) continue
      const tag = node.tagName
      if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        parent.childNodes.splice(i--, 1)
        continue
      }
      if (!INLINE_TAGS.has(tag)) {
        // Keep the text, lose the tag.
        const kids = node.childNodes
        for (const k of kids) k.parentNode = parent
        parent.childNodes.splice(i, 1, ...kids)
        i--
        continue
      }
      node.attrs = node.attrs.filter((a) => {
        const name = a.name.toLowerCase()
        if (name.startsWith('on')) return false
        if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction') {
          const v = a.value.replace(/[\u0000-\u0020]/g, '').toLowerCase()
          if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false
          if (v.startsWith('data:') && !(tag === 'img' && name === 'src' && v.startsWith('data:image/'))) return false
        }
        return true
      })
      clean(node)
      // Formatting left empty (bold switched off, then Enter) is not written.
      if (node.childNodes.length === 0 && !['br', 'img', 'wbr'].includes(tag) && !node.attrs.some((a) => a.name === 'id' || a.name === 'name')) {
        parent.childNodes.splice(i--, 1)
      }
    }
  }
  clean(fragment)
  return serialize(fragment)
}

export function applyHtmlEdits(source: string, edits: HtmlBlockEdit[]): string {
  // parse5 reports offsets into the text it parsed; keep a byte-order mark out of the way.
  const bom = source.startsWith('﻿') ? '﻿' : ''
  const text = bom ? source.slice(1) : source
  const doc = parse(text, { sourceCodeLocationInfo: true })
  const html = doc.childNodes.find(isElement)
  if (!html) throw new HtmlEditError(t('File HTML không có thẻ <html>.'))

  const ranges = edits.map((edit) => {
    let node: Element = html
    for (const index of edit.path) {
      const child = node.childNodes.filter(isElement)[index]
      if (!child) throw new HtmlEditError(t('Không tìm thấy đoạn văn đã sửa trong file. File có thể vừa bị thay đổi.'))
      node = child
    }
    if (node.tagName !== edit.tag) {
      throw new HtmlEditError(t('Đoạn văn đã sửa không khớp với file (<{0}> ≠ <{1}>). Hãy sửa trong raw.', { 0: edit.tag, 1: node.tagName }))
    }
    const loc = node.sourceCodeLocation
    if (!loc?.startTag || !loc.endTag) {
      throw new HtmlEditError(t('Thẻ <{0}> trong file không có thẻ đóng nên không sửa trực tiếp được. Hãy sửa đoạn này trong raw.', { 0: edit.tag }))
    }
    const out = [{ start: loc.startTag.endOffset, end: loc.endTag.startOffset, html: sanitizeInline(edit.html) }]
    if (edit.after?.length) {
      // New paragraphs / list items right after this block, on their own lines, indented like it.
      const lineStart = text.lastIndexOf('\n', loc.startTag.startOffset - 1) + 1
      const lead = text.slice(lineStart, loc.startTag.startOffset)
      const indent = /^[ \t]*$/.test(lead) ? lead : ''
      const html = edit.after
        .map((b) => {
          if (!NEW_BLOCK_TAGS.has(b.tag)) throw new HtmlEditError(t('Không thêm được đoạn <{0}>.', { 0: String(b.tag) }))
          if (b.tag === 'ul' || b.tag === 'ol') return `\n${indent}<${b.tag}>${sanitizeList(b.html, `${indent}  `)}\n${indent}</${b.tag}>`
          return `\n${indent}<${b.tag}>${sanitizeInline(b.html)}</${b.tag}>`
        })
        .join('')
      out.push({ start: loc.endTag.endOffset, end: loc.endTag.endOffset, html })
    }
    return out
  }).flat()

  // Replace from the end of the file backwards so earlier offsets stay valid.
  ranges.sort((a, b) => b.start - a.start)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].end > ranges[i - 1].start) throw new HtmlEditError(t('Các đoạn sửa chồng lên nhau.'))
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
  [data-sd-block][data-sd-dirty], [data-sd-new] { box-shadow: inset 3px 0 0 rgba(47, 93, 138, .7); }
  [data-sd-new]:empty::before { content: '\\200b'; }
  [data-sd-block] img { max-width: 100%; }
  [data-sd-svg] { cursor: text; }
  [data-sd-svg]:hover { text-decoration: underline dotted rgba(180, 83, 31, .8); }
  [data-sd-svg][data-sd-dirty] { text-decoration: underline solid rgba(47, 93, 138, .9); }
  input[data-studydocs] { position: fixed; z-index: 2147483647; font: 14px system-ui, sans-serif; padding: 2px 6px;
    border: 2px solid rgba(180, 83, 31, .9); border-radius: 4px; background: #fff; color: #111; box-shadow: 0 4px 14px rgba(0, 0, 0, .25); }
</style>
<script nonce="${nonce}" data-studydocs>
(() => {
  const HTML_NS = 'http://www.w3.org/1999/xhtml'
  const INLINE = new Set(['A','ABBR','B','BDI','BDO','BR','CITE','CODE','DATA','DEL','DFN','EM','I','IMG','INS','KBD','MARK','Q','S','SAMP','SMALL','SPAN','STRONG','SUB','SUP','TIME','U','VAR','WBR'])
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

  // Text in SVG diagrams (issue #26): <text>/<tspan> that hold only text. SVG can't be
  // contenteditable, so clicking one opens a small text box over it. Only the text between
  // its tags is written back; spaces/newlines around it in the file are kept.
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const svgTexts = [...document.querySelectorAll('svg text, svg tspan')]
    .filter((el) => el.namespaceURI === SVG_NS && el.children.length === 0 && el.textContent.trim() && !el.closest('[data-studydocs]'))
    .map((el) => {
      const [, lead, , trail] = /^(\\s*)([\\s\\S]*?)(\\s*)$/.exec(el.textContent)
      return { el, path: pathOf(el), tag: el.tagName, original: el.textContent, lead, trail }
    })
  const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const send = (msg) => parent.postMessage({ source: 'studydocs', ...msg }, '*')

  // Ctrl+F while editing: the same finder as when reading. It only paints the matches, the
  // page's content is not touched.
  const anchoring = ${anchoringSource()}
  let found = []
  let foundIndex = 0
  const showFound = () => {
    anchoring.showFind(document, found, foundIndex)
    const current = found[foundIndex]
    if (current) {
      const r = current.getBoundingClientRect()
      if (r.top < 60 || r.bottom > innerHeight - 40) scrollBy({ top: r.top - innerHeight / 3, behavior: 'instant' })
    }
    send({ type: 'find-result', index: foundIndex, total: found.length })
  }
  // Paragraphs and list items started with Enter (not in the file yet). Left empty, they are not saved.
  const added = []
  const kept = (el) => el.isConnected && (el.textContent.trim() !== '' || !!el.querySelector('img'))
  const dirtyCount = () =>
    blocks.filter((b) => b.el.innerHTML !== b.original).length + svgTexts.filter((t) => t.el.textContent !== t.original).length + added.filter(kept).length

  let box = null
  const openBox = (t) => {
    if (box) box.blur()
    const r = t.el.getBoundingClientRect()
    const input = document.createElement('input')
    input.setAttribute('data-studydocs', '')
    input.value = t.el.textContent.trim()
    input.style.left = Math.max(4, r.left - 6) + 'px'
    input.style.top = Math.max(4, r.top + r.height / 2 - 15) + 'px'
    input.style.width = Math.max(140, r.width + 40) + 'px'
    let done = false
    const finish = (keep) => {
      if (done) return
      done = true
      if (keep && input.value.trim() !== t.el.textContent.trim()) {
        t.el.textContent = t.lead + input.value.trim() + t.trail
        t.el.toggleAttribute('data-sd-dirty', t.el.textContent !== t.original)
        send({ type: 'dirty', count: dirtyCount() })
      }
      input.remove()
      if (box === input) box = null
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true) }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) }
    })
    input.addEventListener('blur', () => finish(true))
    document.body.appendChild(input)
    box = input
    input.focus()
    input.select()
  }
  for (const t of svgTexts) {
    t.el.setAttribute('data-sd-svg', '')
    t.el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openBox(t) })
  }

  // What may happen inside a block: typing, deleting, line breaks (Shift+Enter), bold, italic,
  // underline, strike, links, undo. Pasting is handled below (plain text or a picture).
  const ALLOWED = new Set(['insertText','insertReplacementText','insertCompositionText','insertLineBreak','insertLink','deleteContentBackward','deleteContentForward','deleteContent','deleteWordBackward','deleteWordForward','deleteSoftLineBackward','deleteSoftLineForward','deleteHardLineBackward','deleteHardLineForward','deleteByCut','historyUndo','historyRedo','formatBold','formatItalic','formatUnderline','formatStrikeThrough','formatRemove'])
  const SPLITS = new Set(['P','LI','H1','H2','H3','H4','H5','H6'])
  const changed = () => {
    for (const b of blocks) b.el.toggleAttribute('data-sd-dirty', b.el.innerHTML !== b.original)
    send({ type: 'dirty', count: dirtyCount() })
  }
  const caretAtStart = (el) => {
    const sel = getSelection()
    if (!sel.rangeCount || !sel.isCollapsed) return false
    const r = document.createRange()
    r.selectNodeContents(el)
    r.setEnd(sel.anchorNode, sel.anchorOffset)
    return r.toString() === '' && !r.cloneContents().querySelector('img')
  }
  const placeCaret = (el, atEnd) => {
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(!atEnd)
    getSelection().removeAllRanges()
    getSelection().addRange(r)
  }
  // The last place the caret was in a block, for the app's toolbar (which takes the focus).
  let lastRange = null
  const blockOf = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement)
    return el ? el.closest('[data-sd-block]') : null
  }
  document.addEventListener('selectionchange', () => {
    const sel = getSelection()
    if (sel.rangeCount && blockOf(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange()
  })
  const restore = () => {
    const el = lastRange && blockOf(lastRange.startContainer)
    if (!el || !el.isConnected) return null
    el.focus()
    getSelection().removeAllRanges()
    getSelection().addRange(lastRange)
    return el
  }
  const insertNode = (node) => {
    const el = restore()
    if (!el) return
    const r = getSelection().getRangeAt(0)
    r.deleteContents()
    // A picture is never put inside a link: right after it instead.
    const at = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement
    const link = at && at.closest('a')
    if (link && el.contains(link)) {
      r.setStartAfter(link)
      r.collapse(true)
    }
    r.insertNode(node)
    r.setStartAfter(node)
    r.collapse(true)
    getSelection().removeAllRanges()
    getSelection().addRange(r)
    changed()
  }
  // Pictures are prepared by the app (shrunk, embedded or saved in assets/); it answers with the src.
  const pendingImages = new Map()
  let nextImage = 1
  const askImage = (file) => {
    const id = nextImage++
    pendingImages.set(id, lastRange ? lastRange.cloneRange() : null)
    send({ type: 'image', id, file })
  }

  const wire = (el, isNew) => {
    el.setAttribute('data-sd-block', '')
    if (isNew) el.setAttribute('data-sd-new', '')
    el.contentEditable = 'true'
    el.spellcheck = false
    el.addEventListener('beforeinput', (e) => {
      if (!ALLOWED.has(e.inputType)) e.preventDefault()
    })
    el.addEventListener('paste', (e) => {
      e.preventDefault()
      const items = e.clipboardData ? [...e.clipboardData.items] : []
      const image = items.find((i) => i.kind === 'file' && i.type.indexOf('image/') === 0)
      if (image) {
        lastRange = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : lastRange
        askImage(image.getAsFile())
        return
      }
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''
      // One block = one paragraph: line breaks in pasted text become spaces.
      document.execCommand('insertText', false, text.split(String.fromCharCode(13)).join('').split(String.fromCharCode(10)).join(' '))
    })
    el.addEventListener('drop', (e) => e.preventDefault())
    el.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        send({ type: 'link' })
        return
      }
      if (e.key === 'Backspace' && isNew && caretAtStart(el)) {
        // Back into the block before: this one's text joins it.
        const prev = el.previousElementSibling
        e.preventDefault()
        if (prev && prev.hasAttribute('data-sd-block')) {
          placeCaret(prev, true)
          const r = getSelection().getRangeAt(0)
          const rest = document.createRange()
          rest.selectNodeContents(el)
          r.insertNode(rest.extractContents())
          r.collapse(true)
        }
        el.remove()
        changed()
        return
      }
      if (e.key !== 'Enter' || e.shiftKey) return
      e.preventDefault()
      if (!SPLITS.has(el.tagName) || !el.parentElement) return
      // Enter on an empty item of a new list: the list ends, a paragraph follows it.
      const list = el.parentElement
      if (isNew && el.tagName === 'LI' && list.hasAttribute('data-sd-new-list') && !kept(el)) {
        const p = document.createElement('p')
        list.after(p)
        el.remove()
        wire(p, true)
        added.push(p)
        placeCaret(p, false)
        changed()
        return
      }
      // Enter: what follows the caret goes to a new paragraph (a new item in a list).
      const sel = getSelection()
      if (!sel.rangeCount) return
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const tail = document.createRange()
      tail.setStart(range.endContainer, range.endOffset)
      tail.setEnd(el, el.childNodes.length)
      const next = document.createElement(el.tagName === 'LI' ? 'li' : 'p')
      next.appendChild(tail.extractContents())
      el.after(next)
      wire(next, true)
      added.push(next)
      placeCaret(next, false)
      changed()
    })
    el.addEventListener('input', changed)
  }
  for (const b of blocks) wire(b.el, false)
  // Links inside editable text should not navigate while editing.
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) e.preventDefault() }, true)
  // Ctrl+S inside the page saves too.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); send({ type: 'save' }) }
    if (e.key === 'Escape') send({ type: 'cancel' })
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); send({ type: 'key', key: 'ctrl+f' }) }
  }, true)

  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.source !== 'studydocs-app') return
    if (e.data.type === 'find') {
      found = anchoring.findAll(document.body, e.data.query)
      foundIndex = 0
      showFound()
    }
    if (e.data.type === 'find-step' && found.length) {
      foundIndex = (foundIndex + e.data.dir + found.length) % found.length
      showFound()
    }
    if (e.data.type === 'find-clear') {
      found = []
      anchoring.showFind(document, [], 0)
    }
    if (e.data.type === 'format') {
      if (restore()) document.execCommand(e.data.cmd, false, e.data.value)
      changed()
    }
    // Paragraph type (heading, list…): only for paragraphs added while editing; the page's own
    // blocks keep their tag (changing that is a layout change, for Raw).
    if (e.data.type === 'block') {
      const el = restore()
      if (!el) return
      const inNewList = el.tagName === 'LI' && el.parentElement.hasAttribute('data-sd-new-list')
      if (!el.hasAttribute('data-sd-new') || (el.tagName === 'LI' && !inNewList)) {
        send({ type: 'block-refused' })
        return
      }
      const tag = e.data.tag
      const toList = tag === 'ul' || tag === 'ol'
      if (inNewList && toList) {
        // Bullets <-> numbers: the whole new list changes.
        const old = el.parentElement
        const list = document.createElement(tag)
        list.setAttribute('data-sd-new-list', '')
        while (old.firstChild) list.appendChild(old.firstChild)
        old.replaceWith(list)
        added.push(list)
        placeCaret(el, true)
        changed()
        return
      }
      let next
      if (toList) {
        next = document.createElement(tag)
        next.setAttribute('data-sd-new-list', '')
        const li = document.createElement('li')
        while (el.firstChild) li.appendChild(el.firstChild)
        next.appendChild(li)
        wire(li, true)
        added.push(li)
      } else {
        next = document.createElement(tag)
        while (el.firstChild) next.appendChild(el.firstChild)
        wire(next, true)
      }
      if (inNewList) {
        // One item becomes a paragraph or heading: it leaves the list, right after it.
        const list = el.parentElement
        list.after(next)
        el.remove()
        if (!list.children.length) list.remove()
      } else {
        el.replaceWith(next)
      }
      added.push(next)
      placeCaret(toList ? next.firstChild : next, true)
      changed()
    }
    if (e.data.type === 'insert-image' && e.data.src) {
      const img = document.createElement('img')
      img.src = e.data.src
      img.alt = ''
      insertNode(img)
    }
    if (e.data.type === 'image-src') {
      const range = pendingImages.get(e.data.id)
      pendingImages.delete(e.data.id)
      if (e.data.src) {
        if (range) lastRange = range
        const img = document.createElement('img')
        img.src = e.data.src
        img.alt = ''
        insertNode(img)
      }
    }
    if (e.data.type === 'collect') {
      if (box) box.blur() // a text box still open counts too
      // Chrome puts no-break spaces next to formatting it just typed ("<b>a</b>&nbsp;b");
      // between two words they are plain spaces. Blocks that had them on purpose keep them.
      const fixSpaces = (html) => {
        const parts = html.split('&nbsp;')
        let out = parts[0]
        for (let i = 1; i < parts.length; i++) {
          const before = out.slice(-1)
          const after = parts[i].slice(0, 1)
          out += (before && after && before !== ' ' && after !== ' ' ? ' ' : '&nbsp;') + parts[i]
        }
        return out
      }
      const htmlOf = (b) => (b.original.indexOf('&nbsp;') >= 0 ? b.el.innerHTML : fixSpaces(b.el.innerHTML))
      const edits = blocks.filter((b) => b.el.innerHTML !== b.original).map((b) => ({ path: b.path, tag: b.tag, html: htmlOf(b) }))
      // New paragraphs, headings and lists belong after the nearest block of the file before them.
      const isNewNode = (n) => n.hasAttribute('data-sd-new') || n.hasAttribute('data-sd-new-list')
      const tops = [...new Set(added)].filter((el) => el.isConnected && !el.parentElement.hasAttribute('data-sd-new-list'))
      tops.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      for (const el of tops) {
        const list = el.hasAttribute('data-sd-new-list')
        const items = list ? [...el.children].filter((li) => kept(li)) : []
        if (list ? !items.length : !kept(el)) continue
        let anchor = el.previousElementSibling
        while (anchor && isNewNode(anchor)) anchor = anchor.previousElementSibling
        const b = blocks.find((x) => x.el === anchor)
        if (!b) continue
        let edit = edits.find((x) => x.path === b.path)
        if (!edit) edits.push((edit = { path: b.path, tag: b.tag, html: b.el.innerHTML }))
        const html = list ? items.map((li) => '<li>' + fixSpaces(li.innerHTML) + '</li>').join('') : fixSpaces(el.innerHTML)
        ;(edit.after = edit.after || []).push({ tag: el.tagName.toLowerCase(), html })
      }
      for (const t of svgTexts) {
        if (t.el.textContent !== t.original) edits.push({ path: t.path, tag: t.tag, html: escapeText(t.el.textContent) })
      }
      send({ type: 'edits', id: e.data.id, edits })
    }
  })
  send({ type: 'ready', blocks: blocks.length + svgTexts.length })
})()
</script>`
}
