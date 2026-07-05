import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@/hauler'

/**
 * In-app auto-update banner. Windows' own toast is easy to miss, so we surface
 * the update inside the app: a quiet "downloading" strip, then a "ready — restart"
 * bar with a one-click Restart button (calls electron-updater's quitAndInstall).
 * Desktop-only; a no-op in the browser (no window.hauler bridge).
 */
export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.hauler : undefined
    if (!bridge?.onUpdateStatus) return
    return bridge.onUpdateStatus((s) => {
      setStatus(s)
      setDismissed(false)
    })
  }, [])

  if (!status || dismissed) return null

  const ver = status.version ? `v${status.version}` : 'a new version'

  if (status.state === 'downloading') {
    return (
      <div className="update-banner update-banner--downloading">
        <span className="update-banner__dot" />
        <span>
          Downloading update {ver}
          {typeof status.percent === 'number' ? ` — ${status.percent}%` : '…'}
        </span>
      </div>
    )
  }

  // state === 'ready'
  return (
    <div className="update-banner update-banner--ready">
      <span className="update-banner__dot" />
      <span>
        <strong>Update {ver} is ready.</strong> Restart to apply it.
      </span>
      <button className="update-banner__btn" onClick={() => window.hauler?.quitAndInstall()}>
        Restart now
      </button>
      <button
        className="update-banner__close"
        aria-label="Dismiss"
        title="Dismiss (installs on next quit)"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  )
}
