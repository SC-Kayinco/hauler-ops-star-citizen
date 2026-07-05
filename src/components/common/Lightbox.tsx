import { createPortal } from 'react-dom'

/**
 * Full-screen image viewer. Rendered via a portal to <body> so it's truly viewport-fixed
 * (escapes any transformed/scrolling ancestor) — no scrolling to find it. Click anywhere
 * (the image OR the backdrop) or the ✕ to close.
 */
export default function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null
  return createPortal(
    <div className="ss-lightbox" onClick={onClose}>
      <img src={src} alt="Source screenshot" />
      <button className="ss-lightbox-close" onClick={onClose} title="Close (or click anywhere)">
        ✕
      </button>
    </div>,
    document.body,
  )
}
