// Pictures (.png, .jpg, .svg...): fit to the window or zoom in, Ctrl + mouse wheel to zoom.
// They have no text, so there is no Ctrl+F or highlighting; tags and the note about the whole
// file (Ghi chú chung) work as for every document.
//
// SVG files are shown with <img>, where their scripts never run.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { DocEntry } from '../../../shared/types'
import { docUrl } from '../lib/docs'
import type { ReaderCallbacks, ReaderHandle } from './reader'

interface Props extends ReaderCallbacks {
  doc: DocEntry
  onError: (err: unknown) => void
}

type Zoom = 'fit' | number
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8]

const ImageView = forwardRef<ReaderHandle, Props>(function ImageView(props, ref) {
  const { doc } = props
  const cb = useRef(props)
  cb.current = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [fitScale, setFitScale] = useState(1)

  // The scale "fit" means right now (never bigger than the real size).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !size) return
    const update = (): void => setFitScale(Math.min(1, (el.clientWidth - 48) / size.w, (el.clientHeight - 48) / size.h))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size])

  const scale = zoom === 'fit' ? fitScale : zoom
  const step = (dir: 1 | -1): void => {
    const next = dir > 0 ? STEPS.find((z) => z > scale + 0.001) : [...STEPS].reverse().find((z) => z < scale - 0.001)
    if (next) setZoom(next)
  }

  // Ctrl + mouse wheel zooms.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      step(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  useImperativeHandle(ref, () => ({
    gotoHeading: () => {},
    restoreScroll: () => {},
    collectChanges: async () => ({ kind: 'none' }),
    setAnnotations: () => cb.current.onAnchored([]),
    gotoAnnotation: () => {},
    clearSelection: () => {},
    find: async () => ({ index: 0, total: 0 }),
    findStep: async () => ({ index: 0, total: 0 }),
    clearFind: () => {}
  }))

  return (
    <div className="image-view">
      <div className="image-scroll" ref={scrollRef}>
        <img
          src={`${docUrl(doc.path)}?v=${doc.mtime}`}
          alt={doc.title}
          draggable={false}
          style={size ? { width: size.w * scale, height: size.h * scale } : { visibility: 'hidden' }}
          onLoad={(e) => {
            const img = e.currentTarget
            // SVGs without a size report 0: give them a usable one.
            setSize({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 })
            cb.current.onOutline([])
            cb.current.onReady()
          }}
          onError={() => cb.current.onError(new Error('Không hiển thị được ảnh này.'))}
          onDoubleClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
        />
      </div>
      <div className="pdf-zoom" role="toolbar" aria-label="Thu phóng">
        <button className="icon-btn" title="Thu nhỏ (Ctrl + lăn chuột)" onClick={() => step(-1)}>
          −
        </button>
        <span className="pdf-zoom-value">{Math.round(scale * 100)}%</span>
        <button className="icon-btn" title="Phóng to (Ctrl + lăn chuột)" onClick={() => step(1)}>
          +
        </button>
        <button className={`btn small ${zoom === 'fit' ? 'active' : ''}`} title="Vừa khung (bấm đúp vào ảnh để đổi)" onClick={() => setZoom('fit')}>
          Vừa khung
        </button>
        <button className={`btn small ${zoom === 1 ? 'active' : ''}`} title="Kích thước thật" onClick={() => setZoom(1)}>
          100%
        </button>
      </div>
      {size && <div className="image-size">{`${size.w} × ${size.h}`}</div>}
    </div>
  )
})

export default ImageView
