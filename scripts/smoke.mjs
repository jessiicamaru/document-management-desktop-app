// Smoke test: opens the built app on a temporary copy of sample-library/, clicks through it,
// checks the results and saves screenshots to scripts/. Exits with code 1 if any check fails.
// Uses its own settings folder, so your real settings and documents are never touched.
// Run with: npm run smoke
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const workDir = mkdtempSync(path.join(tmpdir(), 'studydocs-smoke-'))
const library = path.join(workDir, 'library')
const userData = path.join(workDir, 'userdata')
cpSync(path.join(projectRoot, 'sample-library'), library, {
  recursive: true,
  filter: (src) => !path.basename(src).startsWith('.docs-meta')
})
// A second folder, so the whole test runs on a multi-folder workspace (think D:\Học + C:\notes).
const notes = path.join(workDir, 'notes')
mkdirSync(path.join(notes, 'devops'), { recursive: true })
writeFileSync(path.join(notes, 'devops', 'Docker cơ bản.md'), '# Docker cơ bản\n\nContainer chạy một tiến trình cô lập.\n')
// Files for the safety checks (issues #1, #2, #3).
const ATTACK = 'backend/Tài liệu lạ.html'
writeFileSync(
  path.join(library, 'backend', 'Tài liệu lạ.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>Tài liệu lạ</title></head><body><h1>Tài liệu lạ</h1>
<p>Bài này thử làm những việc không được phép.</p>
<script>
  const params = new URLSearchParams(location.search)
  // #2: try to read other files of the workspace
  ;(async () => {
    const out = []
    for (const u of ['../.docs-meta.json', '../frontend/React%20useEffect.md']) {
      try {
        const r = await fetch(u)
        out.push(r.ok ? 'READ' : 'status' + r.status)
      } catch {
        out.push('blocked')
      }
    }
    document.body.dataset.result = out.join(',')
  })()
  // #1: open another file without anyone clicking
  const act = () => {
    if (location.hash === '#run-py') location = 'tool.py'
    if (location.hash === '#run-txt') location = 'readme.txt'
  }
  act()
  addEventListener('hashchange', act)
</script></body></html>`
)
writeFileSync(path.join(library, 'backend', 'tool.py'), 'print("this must never run")\n')
writeFileSync(path.join(library, 'backend', 'readme.txt'), 'plain text\n')
const CRLF = 'frontend/Windows note.md'
writeFileSync(path.join(library, 'frontend', 'Windows note.md'), '# Windows note\r\n\r\nDòng một.\r\nDòng hai.\r\n')
const file = (rel) => path.join(library, rel)
const read = (rel) => readFileSync(file(rel), 'utf8')
const metaFile = file('.docs-meta.json')
const shot = (name) => path.join(here, `${name}.png`)

const ES = 'backend/Event Sourcing.html'
const ROADMAP = 'backend/Lộ trình Backend.html'
const REACT = 'frontend/React useEffect.md'

let failures = 0
/** Prints the step name, so a timeout shows where it happened. */
const step = (name) => console.log(`
# ${name}`)
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

// Start from a corrupt meta file, like after a bad sync conflict.
writeFileSync(metaFile, '{ "version": 1, "docs": { <<<<<<< HEAD')

const app = await electron.launch({
  executablePath: electronPath,
  // Keep drawing even when the test window is covered by other windows: Windows/Chromium
  // stop painting hidden windows, and screenshots then wait forever (issue #16).
  args: ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', projectRoot],
  env: { ...process.env, STUDYDOCS_DEBUG: '1', DOCS_LIBRARY: [library, notes].join(path.delimiter), STUDYDOCS_USER_DATA: userData }
})
const errors = []
let mainLog = ''
app.process().stdout?.on('data', (d) => (mainLog += d))
app.process().stderr?.on('data', (d) => (mainLog += d))
const page = await app.firstWindow()
// Errors of the app itself. Messages from inside documents (doc://...) don't count: the test
// library has a page that deliberately tries forbidden things, and those must fail.
page.on('console', (m) => m.type() === 'error' && !m.location().url.startsWith('doc://') && !/doc:\/\/library\//.test(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
let dialogAnswer = 'dismiss'
// A dialog may already be gone when Playwright answers it; that must not crash the test.
page.on('dialog', (d) => void (dialogAnswer === 'accept' ? d.accept() : d.dismiss()).catch(() => {}))
await page.setViewportSize({ width: 1320, height: 860 })
await page.emulateMedia({ colorScheme: null }) // Playwright forces "light" by default; let the app decide

const openDoc = (title) => page.click(`.doc-list .row.doc >> text=${title}`)
const docPathIs = (p) => page.waitForSelector(`.doc-path:text-is("${p}")`, { timeout: 5000 })
const editBarGone = () => page.waitForSelector('.edit-bar', { state: 'detached', timeout: 5000 })

try {
  await page.waitForSelector('.sidebar')

  // 1. Corrupt meta file: backed up and reported, not silently dropped.
  step("1. Corrupt meta file: backed up and reported, not silently dropped.")
  await page.waitForSelector('.banner:has-text("đã được sao lưu thành")')
  check(true, 'corrupt meta file shows a warning')
  check(readdirSync(library).some((f) => f.startsWith('.docs-meta.corrupt-')), 'corrupt meta file was backed up')
  check((await page.locator('.banner:has-text("Khôi phục…")').count()) === 1, 'a banner offers to recover the backup (issue #25)')
  await page.click('.banner:has-text("đã được sao lưu thành") button[aria-label="Ẩn cảnh báo"]')

  // 1b. Two folders in one workspace: each is a top-level node in the tree.
  step("1b. Two folders in one workspace: each is a top-level node in the tree.")
  const rootNames = await page.locator('.root-row .row.root .row-title').allTextContents()
  check(rootNames.join('|') === 'library|notes', `both folders shown as roots (${rootNames.join(', ')})`)
  check((await page.textContent('.library-name')).includes('2 thư mục'), 'header says the workspace has 2 folders')
  await page.fill('.search input', 'container')
  await page.waitForSelector('.hit')
  check((await page.textContent('.hit .hit-path')) === 'notes / devops', 'search finds docs in the second folder, with its name')
  await page.click('.hit')
  await docPathIs('devops/Docker cơ bản.md')
  check((await page.textContent('.doc-root')) === 'notes', 'doc header shows which folder the doc is in')
  await page.fill('.search input', '')
  await page.fill('.tag-editor input', 'devops')
  await page.press('.tag-editor input', 'Enter')
  await page.waitForTimeout(300)
  const notesMeta = JSON.parse(readFileSync(path.join(notes, '.docs-meta.json'), 'utf8')).docs
  check(notesMeta['devops/Docker cơ bản.md']?.tags?.[0] === 'devops', "tags are stored in that folder's own .docs-meta.json")
  await page.screenshot({ path: shot('0-two-folders') })

  // 2. HTML document renders in the sandboxed iframe.
  step("2. HTML document renders in the sandboxed iframe.")
  await openDoc('Event Sourcing — Bài học để chép vào vở')
  const frame = page.frameLocator('iframe.html-frame')
  await frame.locator('h1').waitFor()
  check((await frame.locator('h1').textContent()) === 'Event Sourcing', 'HTML doc renders')
  check((await frame.locator('figure svg').count()) === 7, 'all 7 diagrams render')
  await page.screenshot({ path: shot('1-html-doc') })

  // 3. Status + tag are saved; two writes at the same time both survive.
  step("3. Status + tag are saved; two writes at the same time both survive.")
  await page.click('.segmented >> text=Đang học')
  await page.fill('.tag-editor input', 'backend')
  await page.press('.tag-editor input', 'Enter')
  await page.evaluate(async (rel) => {
    // Documents are addressed by workspace id "<folder key>/<path>".
    const id = (await window.api.getLibrary()).docs.find((d) => d.rel === rel).path
    await Promise.all([window.api.updateMeta(id, { status: 'review' }), window.api.updateMeta(id, { tags: ['react'] })])
  }, REACT)
  const saved = JSON.parse(readFileSync(metaFile, 'utf8')).docs
  check(saved[ES]?.status === 'learning' && saved[ES]?.tags?.includes('backend'), 'status and tag saved')
  check(saved[REACT]?.status === 'review' && saved[REACT]?.tags?.[0] === 'react', 'concurrent writes both kept')
  check(!JSON.stringify(saved).includes('lastOpened'), '"recently opened" is not written into the library')

  // 4. Links inside HTML switch the whole app to the target doc, including #hash.
  step("4. Links inside HTML switch the whole app to the target doc, including #hash.")
  await openDoc('Lộ trình Backend')
  await page.frameLocator('iframe.html-frame').locator('#link-concurrency').click()
  await docPathIs(ES)
  check((await page.getAttribute('iframe.html-frame', 'src')).endsWith('#s7'), 'HTML link opens the target doc at #s7')
  await openDoc('Lộ trình Backend')
  await page.frameLocator('iframe.html-frame').locator('#link-react').click()
  await docPathIs(REACT)
  check(true, 'HTML link opens a Markdown doc')

  // 5. Markdown with Mermaid, in-doc anchor and cross-doc link.
  step("5. Markdown with Mermaid, in-doc anchor and cross-doc link.")
  await page.waitForSelector('.markdown pre.mermaid svg g.node', { timeout: 15000 })
  check(true, 'Mermaid diagram renders')
  await page.click('.markdown a[href="#bang-tom-tat"]')
  await page.waitForTimeout(800)
  check((await page.evaluate(() => document.querySelector('.md-scroll').scrollTop)) > 100, 'in-doc #anchor scrolls')
  await page.click('.markdown >> text=Event Sourcing')
  await docPathIs(ES)
  check(true, 'Markdown link opens another doc')

  // 6. Search, filters.
  step("6. Search, filters.")
  await page.fill('.search input', 'su kien')
  await page.waitForSelector('.hit')
  check((await page.textContent('.hit mark')) === 'sự kiện', 'search "su kien" highlights "sự kiện"')
  await page.fill('.search input', '')
  await page.click('.filters >> text=Đang học')
  check((await page.locator('.doc-list .row.doc').count()) === 1, 'status filter')
  await page.click('.filters >> text=Tất cả')

  // 7. Recently opened lives in a popover (Ctrl+E), not in the sidebar list.
  step("7. Recently opened lives in a popover (Ctrl+E), not in the sidebar list.")
  check((await page.locator('.doc-list >> text=Mở gần đây').count()) === 0, 'sidebar has no "recently opened" block')
  await page.keyboard.press('Control+E')
  await page.waitForSelector('.recent-popover')
  check((await page.locator('.recent-popover .row.doc').count()) >= 3, 'Ctrl+E shows recently opened docs')
  await page.screenshot({ path: shot('2-recent-popover') })
  await page.keyboard.press('Escape')
  check((await page.locator('.recent-popover').count()) === 0, 'Escape closes the popover')

  // 8. Settings: dark mode, accent colour, reading size; saved to the settings file.
  step("8. Settings: dark mode, accent colour, reading size; saved to the settings file.")
  await page.click('.sidebar-head .icon-btn[title="Cài đặt"]')
  await page.waitForSelector('dialog.settings[open]')
  await page.click('dialog.settings >> text=Tối')
  await page.click('dialog.settings .swatch[title="Xanh ngọc"]')
  await page.fill('dialog.settings input[type=range]', '19')
  await page.waitForTimeout(600)
  check(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors), 'dark mode set for the window')
  check(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), 'dark mode applies to the page')
  check((await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent-base'))) === '#0f766e', 'accent colour applies')
  await page.screenshot({ path: shot('3-settings-dark') })
  const settings = JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'))
  check(settings.ui?.theme === 'dark' && settings.ui?.accent === '#0f766e' && settings.ui?.readingSize === 19, 'settings saved')
  await page.click('dialog.settings >> text=Xong')
  await openDoc('React useEffect — khi nào chạy?')
  await page.waitForSelector('.markdown pre.mermaid svg g.node', { timeout: 15000 })
  check((await page.evaluate(() => getComputedStyle(document.querySelector('.markdown')).fontSize)) === '19px', 'reading size applies to Markdown')
  await page.screenshot({ path: shot('4-markdown-dark') })
  await page.click('.sidebar-head .icon-btn[title="Cài đặt"]')
  await page.click('dialog.settings >> text=Khôi phục mặc định')
  await page.click('dialog.settings >> text=Xong')
  await page.waitForTimeout(400)
  check((await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)) === 'system', 'settings reset to default')

  // 9. Inline text edit in Markdown: only the typed text changes in the file.
  step("9. Inline text edit in Markdown: only the typed text changes in the file.")
  const mdBefore = read(REACT)
  await page.click('.doc-controls >> text=Sửa chữ')
  await page.waitForSelector('.markdown.editing')
  await page.click('.markdown p >> text=Mảng phụ thuộc quyết định')
  await page.keyboard.press('End')
  await page.keyboard.type(' Rất quan trọng!')
  await page.click('.markdown td >> text=chỉ một lần sau lần render đầu')
  await page.keyboard.press('End')
  await page.keyboard.type(' tiên')
  await page.screenshot({ path: shot('5-md-inline-edit') })
  await page.keyboard.press('Control+S')
  await editBarGone()
  await page.waitForTimeout(500)
  const mdAfter = read(REACT)
  check(
    mdAfter === mdBefore.replace('chạy lại lúc nào.', 'chạy lại lúc nào. Rất quan trọng!').replace('lần render đầu |', 'lần render đầu tiên |'),
    'Markdown inline edit changes only the typed text'
  )

  // 10. Inline text edit in HTML: only that element's text changes in the file.
  step("10. Inline text edit in HTML: only that element's text changes in the file.")
  const htmlBefore = read(ES)
  await openDoc('Event Sourcing — Bài học để chép vào vở')
  await page.click('.doc-controls >> text=Sửa chữ')
  const editFrame = page.frameLocator('iframe.html-frame.editing')
  await editFrame.locator('h1[data-sd-block]').waitFor()
  await editFrame.locator('h1').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' cơ bản')
  await editFrame.locator('.sub').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' Chúc học vui!')
  await page.keyboard.press('Enter') // must be ignored: no new paragraphs
  await page.screenshot({ path: shot('6-html-inline-edit') })
  await page.click('.edit-bar >> text=Lưu (Ctrl+S)')
  await editBarGone()
  await page.waitForTimeout(500)
  const htmlAfter = read(ES)
  check(
    htmlAfter === htmlBefore.replace('<h1>Event Sourcing</h1>', '<h1>Event Sourcing cơ bản</h1>').replace('lên production.</p>', 'lên production. Chúc học vui!</p>'),
    'HTML inline edit changes only the typed text (Enter ignored)'
  )
  await page.frameLocator('iframe.html-frame').locator('h1 >> text=Event Sourcing cơ bản').waitFor()
  check(true, 'HTML view reloads with the saved text')

  // 11. Unsaved changes: switching docs asks first (dismissed = stay), Esc + confirm cancels.
  step("11. Unsaved changes: switching docs asks first (dismissed = stay), Esc + confirm cancels.")
  await page.click('.doc-controls >> text=Sửa chữ')
  await page.frameLocator('iframe.html-frame.editing').locator('h1[data-sd-block]').click()
  await page.keyboard.type('XYZ')
  await page.waitForTimeout(200)
  dialogAnswer = 'dismiss'
  await openDoc('Lộ trình Backend')
  check((await page.textContent('.doc-path')) === ES, 'switching docs with unsaved edits asks and stays')
  dialogAnswer = 'accept'
  await page.click('.edit-bar >> text=Huỷ (Esc)')
  await editBarGone()
  check(read(ES) === htmlAfter, 'cancelled edit does not touch the file')

  // 12. Edit refused if the file changed on disk meanwhile.
  step("12. Edit refused if the file changed on disk meanwhile.")
  await openDoc('Lộ trình Backend')
  await page.click('.doc-controls >> text=Sửa chữ')
  await page.frameLocator('iframe.html-frame.editing').locator('h1[data-sd-block]').click()
  await page.keyboard.type('!')
  const external = read(ROADMAP).replace('Trang mẫu', 'Trang mẫu (sửa ở app khác)')
  writeFileSync(file(ROADMAP), external)
  await page.waitForTimeout(300)
  await page.click('.edit-bar >> text=Lưu (Ctrl+S)')
  await page.waitForSelector('.toast >> text=thay đổi bên ngoài', { timeout: 5000 })
  check(read(ROADMAP) === external, 'conflicting save is refused and the other change is kept')
  await page.waitForSelector('.edit-bar', { state: 'detached' })

  // 13. Raw editor: live Markdown preview, Ctrl+S saves.
  step("13. Raw editor: live Markdown preview, Ctrl+S saves.")
  await openDoc('React useEffect — khi nào chạy?')
  await page.click('.doc-controls >> text=Raw')
  await page.waitForSelector('.raw-host .cm-content')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('useEffect'))
  await page.click('.raw-host .cm-content')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\nThêm từ raw editor.')
  await page.waitForSelector('.markdown >> text=Thêm từ raw editor.', { timeout: 5000 })
  check(true, 'raw editor shows a live preview')
  await page.screenshot({ path: shot('7-raw-editor') })
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !document.querySelector('.raw-toolbar .dirty-dot'), null, { timeout: 5000 })
  check(read(REACT).trimEnd().endsWith('Thêm từ raw editor.'), 'raw editor saves with Ctrl+S')
  await page.click('.raw-toolbar >> text=Đóng raw')

  // 14. Outline panel for an HTML doc: lists the headings and jumps to one.
  step("14. Outline panel")
  await openDoc('Event Sourcing — Bài học để chép vào vở')
  await page.waitForFunction(() => document.querySelectorAll('.outline-item').length >= 12, null, { timeout: 8000 })
  check(true, 'outline lists the HTML headings')
  await page.click('.outline-item >> text=Concurrency — Optimistic')
  await page.waitForTimeout(1500)
  const esFrame = page.frames().find((fr) => fr.url().startsWith('doc://'))
  check((await esFrame.evaluate(() => scrollY)) > 1000, 'clicking an outline item scrolls the page')
  check((await page.textContent('.outline-item.active'))?.includes('Concurrency'), 'outline highlights the section being read')
  await page.screenshot({ path: shot('8-outline') })

  // 15. Reading position is remembered per document.
  step("15. Reading position")
  await openDoc('React useEffect — khi nào chạy?')
  await page.waitForSelector('.markdown h2')
  await page.evaluate(() => (document.querySelector('.md-scroll').scrollTop = 220))
  await page.waitForTimeout(600)
  await openDoc('Lộ trình Backend')
  await openDoc('React useEffect — khi nào chạy?')
  await page.waitForTimeout(1200)
  const restored = await page.evaluate(() => document.querySelector('.md-scroll').scrollTop)
  check(Math.abs(restored - 220) < 5, `reading position restored (${restored}px)`)

  // 16. Back / forward: header buttons, Alt+←/→, and Alt+← typed inside an HTML page.
  step("16. Back / forward")
  await page.click('.history-buttons .icon-btn[title^="Quay lại"]')
  await docPathIs(ROADMAP)
  await page.click('.doc-heading h1')
  await page.keyboard.press('Alt+ArrowRight')
  await docPathIs(REACT)
  await page.keyboard.press('Alt+ArrowLeft')
  await docPathIs(ROADMAP)
  check(true, 'back/forward buttons and Alt+←/→ work')
  await page.frameLocator('iframe.html-frame').locator('h1').click()
  await page.keyboard.press('Alt+ArrowLeft')
  // History: ... ES, REACT, ROADMAP, REACT; we are on ROADMAP, so back goes to REACT.
  await docPathIs(REACT)
  check(true, 'Alt+← works while the HTML page has the focus')

  // 17. Export to PDF (HTML and Markdown), in light colours even in dark mode; open the PDF in the app.
  step("17. Export PDF")
  const exportTo = async (title, target) => {
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }) // a test can't click the native dialog
    }, target)
    await openDoc(title)
    await page.click('.more > .btn')
    await page.click('.popover.menu >> text=Xuất PDF…')
    // Wait for the toast naming this file (an earlier export's toast may still be showing).
    await page.waitForSelector(`.toast.info >> text=${path.basename(target)}`, { timeout: 30000 })
  }
  await page.evaluate(async () => window.api.setUiSettings({ ...(await window.api.getUiSettings()), theme: 'dark' }))
  const esPdf = file('backend/Event Sourcing.pdf')
  const mdPdf = file('frontend/React useEffect.pdf')
  await exportTo('Event Sourcing — Bài học để chép vào vở', esPdf)
  await exportTo('React useEffect — khi nào chạy?', mdPdf)
  await page.evaluate(async () => window.api.setUiSettings({ ...(await window.api.getUiSettings()), theme: 'system' }))
  for (const [label, p] of [['HTML', esPdf], ['Markdown', mdPdf]]) {
    const bytes = readFileSync(p)
    check(bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 20000, `${label} exported to a valid PDF (${Math.round(bytes.length / 1024)} KB)`)
  }
  // The exported PDFs land in the library, so they show up in the tree.
  await page.waitForFunction(() => document.querySelectorAll('.doc-list .row.doc .kind-pdf').length === 2, null, { timeout: 5000 })
  await page.click('.doc-list .row.doc:has(.kind-pdf) >> text=React useEffect')
  await page.waitForSelector('iframe.html-frame.pdf')
  await page.waitForTimeout(2500)
  check(page.frames().some((fr) => fr.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')), 'PDF opens in the built-in viewer')
  await page.screenshot({ path: shot('9-pdf-viewer-md') })
  await page.click('.doc-list .row.doc:has(.kind-pdf) >> text=Event Sourcing')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: shot('10-pdf-viewer-html') })

  // 18a. Highlights + notes in Markdown: stored next to the doc, the doc itself untouched.
  step('18a. Highlights in Markdown')
  const notesFile = file('.docs-notes.json')
  const reactBefore = read(REACT)
  await openDoc('React useEffect — khi nào chạy?')
  await page.waitForSelector('.markdown h2')
  /** Selects `text` inside the first element matching `selector` (in the page or a frame) and releases the mouse. */
  const selectText = (target, selector, text) =>
    target.evaluate(
      async ([sel, txt]) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(txt))
        // A person selects text they can see. Let the scroll settle first: the app hides the
        // highlight toolbar while scrolling.
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        await new Promise((r) => setTimeout(r, 400))
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.data.indexOf(txt)
          if (i < 0) continue
          const range = document.createRange()
          range.setStart(n, i)
          range.setEnd(n, i + txt.length)
          const selection = getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
          return true
        }
        return false
      },
      [selector, text]
    )
  await selectText(page, '.markdown p', 'Mảng phụ thuộc')
  await page.waitForSelector('.hl-toolbar')
  await page.screenshot({ path: shot('11-highlight-toolbar') })
  await page.click('.hl-toolbar .hl-swatch[title="Highlight vàng"]')
  await page.waitForSelector('.markdown mark[data-sd-ann]')
  check((await page.textContent('.markdown mark[data-sd-ann]')) === 'Mảng phụ thuộc', 'Markdown: selected text is highlighted')
  await selectText(page, '.markdown blockquote p', 'cleanup')
  await page.click('.hl-toolbar .hl-note-btn')
  await page.waitForSelector('.note-popover textarea')
  await page.fill('.note-popover textarea', 'Nhớ: effect trả về hàm dọn dẹp.')
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('.note-popover', { state: 'detached' })
  const mdNotes = JSON.parse(readFileSync(notesFile, 'utf8')).docs[REACT]?.items ?? []
  check(mdNotes.length === 2 && mdNotes.some((a) => a.note.startsWith('Nhớ:')), 'Markdown: highlight + note saved in .docs-notes.json')
  check(read(REACT) === reactBefore, 'Markdown: the document file is not changed by highlighting')
  await page.click('.panel-tabs >> text=Ghi chú')
  await page.waitForSelector('.note-card-text >> text=Nhớ: effect trả về hàm dọn dẹp.')
  check(true, 'notes panel lists the note')
  await page.screenshot({ path: shot('12-notes-panel') })

  // 18b. A highlight is found again after the document is edited elsewhere.
  step('18b. Highlight survives an edit')
  writeFileSync(file(REACT), read(REACT).replace('# React useEffect', '# React useEffect\n\nĐoạn mới thêm vào đầu bài.'))
  await page.waitForFunction(() => document.querySelector('.markdown')?.textContent.includes('Đoạn mới thêm'), null, { timeout: 5000 })
  await page.waitForTimeout(500)
  check((await page.locator('.markdown mark[data-sd-ann]').count()) >= 2, 'highlights are found again after the file changed')

  // 18c. Highlights in an HTML page (inside the sandboxed iframe).
  step('18c. Highlights in HTML')
  await openDoc('Event Sourcing — Bài học để chép vào vở')
  await page.frameLocator('iframe.html-frame').locator('h1').waitFor()
  await page.waitForTimeout(500)
  const htmlFrame = () => page.frames().find((fr) => fr.url().startsWith('doc://') && fr.url().includes('Event%20Sourcing.html'))
  await selectText(htmlFrame(), 'p', 'append-only')
  await page.waitForSelector('.hl-toolbar')
  await page.click('.hl-toolbar .hl-swatch[title="Highlight xanh dương"]')
  await page.waitForTimeout(500)
  check((await htmlFrame().evaluate(() => document.querySelector('mark[data-sd-ann]')?.textContent)) === 'append-only', 'HTML: selected text is highlighted inside the page')
  await openDoc('Lộ trình Backend')
  await openDoc('Event Sourcing — Bài học để chép vào vở')
  await page.waitForTimeout(1500)
  check((await htmlFrame().evaluate(() => document.querySelectorAll('mark[data-sd-ann]').length)) === 1, 'HTML: highlight is drawn again when the page is reopened')

  // 18d. Export with highlights and notes.
  step('18d. Export PDF with notes')
  const notesPdf = file('frontend/React useEffect (ghi chú).pdf')
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  }, notesPdf)
  await openDoc('React useEffect — khi nào chạy?')
  await page.click('.more > .btn')
  await page.click('.popover.menu >> text=Xuất PDF kèm highlight và ghi chú…')
  await page.waitForSelector('.toast.info >> text=React useEffect (ghi chú).pdf', { timeout: 30000 })
  const notesBytes = readFileSync(notesPdf)
  check(notesBytes.subarray(0, 5).toString() === '%PDF-', `PDF with notes exported (${Math.round(notesBytes.length / 1024)} KB)`)
  await page.waitForFunction(() => document.querySelectorAll('.doc-list .row.doc .kind-pdf').length === 3, null, { timeout: 5000 })
  await page.click('.doc-list .row.doc:has(.kind-pdf) >> text=React useEffect (ghi chú)')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: shot('13-pdf-with-notes') })

  // 18e. EPUB books: chapters in the outline, search inside the book, highlights.
  step('18e. EPUB')
  await page.fill('.search input', 'pull truoc khi push')
  await page.waitForSelector('.hit')
  check((await page.textContent('.hit .hit-title')).includes('Git cơ bản'), 'search finds text inside an EPUB book')
  await page.click('.hit')
  await page.fill('.search input', '')
  await page.click('.panel-tabs >> text=Mục lục') // the panel remembers the last tab (Ghi chú, from 18a)
  await page.waitForFunction(() => document.querySelectorAll('.outline-item').length === 3, null, { timeout: 10000 })
  check(true, 'EPUB chapters are listed in the outline')
  const bookFrame = () => page.frames().find((fr) => fr.url() === 'about:srcdoc')
  await page.waitForTimeout(800)
  check((await bookFrame().evaluate(() => document.body.textContent)).includes('Git là gì?'), 'EPUB: first chapter is shown')
  await page.click('.outline-item >> text=Chương 3')
  await page.waitForTimeout(1200)
  check((await bookFrame().evaluate(() => document.body.textContent)).includes('pull trước khi push'), 'EPUB: outline jumps to a chapter')
  await bookFrame().evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((e) => e.textContent.includes('Quy tắc vàng'))
    const range = document.createRange()
    range.selectNodeContents(p.querySelector('strong'))
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await page.waitForSelector('.hl-toolbar', { timeout: 5000 })
  await page.click('.hl-toolbar .hl-swatch[title="Highlight xanh lá"]')
  await page.waitForTimeout(800)
  const bookNotes = JSON.parse(readFileSync(notesFile, 'utf8')).docs['sach/Git cơ bản.epub']?.items ?? []
  check(bookNotes.length === 1 && bookNotes[0].cfi?.startsWith('epubcfi(') && bookNotes[0].quote === 'pull trước khi push', 'EPUB: highlight saved with its position in the book')
  await page.screenshot({ path: shot('14-epub') })

  // 19. Issue #1: a page can't open programs, and asks before opening other files.
  step('19. Safety: opening files from a page')
  await app.evaluate(({ shell, dialog }) => {
    // Keep the real functions: window.confirm() in the UI also goes through showMessageBox.
    globalThis.__real = { openPath: shell.openPath, showItemInFolder: shell.showItemInFolder, showMessageBox: dialog.showMessageBox }
    globalThis.__opened = []
    globalThis.__revealed = []
    globalThis.__asked = 0
    shell.openPath = async (p) => (globalThis.__opened.push(p), '')
    shell.showItemInFolder = (p) => globalThis.__revealed.push(p)
    dialog.showMessageBox = async () => (globalThis.__asked++, { response: 1 }) // answer "Không"
  })
  const attackId = await page.evaluate(async (rel) => (await window.api.getLibrary()).docs.find((d) => d.rel === rel).path, ATTACK)
  await page.evaluate((id) => window.api.markOpened(id), attackId)
  await openDoc('Tài liệu lạ')
  await page.waitForTimeout(800)
  const runInPage = (hash) =>
    page.frames().find((fr) => fr.url().includes('T%C3%A0i%20li%E1%BB%87u%20l%E1%BA%A1.html')).evaluate((h) => (location.hash = h), hash)
  await runInPage('#run-py')
  await page.waitForTimeout(800)
  const afterPy = await app.evaluate(() => ({ opened: globalThis.__opened.length, revealed: globalThis.__revealed.length }))
  check(afterPy.opened === 0 && afterPy.revealed === 1, 'a page navigating to a .py file only shows it in Explorer, never runs it')
  await openDoc('Tài liệu lạ')
  await page.waitForTimeout(800)
  await runInPage('#run-txt')
  await page.waitForTimeout(800)
  const afterTxt = await app.evaluate(() => ({ opened: globalThis.__opened.length, asked: globalThis.__asked }))
  check(afterTxt.asked === 1 && afterTxt.opened === 0, 'a page opening a .txt file asks first (answered "Không": nothing opened)')
  await app.evaluate(({ shell, dialog }) => {
    Object.assign(shell, { openPath: globalThis.__real.openPath, showItemInFolder: globalThis.__real.showItemInFolder })
    dialog.showMessageBox = globalThis.__real.showMessageBox
  })

  // 20. Issue #2: when exporting to PDF the page can't read other files; hidden files are never served.
  step('20. Safety: export window and hidden files')
  const readIn = (url) =>
    app.evaluate(async ({ BrowserWindow }, u) => {
      const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await w.loadURL(u)
        await new Promise((r) => setTimeout(r, 1500))
        return await w.webContents.executeJavaScript('document.body.dataset.result || ""')
      } finally {
        w.destroy()
      }
    }, url)
  const attackUrl = 'doc://library/' + attackId.split('/').map(encodeURIComponent).join('/')
  check((await readIn(attackUrl + '?print=1')) === 'blocked,blocked', 'export window: the page cannot fetch other files')
  check((await readIn(attackUrl)).startsWith('status404'), 'hidden files (.docs-meta.json) are never served')

  // 21. Issue #3: the raw editor keeps CRLF line endings and doesn't rewrite an unchanged file.
  step('21. Raw editor keeps CRLF')
  const crlfBefore = readFileSync(file(CRLF), 'utf8')
  const mtimeBefore = (await import('node:fs')).statSync(file(CRLF)).mtimeMs
  await openDoc('Windows note')
  await page.click('.doc-controls >> text=Raw')
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent.includes('Dòng hai'))
  await page.click('.raw-host .cm-content')
  await page.keyboard.press('Control+S')
  await page.waitForTimeout(600)
  check((await import('node:fs')).statSync(file(CRLF)).mtimeMs === mtimeBefore, 'Ctrl+S without changes does not rewrite the file')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('x')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(300)
  check((await page.locator('.raw-toolbar .dirty-dot').count()) === 0, 'typing then deleting a character is not "unsaved"')
  await page.keyboard.type('Dòng ba.')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !document.querySelector('.raw-toolbar .dirty-dot'), null, { timeout: 5000 })
  const crlfAfter = readFileSync(file(CRLF), 'utf8')
  check(
    crlfAfter.startsWith(crlfBefore) && crlfAfter.includes('Dòng ba.\r\n') && !/[^\r]\n/.test(crlfAfter),
    'saving keeps CRLF line endings everywhere'
  )
  await page.click('.raw-toolbar >> text=Đóng raw')

  // 22. Issue #17: Ctrl+F in Markdown, HTML (inside the page) and EPUB (whole book).
  step('22. Find in document')
  const findCount = async () => (await page.textContent('.find-count'))?.trim()
  const typeFind = async (q) => {
    await page.keyboard.press('Control+F')
    await page.waitForSelector('.find-bar input')
    await page.fill('.find-bar input', q)
    await page.waitForFunction(() => /\d+\/\d+|Không thấy/.test(document.querySelector('.find-count')?.textContent ?? ''), null, { timeout: 15000 })
  }
  await openDoc('React useEffect — khi nào chạy?')
  await page.waitForSelector('.markdown h2')
  await page.click('.doc-heading h1')
  await typeFind('effect')
  const mdCount = await findCount()
  await page.press('.find-bar input', 'Enter')
  check(/^1\/([2-9]|\d{2,})$/.test(mdCount) && (await findCount()) === '2/' + mdCount.split('/')[1], `Markdown: Ctrl+F finds and steps through matches (${mdCount})`)
  await page.press('.find-bar input', 'Escape')
  check((await page.locator('.find-bar').count()) === 0, 'Escape closes the find bar')

  // Issue #18: coloured code and KaTeX formulas (with their fonts) in Markdown.
  const mdLook = await page.evaluate(async () => {
    await document.fonts.ready
    const kw = document.querySelector('.markdown pre .hljs-keyword')
    return {
      keyword: kw ? getComputedStyle(kw).color : null,
      inline: document.querySelectorAll('.markdown .katex').length,
      display: document.querySelectorAll('.markdown .katex-display').length,
      errors: document.querySelectorAll('.markdown .katex-error').length,
      font: document.fonts.check('16px KaTeX_Main')
    }
  })
  check(mdLook.keyword === 'rgb(255, 123, 114)', `Markdown: code blocks are coloured (${mdLook.keyword})`)
  check(mdLook.inline >= 3 && mdLook.display === 1 && mdLook.errors === 0 && mdLook.font, `Markdown: formulas drawn with KaTeX (${JSON.stringify(mdLook)})`)
  await page.screenshot({ path: shot('22-markdown-code-math') })

  await openDoc('Event Sourcing — Bài học để chép vào vở')
  await page.frameLocator('iframe.html-frame').locator('h1').waitFor()
  await page.waitForTimeout(500)
  await page.frameLocator('iframe.html-frame').locator('h1').click()
  await typeFind('su kien') // accent-insensitive, Ctrl+F typed inside the page
  const htmlCount = await findCount()
  const marked = await page
    .frames()
    .find((fr) => fr.url().includes('Event%20Sourcing.html'))
    .evaluate(() => CSS.highlights.get('sd-find')?.size ?? 0)
  check(/^1\/\d+/.test(htmlCount) && marked > 0, `HTML: Ctrl+F inside the page finds "sự kiện" (${htmlCount}, ${marked} marked)`)
  await page.press('.find-bar input', 'Escape')

  await openDoc('Git cơ bản')
  await page.waitForTimeout(2000)
  await typeFind('remote')
  const bookCount = await findCount()
  await page.waitForTimeout(800)
  const bookText = await page.frames().find((fr) => fr.url() === 'about:srcdoc')?.evaluate(() => document.body.textContent)
  check(/^1\/\d+/.test(bookCount) && bookText?.includes('Làm việc với remote'), `EPUB: Ctrl+F searches the whole book and opens the chapter (${bookCount})`)
  await page.press('.find-bar input', 'Escape')

  // 23. Issues #21, #22, #23, #25: document note, Markdown notes, tags, clean-up, recovery, sidebar.
  step('23a. Recover a broken data file')
  const backupName = readdirSync(library).find((f) => f.startsWith('.docs-meta.corrupt-'))
  // The user fixed the backup by hand; it has a tag for Event Sourcing and data of a deleted file.
  writeFileSync(file(backupName), JSON.stringify({ version: 1, docs: { [ES]: { tags: ['phục-hồi'], status: 'new' }, 'gone/old.md': { tags: ['cũ'], status: 'done' } } }))
  await page.click('.banner:has-text("Khôi phục…") button')
  await page.waitForSelector('dialog.settings[open] section.recovery')
  await page.click('section.recovery button:has-text("Gộp lại")')
  await page.waitForSelector('section.recovery', { state: 'detached' })
  const merged = JSON.parse(readFileSync(metaFile, 'utf8')).docs
  check(merged[ES]?.tags?.includes("phục-hồi") && merged[ES]?.tags?.includes("backend") && merged[ES]?.status === 'learning', 'backup merged into the current tags without losing them')
  check(!readdirSync(library).some((f) => f.startsWith('.docs-meta.corrupt-')) && readdirSync(library).some((f) => f.startsWith('.docs-meta.merged-')), 'merged backup is kept as .merged-, not offered again')
  check((await page.locator('.banner:has-text("Khôi phục…")').count()) === 0, 'recovery banner disappears')

  step('23b. Tags across the workspace')
  await page.click('.tag-row:has-text("#backend") >> text=Đổi tên')
  await page.fill('.tag-row input', 'server')
  await page.press('.tag-row input', 'Enter')
  await page.waitForSelector('.tag-row:has-text("#server")')
  check(JSON.parse(readFileSync(metaFile, 'utf8')).docs[ES]?.tags?.includes('server'), 'renaming a tag changes it in .docs-meta.json')
  dialogAnswer = 'accept'
  await page.click('.tag-row:has-text("#phục-hồi") >> text=Xoá')
  await page.waitForSelector('.tag-row:has-text("#phục-hồi")', { state: 'detached' })
  check(!JSON.stringify(JSON.parse(readFileSync(metaFile, 'utf8')).docs).includes('phục-hồi'), 'deleting a tag removes it from every document')
  const orphanLabel = await page.textContent('.tags-section .setting-row')
  await page.click('.tags-section >> text=Dọn dẹp')
  await page.waitForFunction(() => document.querySelector('.tags-section .setting-row')?.textContent?.includes(': 0 mục'))
  dialogAnswer = 'dismiss'
  check(/: [1-9]\d* mục/.test(orphanLabel) && !JSON.parse(readFileSync(metaFile, 'utf8')).docs['gone/old.md'], `clean-up removes data of deleted files (${orphanLabel.trim()})`)

  step('23c. Sidebar order and arrow keys')
  await page.click('dialog.settings >> text=Mới sửa trước')
  await page.click('dialog.settings >> text=Xong')
  await page.waitForTimeout(300)
  const order = await page.evaluate(async () => {
    const lib = await window.api.getLibrary()
    const want = lib.docs
      .filter((d) => d.root === lib.roots[0].key && /^backend\/[^/]+$/.test(d.rel))
      .sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title, 'vi'))
      .map((d) => d.rel)
    const shown = [...document.querySelectorAll('.doc-list .row.doc')].map((r) => r.getAttribute('title')).filter((t) => /^backend\/[^/]+$/.test(t))
    return { want, shown }
  })
  check(order.want.length > 1 && order.want.join('|') === order.shown.join('|'), `sidebar sorted by last change (${order.shown.join(', ')})`)
  await page.focus(`.doc-list .row.doc[title="${order.shown[0]}"]`)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await docPathIs(order.shown[1])
  check(true, 'ArrowDown + Enter opens the next document')
  await page.focus('.doc-list .row.folder:has-text("backend")')
  await page.keyboard.press('ArrowLeft')
  check((await page.getAttribute('.doc-list .row.folder:has-text("backend")', 'aria-expanded')) === 'false', 'ArrowLeft closes a folder')
  await page.keyboard.press('ArrowRight')
  check((await page.getAttribute('.doc-list .row.folder:has-text("backend")', 'aria-expanded')) === 'true', 'ArrowRight opens it again')

  step('23d. Note about the whole document, notes in Markdown')
  await openDoc('React useEffect — khi nào chạy?')
  await page.waitForSelector('.markdown h2')
  await page.click('.panel-tabs >> text=Ghi chú')
  await page.click('.doc-note >> text=+ Viết')
  await page.fill('.doc-note textarea', '**Tóm tắt:** effect chạy sau render\n- ý 1\n- ý 2')
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('.doc-note-text strong')
  check((await page.locator('.doc-note-text li').count()) === 2, 'document note is shown as Markdown')
  const savedNotes = JSON.parse(readFileSync(notesFile, 'utf8')).docs[REACT]
  check(savedNotes?.docNote?.text?.startsWith('**Tóm tắt:**') && savedNotes.items.length > 0, 'document note saved next to the highlights')
  await page.click('.note-card .note-card-edit >> nth=0')
  await page.fill('.note-popover textarea', 'Có `code` và **đậm**')
  await page.keyboard.press('Control+Enter')
  await page.waitForSelector('.note-card-text code')
  check(true, 'highlight notes are shown as Markdown')
  await page.screenshot({ path: shot('23-doc-note') })

  // 18. Removing a folder from the workspace keeps its files.
  step("18. Remove folder")
  dialogAnswer = 'accept'
  await page.hover('.root-row:has-text("notes")')
  await page.click('.root-row:has-text("notes") .root-remove')
  await page.waitForFunction(() => document.querySelectorAll('.root-row').length === 0)
  check((await page.textContent('.library-name')) === 'library', 'removed folder disappears; workspace shows the one folder left')
  check(existsSync(path.join(notes, 'devops', 'Docker cơ bản.md')), 'removing a folder does not delete its files')
  const ws = JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8')).libraryPaths
  check(Array.isArray(ws) && ws.length === 1, 'workspace folders saved in settings')

  // 24. Issue #24: double-clicking a document in Explorer while the app runs starts a second
  // copy with the file on its command line; it hands the file over to this window and quits.
  step('24. Open a file from Explorer')
  const openWithApp = (file) =>
    new Promise((resolve) => {
      const child = spawn(electronPath, [projectRoot, file], { env: { ...process.env, STUDYDOCS_USER_DATA: userData }, stdio: 'ignore' })
      child.on('exit', resolve)
      setTimeout(() => (child.kill(), resolve('timeout')), 20000)
    })
  const secondExit = await openWithApp(file(ES))
  await docPathIs(ES)
  check(secondExit !== 'timeout', 'a file opened from Explorer shows in the running app (second copy quits)')
  const extra = path.join(workDir, 'extra')
  mkdirSync(extra)
  writeFileSync(path.join(extra, 'Ngoài workspace.md'), '# Ngoài workspace\n\nFile mở từ Explorer.')
  await app.evaluate(({ dialog }) => {
    globalThis.__realBox = dialog.showMessageBox
    globalThis.__boxes = []
    dialog.showMessageBox = async (_w, opts) => (globalThis.__boxes.push(opts.message), { response: 0 }) // "Thêm thư mục và mở"
  })
  await openWithApp(path.join(extra, 'Ngoài workspace.md'))
  await docPathIs('Ngoài workspace.md')
  const boxes = await app.evaluate(({ dialog }) => ((dialog.showMessageBox = globalThis.__realBox), globalThis.__boxes))
  check(boxes.length === 1 && boxes[0].includes('không nằm trong workspace'), 'a file outside the workspace asks to add its folder, then opens')
  check((await page.locator('.root-row').count()) === 2, 'its folder is added to the workspace')

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} catch (err) {
  console.error(err)
  if (errors.length) console.error(['--- console errors ---', ...errors].join('\n'))
  await page.screenshot({ path: shot('error') }).catch(() => {})
  const lastLines = mainLog.split(/\r?\n/).slice(-25).join('\n')
  console.error(`--- main process log (last lines) ---\n${lastLines}`)
  failures++
} finally {
  await app.close()
  rmSync(workDir, { recursive: true, force: true })
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
