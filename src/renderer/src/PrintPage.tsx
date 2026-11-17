// Page used only for "Xuất PDF" of a Markdown document. The main process opens the app's
// renderer in a hidden window with #print=<doc id>, waits for window.__studydocsPrintReady
// (created in main.tsx), then prints it (see printToPdf in src/main/index.ts).

import { useEffect, useRef } from 'react'
import { docUrl } from './lib/docs'
import { applyUiSettings } from './lib/ui'
import { renderMarkdown } from './components/MarkdownView'

export default function PrintPage({ id }: { id: string }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    document.documentElement.classList.add('force-light') // paper is white, whatever the app theme
    void (async () => {
      try {
        const [lib, source, ui] = await Promise.all([window.api.getLibrary(), window.api.readDoc(id), window.api.getUiSettings()])
        applyUiSettings(ui) // same reading font and size as on screen
        document.title = lib.docs.find((d) => d.path === id)?.title ?? 'Study Docs' // becomes the PDF title
        const el = ref.current!
        el.innerHTML = renderMarkdown(source)
        el.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
          const src = img.getAttribute('src')!
          if (!/^(https?:|data:|doc:)/i.test(src)) img.src = new URL(src, docUrl(id)).href
        })
        const diagrams = el.querySelectorAll<HTMLElement>('pre.mermaid')
        if (diagrams.length) {
          const { default: mermaid } = await import('mermaid')
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
          await mermaid.run({ nodes: diagrams }).catch((e: unknown) => console.error('Mermaid error', e))
        }
      } finally {
        window.__studydocsPrintDone?.() // see main.tsx
      }
    })()
  }, [id])

  return <article ref={ref} className="markdown print" />
}
