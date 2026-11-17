// Turns build/icon.svg into build/icon.png (512px) and build/icon.ico (16-256px) for Windows.
// Uses Electron itself to render the SVG, so no extra image tools are needed.
// Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const dir = path.join(__dirname, '..', 'build')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Builds an .ico that stores each size as PNG (supported since Windows Vista). */
function toIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, e) // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt8(0, e + 2) // palette
    header.writeUInt8(0, e + 3) // reserved
    header.writeUInt16LE(1, e + 4) // colour planes
    header.writeUInt16LE(32, e + 6) // bits per pixel
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  fs.writeFileSync(path.join(dir, 'icon.png'), image.toPNG())
  const pngs = SIZES.map((size) => ({ size, data: image.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  fs.writeFileSync(path.join(dir, 'icon.ico'), toIco(pngs))
  console.log('wrote build/icon.png and build/icon.ico')
  app.exit(0)
})
