import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import type { OcrMode } from '@/types'

/** localStorage key zustand-persist writes the whole app state under. */
const PERSIST_KEY = 'sc-hauling-planner'

/**
 * Settings hub. Collects the app-wide options that used to live scattered across other
 * tabs: the OBS screenshot capture folder (was on the Missions/Import panel) and the
 * full-data Backup/Restore (was on the Fleet tab).
 */
export default function SettingsView() {
  return (
    <div className="view settings">
      <div className="view-head">
        <div>
          <h1>SETTINGS</h1>
          <p className="view-sub">Screenshot capture folder, data backup, and app options.</p>
        </div>
      </div>

      <CaptureFolderSection />
      <OcrModeSection />
      <BackupSection />
      <AboutSection />
    </div>
  )
}

/** Choose / view the folder OBS drops mission screenshots into (desktop app only). */
function CaptureFolderSection() {
  const bridge = typeof window !== 'undefined' ? window.hauler : undefined
  const [dir, setDir] = useState('')

  useEffect(() => {
    if (!bridge) return
    bridge.getCapturesDir().then(setDir).catch(() => {})
  }, [bridge])

  return (
    <section className="panel settings-section">
      <h3 className="section-label">Screenshot Capture Folder</h3>
      <p className="muted sm">
        HAULER OPS reads your mission screenshots from this folder and pulls the contract
        details out with on-device OCR — nothing is ever uploaded, no account needed. Point
        OBS's screenshot output here, bind a HOTAS/keyboard key to OBS's “Screenshot” hotkey,
        then use <strong>Import</strong> on the Missions tab to read the latest captures.
      </p>
      {bridge ? (
        <div className="settings-row">
          <code className="settings-path">{dir || '…'}</code>
          <button
            className="btn"
            title="Change the screenshot folder"
            onClick={async () => {
              const p = await bridge.pickCapturesDir?.()
              if (p) setDir(p)
            }}
          >
            📁 Change folder
          </button>
        </div>
      ) : (
        <p className="muted sm">Available in the desktop app (HAULER OPS.exe).</p>
      )}
    </section>
  )
}

/** Choose how mission screenshots are OCR-read (auto-detect aspect / force crop / full image). */
function OcrModeSection() {
  const ocrMode = useStore((s) => s.ocrMode)
  const setOcrMode = useStore((s) => s.setOcrMode)
  return (
    <section className="panel settings-section">
      <h3 className="section-label">Mission OCR Reading</h3>
      <p className="muted sm">
        How screenshots are read when importing missions. The default auto-detects your screen's
        aspect ratio — it crops the objectives column on 16:9 and reads the whole frame on
        ultrawide / 16:10 / 32:9 monitors. If contracts import with missing or wrong values, try
        “Full screenshot”.
      </p>
      <p className="muted sm">
        Tip: in OBS, capture just the game (Game Capture) or a single display — so the shot is
        only Star Citizen, not your whole multi-monitor desktop.
      </p>
      <label className="settings-select">
        <span className="hud-label">Reading mode</span>
        <select value={ocrMode} onChange={(e) => setOcrMode(e.target.value as OcrMode)}>
          <option value="auto">Auto-detect · 16:9 & 32:9 (recommended)</option>
          <option value="crop">Objectives column · force crop</option>
          <option value="full">Full screenshot · most compatible</option>
        </select>
      </label>
    </section>
  )
}

/** App identity, credits, and the required fan-tool disclaimers. */
function AboutSection() {
  return (
    <section className="panel settings-section">
      <h3 className="section-label">About</h3>
      <p className="muted sm">
        HAULER OPS v{__APP_VERSION__} — a cargo-hauling planner for Star Citizen. Everything runs
        on your device: screenshots are read with on-device OCR and nothing about you or your game
        is ever uploaded.
      </p>
      <p className="muted sm">
        Unofficial fan tool — not affiliated with, endorsed by, or sponsored by Cloud Imperium
        Games. Star Citizen® and all related marks are trademarks of Cloud Imperium Rights LLC.
      </p>
      <p className="muted sm">Live commodity prices courtesy of UEX Corp (uexcorp.space).</p>
    </section>
  )
}

/**
 * Backup / restore of EVERYTHING (ships, grids, missions, earnings, layouts, profile,
 * settings). Exports the raw zustand-persist JSON so a restore goes through the normal
 * version migration on reload — a backup from an older app version still imports cleanly.
 */
function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null)

  const exportBackup = () => {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) {
      window.alert('Nothing to back up yet.')
      return
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `hauler-ops-backup-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importBackup = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { state?: unknown; version?: unknown }
      if (!parsed || typeof parsed !== 'object' || !('state' in parsed)) {
        window.alert('This file is not a HAULER OPS backup.')
        return
      }
      if (
        !window.confirm(
          'Restore this backup? ALL current data (ships, missions, earnings) will be REPLACED.',
        )
      )
        return
      localStorage.setItem(PERSIST_KEY, text)
      window.location.reload()
    } catch {
      window.alert('Could not read the backup file (corrupt JSON).')
    }
  }

  return (
    <section className="panel settings-section">
      <h3 className="section-label">Backup &amp; Restore</h3>
      <p className="muted sm">
        A backup saves <strong>everything</strong> stored on this device — your ships and
        cargo-bay layouts, missions, earnings history, saved mission templates, pilot profile,
        and app settings — into a single <code>.json</code> file. Keep it somewhere safe;
        restoring that file on any machine brings HAULER OPS back exactly as it was. Restoring{' '}
        <strong>replaces</strong> all current data, so back up first if in doubt.
      </p>
      <div className="settings-row">
        <button className="btn" title="Back up all data to a JSON file" onClick={exportBackup}>
          ⬇ Backup to file
        </button>
        <button
          className="btn"
          title="Restore a JSON backup (replaces current data)"
          onClick={() => fileRef.current?.click()}
        >
          ⬆ Restore from file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importBackup(f)
            e.target.value = ''
          }}
        />
      </div>
    </section>
  )
}
