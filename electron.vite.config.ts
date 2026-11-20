import { copyFileSync, createReadStream, cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * pdf.js reads a few files of its own while showing a PDF: character maps (CJK text without
 * embedded fonts), the standard fonts, colour profiles, and WebAssembly decoders (JPEG 2000
 * pictures). They are copied next to the app as pdfjs/<folder>/ (and served the same way in dev).
 */
function pdfjsAssets(): Plugin {
  const from = resolve(__dirname, 'node_modules/pdfjs-dist')
  const folders = ['cmaps', 'standard_fonts', 'iccs', 'wasm']
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^[\\/]+/, '')
        const file = join(from, rel)
        if (!folders.some((f) => rel.startsWith(f)) || !file.startsWith(from) || !existsSync(file) || !statSync(file).isFile()) return next()
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      for (const f of folders) cpSync(join(from, f), join(options.dir!, 'pdfjs', f), { recursive: true })
    }
  }
}

// electron-vite builds three bundles:
//   main     -> src/main/index.ts       (Node side: files, window, protocol)
//               src/main/search-worker.ts (full-text search, runs in its own thread)
//   preload  -> src/preload/index.ts    (safe bridge exposed as window.api)
//   renderer -> src/renderer/index.html (React UI)
/**
 * OCR (scanned PDFs) runs in the app, offline: tesseract.js's worker, its WebAssembly engine
 * (the LSTM builds only, the ones used) and the Vietnamese + English language data, copied next
 * to the app as tesseract/… (and served the same way in dev).
 */
function ocrAssets(): Plugin {
  const tjs = resolve(__dirname, 'node_modules/tesseract.js')
  const files: Record<string, string> = {
    'worker.min.js': join(tjs, 'dist/worker.min.js'),
    'lang/vie.traineddata.gz': resolve(__dirname, 'node_modules/@tesseract.js-data/vie/4.0.0_best_int/vie.traineddata.gz'),
    'lang/eng.traineddata.gz': resolve(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')
  }
  // The engine tesseract.js was built against (its own copy).
  const core = existsSync(join(tjs, 'node_modules/tesseract.js-core')) ? join(tjs, 'node_modules/tesseract.js-core') : resolve(__dirname, 'node_modules/tesseract.js-core')
  for (const name of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
    if (existsSync(join(core, name))) files[`core/${name}`] = join(core, name)
  }
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use('/tesseract', (req, res, next) => {
        const file = files[decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')]
        if (!file) return next()
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      for (const [to, from] of Object.entries(files)) {
        const target = join(options.dir!, 'tesseract', to)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(from, target)
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'search-worker': resolve(__dirname, 'src/main/search-worker.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), pdfjsAssets(), ocrAssets()]
  }
})
