// Smoke test: opens the built app on sample-library/, clicks through it, checks the results
// and saves screenshots to scripts/. Exits with code 1 if any check fails.
// Run with: npm run smoke
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const library = path.join(projectRoot, 'sample-library')
const metaFile = path.join(library, '.docs-meta.json')
const shot = (name) => path.join(here, `${name}.png`)

let failures = 0
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}
const cleanLibrary = () => {
  for (const f of readdirSync(library)) if (f.startsWith('.docs-meta')) rmSync(path.join(library, f), { force: true })
}

// Start from a corrupt meta file, like after a bad sync conflict.
cleanLibrary()
writeFileSync(metaFile, '{ "version": 1, "docs": { <<<<<<< HEAD')

const app = await electron.launch({
  executablePath: electronPath,
  args: [projectRoot],
  env: { ...process.env, DOCS_LIBRARY: library }
})
const errors = []
const page = await app.firstWindow()
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
await page.setViewportSize({ width: 1320, height: 860 })

try {
  await page.waitForSelector('.sidebar')

  // 1. Corrupt meta file: backed up and reported, not silently dropped.
  await page.waitForSelector('.banner')
  check((await page.textContent('.banner')).includes('bị hỏng'), 'corrupt meta file shows a warning')
  check(readdirSync(library).some((f) => f.startsWith('.docs-meta.corrupt-')), 'corrupt meta file was backed up')
  await page.screenshot({ path: shot('1-corrupt-warning') })

  // 2. HTML document renders in the sandboxed iframe.
  await page.click('.row.doc >> text=Event Sourcing — Bài học để chép vào vở')
  const frame = page.frameLocator('iframe.html-frame')
  await frame.locator('h1').waitFor()
  check((await frame.locator('h1').textContent()) === 'Event Sourcing', 'HTML doc renders')
  check((await frame.locator('figure svg').count()) === 7, 'all 7 diagrams render')
  await page.screenshot({ path: shot('2-html-doc') })

  // 3. Status + tag are saved; two writes at the same time both survive.
  await page.click('.segmented >> text=Đang học')
  await page.fill('.tag-editor input', 'backend')
  await page.press('.tag-editor input', 'Enter')
  await page.evaluate(() =>
    Promise.all([
      window.api.updateMeta('frontend/React useEffect.md', { status: 'review' }),
      window.api.updateMeta('frontend/React useEffect.md', { tags: ['react'] })
    ])
  )
  const saved = JSON.parse(readFileSync(metaFile, 'utf8')).docs
  check(saved['backend/Event Sourcing.html']?.status === 'learning', 'status saved')
  check(saved['backend/Event Sourcing.html']?.tags?.includes('backend'), 'tag saved')
  check(
    saved['frontend/React useEffect.md']?.status === 'review' && saved['frontend/React useEffect.md']?.tags?.[0] === 'react',
    'concurrent writes both kept'
  )
  check(!JSON.stringify(saved).includes('lastOpened'), '"recently opened" is not written into the library')

  // 4. A link inside an HTML doc switches the whole app to the target doc, including #hash.
  await page.click('.row.doc >> text=Lộ trình Backend')
  await page.frameLocator('iframe.html-frame').locator('#link-concurrency').click()
  await page.waitForSelector('.doc-path:text-is("backend/Event Sourcing.html")', { timeout: 5000 })
  check(true, 'HTML link updates the header to the new doc')
  check((await page.getAttribute('iframe.html-frame', 'src')).endsWith('#s7'), 'HTML link keeps #s7')
  check(await page.isVisible('.segmented .status-learning.active'), 'header shows the new doc\'s status')
  await page.screenshot({ path: shot('3-html-link') })

  // 5. HTML link to a Markdown doc.
  await page.click('.row.doc >> text=Lộ trình Backend')
  await page.frameLocator('iframe.html-frame').locator('#link-react').click()
  await page.waitForSelector('.doc-path:text-is("frontend/React useEffect.md")', { timeout: 5000 })
  check(true, 'HTML link opens a Markdown doc')

  // 6. Markdown with Mermaid, in-doc anchor and cross-doc link.
  await page.waitForSelector('.markdown pre.mermaid svg g.node', { timeout: 15000 })
  check(true, 'Mermaid diagram renders')
  await page.waitForTimeout(400)
  await page.screenshot({ path: shot('4-markdown-doc') })
  await page.click('.markdown a[href="#bang-tom-tat"]')
  await page.waitForTimeout(800)
  // The sample is short, so the heading can't reach the very top; it must just have scrolled.
  check((await page.evaluate(() => document.querySelector('.md-scroll').scrollTop)) > 100, 'in-doc #anchor scrolls')
  await page.click('.markdown >> text=Event Sourcing')
  await page.waitForSelector('.doc-path:text-is("backend/Event Sourcing.html")')
  check(true, 'Markdown link opens another doc')

  // 7. Accent-insensitive search with phrase highlight.
  await page.fill('.search input', 'su kien')
  await page.waitForSelector('.hit')
  check((await page.textContent('.hit mark')) === 'sự kiện', 'search "su kien" highlights "sự kiện"')
  await page.screenshot({ path: shot('5-search') })
  await page.fill('.search input', '')

  // 8. Filters and recently opened.
  await page.click('.filters >> text=Đang học')
  check((await page.locator('.doc-list .row.doc').count()) === 1, 'status filter')
  await page.click('.filters >> text=Tất cả')
  check((await page.locator('.group:first-child .row.doc').count()) >= 3, 'recently opened list')

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} catch (err) {
  console.error(err)
  failures++
} finally {
  await app.close()
  cleanLibrary()
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
