// A small script appended to HTML documents in normal (reading) mode.
//
// The document runs in a sandboxed, cross-origin iframe, so the app can't look inside it.
// This script runs inside the page and talks to the app with postMessage:
//  - sends the outline (h1-h3) and which heading you're reading, for the outline panel
//  - sends the scroll position (to remember where you stopped reading) and restores it
//  - forwards app shortcuts (Alt+←/→, Ctrl+K/P/E/,) typed while the page has focus
// It never changes the document. In edit mode the editor script is used instead.

export function viewModeInjection(): string {
  return `
<script data-studydocs>
(() => {
  const send = (msg) => parent.postMessage({ source: 'studydocs', ...msg }, '*')
  let headings = []

  const collect = () => {
    headings = [...document.querySelectorAll('h1, h2, h3')].filter((h) => h.textContent.trim() && h.getClientRects().length)
    send({
      type: 'outline',
      items: headings.map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim().replace(/\\s+/g, ' ') }))
    })
  }

  let pending = false
  const report = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      let active = -1
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= 90) active = i
        else break
      }
      send({ type: 'scroll', y: Math.round(scrollY), active })
    })
  }
  addEventListener('scroll', report, { passive: true })

  addEventListener('message', (e) => {
    if (e.source !== parent || !e.data || e.data.source !== 'studydocs-app') return
    if (e.data.type === 'goto') headings[e.data.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (e.data.type === 'restore') scrollTo({ top: e.data.y, behavior: 'instant' })
  })

  addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase()
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      send({ type: 'key', key: e.key === 'ArrowLeft' ? 'back' : 'forward' })
    } else if ((e.ctrlKey || e.metaKey) && ['k', 'p', 'e', ','].includes(key)) {
      e.preventDefault()
      send({ type: 'key', key: 'ctrl+' + key })
    }
  }, true)

  const ready = () => {
    collect()
    send({ type: 'ready' })
    report()
    setTimeout(collect, 1000) // headings added later by the page's own scripts
  }
  if (document.readyState === 'complete') ready()
  else addEventListener('load', ready)
})()
</script>`
}
