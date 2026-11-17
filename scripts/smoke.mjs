// Smoke test: opens the built app on sample-library/, clicks through it and saves screenshots.
// Run with: npm run smoke
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const library = path.join(projectRoot, 'sample-library')
const shot = (name) => path.join(here, `${name}.png`)

rmSync(path.join(library, '.docs-meta.json'), { force: true })

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
await page.waitForSelector('.sidebar')
await page.screenshot({ path: shot('1-welcome') })

// HTML document in a sandboxed iframe
await page.click('text=Event Sourcing — Bài học để chép vào vở')
const frame = page.frameLocator('iframe.html-frame')
await frame.locator('h1').waitFor()
console.log('iframe h1:', await frame.locator('h1').textContent())
console.log('iframe svg count:', await frame.locator('svg').count())
await page.waitForTimeout(800)
await page.screenshot({ path: shot('2-html-doc') })

// Study status + tag
await page.click('.segmented >> text=Đang học')
await page.fill('.tag-editor input', 'backend')
await page.press('.tag-editor input', 'Enter')
await page.waitForTimeout(300)

// Markdown document with Mermaid
await page.click('text=React useEffect — khi nào chạy?')
await page.waitForSelector('.markdown pre.mermaid svg g.node', { timeout: 15000 })
await page.waitForTimeout(500)
await page.screenshot({ path: shot('3-markdown-doc') })

// In-doc anchor + cross-doc link
await page.click('.markdown >> text=Event Sourcing')
await page.waitForSelector('.doc-path:has-text("backend/Event Sourcing.html")')
console.log('cross-doc link: ok')

// Accent-insensitive search
await page.fill('.search input', 'su kien')
await page.waitForSelector('.hit')
console.log('hits for "su kien":', await page.locator('.hit').count())
await page.screenshot({ path: shot('4-search') })
await page.fill('.search input', '')

// Status filter
await page.click('.filters >> text=Đang học')
console.log('rows with "Đang học" filter:', await page.locator('.group:last-child .row.doc').count())

console.log('console errors:', errors.length ? errors : 'none')
await app.close()
