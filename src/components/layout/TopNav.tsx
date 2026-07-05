import { useStore } from '@/store/useStore'
import type { View } from '@/types'

const TABS: { id: View; label: string }[] = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'ship', label: 'Ship' },
  { id: 'missions', label: 'Missions' },
  { id: 'plan', label: 'Load Plan' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'starmap', label: 'Star Map' },
]

/** Compact aUEC for the nav (e.g. 1.2M, 340k). */
const fmtAUEC = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`

export default function TopNav() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const missionCount = useStore((s) => s.missions.filter((m) => !m.done).length)
  const selectedShip = useStore((s) => s.ships.find((sh) => sh.id === s.selectedShipId))
  const totalEarned = useStore((s) => s.earnings.reduce((a, e) => a + (e.reward || 0), 0))

  return (
    <header className="topnav">
      <div className="brand">
        <span className="brand-mark">▰▰▰</span>
        <div className="brand-text">
          <span className="brand-title">
            HAULER OPS <span className="brand-version">v{__APP_VERSION__}</span>
          </span>
          <span className="brand-sub">Cargo Logistics Terminal</span>
        </div>
      </div>

      <nav className="nav-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-tab ${view === t.id ? 'active' : ''}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
            {t.id === 'missions' && missionCount > 0 && (
              <span className="nav-badge">{missionCount}</span>
            )}
            {t.id === 'ship' && selectedShip && (
              <span className="nav-ship">{selectedShip.name}</span>
            )}
            {t.id === 'earnings' && totalEarned > 0 && (
              <span className="nav-ship earn">{fmtAUEC(totalEarned)} aUEC</span>
            )}
          </button>
        ))}
      </nav>

      <div className="nav-status">
        <button
          className={`nav-gear ${view === 'settings' ? 'active' : ''}`}
          title="Settings"
          onClick={() => setView('settings')}
        >
          ⚙
        </button>
        <span className="status-dot" />
        <span className="hud-label">ONLINE</span>
      </div>
    </header>
  )
}
