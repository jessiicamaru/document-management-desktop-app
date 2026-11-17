// Smoke test: opens the built app on a temporary copy of sample-library/, clicks through it,
// checks the results and saves screenshots to scripts/. Exits with code 1 if any check fails.
// Uses its own settings folder, so your real settings and documents are never touched.
// Run with: npm run smoke
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
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
  args: [projectRoot],
  env: { ...process.env, STUDYDOCS_DEBUG: '1', DOCS_LIBRARY: [library, notes].join(path.delimiter), STUDYDOCS_USER_DATA: userData }
})
const errors = []
let mainLog = ''
app.process().stdout?.on('data', (d) => (mainLog += d))
app.process().stderr?.on('data', (d) => (mainLog += d))
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
let dialogAnswer = 'dismiss'
page.on('dialog', (d) => (dialogAnswer === 'accept' ? d.accept() : d.dismiss()))
await page.setViewportSize({ width: 1320, height: 860 })
await page.emulateMedia({ colorScheme: null }) // Playwright forces "light" by default; let the app decide

const openDoc = (title) => page.click(`.doc-list .row.doc >> text=${title}`)
const docPathIs = (p) => page.waitForSelector(`.doc-path:text-is("${p}")`, { timeout: 5000 })
const editBarGone = () => page.waitForSelector('.edit-bar', { state: 'detached', timeout: 5000 })

try {
  await page.waitForSelector('.sidebar')

  // 1. Corrupt meta file: backed up and reported, not silently dropped.
  step("1. Corrupt meta file: backed up and reported, not silently dropped.")
  await page.waitForSelector('.banner')
  check((await page.textContent('.banner')).includes('bị hỏng'), 'corrupt meta file shows a warning')
  check(readdirSync(library).some((f) => f.startsWith('.docs-meta.corrupt-')), 'corrupt meta file was backed up')
  await page.click('.banner button')

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

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} catch (err) {
  console.error(err)
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
