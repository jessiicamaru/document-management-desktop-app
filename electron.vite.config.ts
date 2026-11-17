import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite builds three bundles:
//   main     -> src/main/index.ts       (Node side: files, window, protocol)
//               src/main/search-worker.ts (full-text search, runs in its own thread)
//   preload  -> src/preload/index.ts    (safe bridge exposed as window.api)
//   renderer -> src/renderer/index.html (React UI)
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
    plugins: [react()]
  }
})
