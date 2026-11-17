import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite builds three bundles:
//   main     -> src/main/index.ts      (Node side: files, window, protocol)
//   preload  -> src/preload/index.ts   (safe bridge exposed as window.api)
//   renderer -> src/renderer/index.html (React UI)
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
