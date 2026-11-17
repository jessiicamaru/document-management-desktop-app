import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import PrintPage from './PrintPage'
import './styles.css'

// #print=<doc id>: hidden window used to export a Markdown document to PDF.
const printId = location.hash.startsWith('#print=') ? decodeURIComponent(location.hash.slice('#print='.length)) : null

if (printId) {
  // Created before React renders, so the main process always finds it and waits for the
  // page (diagrams included) to be fully drawn before printing. PrintPage resolves it.
  window.__studydocsPrintReady = new Promise<void>((resolve) => (window.__studydocsPrintDone = resolve))
}

createRoot(document.getElementById('root')!).render(<StrictMode>{printId ? <PrintPage id={printId} /> : <App />}</StrictMode>)
