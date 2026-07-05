import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  compactPrice,
  fetchMarket,
  loadMarketCache,
  saveMarketCache,
  timeAgo,
  type MarketSnapshot,
} from '@/lib/market'

type Status = 'loading' | 'live' | 'stale' | 'offline'

const HOLD_KEY = 'uex-market-hold'
/**
 * Strict left→right domino: each cell's flip starts exactly when the previous one finishes, so
 * STEP between cells == each cell's flip duration. ~185 cells × STEP = the full sweep time.
 */
/** Each cell's 3D flip duration (long enough to read the bezier ease). */
const FLIP_MS = 320
/** Stagger between cells. < FLIP_MS so flips partially overlap → a smooth flowing wave
 *  (not choppy strict-domino, not a wide all-at-once blur). ~4 cells animate at once. */
const STEP_MS = 75
/** Full left→right sweep: last cell starts at 183×STEP, then takes FLIP_MS to finish. */
const SWEEP_TOTAL_MS = 184 * STEP_MS + FLIP_MS
/** How long the % face stays up (short) once the sweep to it completes. */
const PCT_DWELL_MS = 4000

/**
 * Live UEX commodity heatmap — the uexcorp.space homepage grid, in-app. A dense static grid of
 * every commodity (alphabetical by code). Cells flip on the Y axis, left→right one at a time
 * (a sweep), between the sell price/SCU and the commodity's supply level (buy stock vs its
 * average). The dwell between sweeps is user-set (the "hold" input). Shared by Plan + Earnings.
 */
export default function MarketBoard() {
  const cacheRef = useRef(loadMarketCache())
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(cacheRef.current?.current ?? null)
  const [previous, setPrevious] = useState<MarketSnapshot | null>(cacheRef.current?.previous ?? null)
  const [status, setStatus] = useState<Status>(cacheRef.current ? 'stale' : 'loading')
  // Re-render the "updated Xm ago" label periodically without re-fetching.
  const [, setTick] = useState(0)
  const didFetch = useRef(false)

  // Seconds to stay on each side (price / %) between sweeps — user-set, persisted. 0 = off.
  const [holdSec, setHoldSec] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem(HOLD_KEY) ?? '', 10)
      return Number.isFinite(v) && v >= 0 && v <= 120 ? v : 10
    } catch {
      return 10
    }
  })
  const setHold = (n: number) => {
    const v = Math.max(0, Math.min(120, Number.isFinite(n) ? n : 0))
    setHoldSec(v)
    try {
      localStorage.setItem(HOLD_KEY, String(v))
    } catch {
      /* ignore */
    }
  }

  // Whole-grid flip state, toggled on a timer; the per-cell transition-delay turns it into a sweep.
  const [flipped, setFlipped] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await fetchMarket()
      const cache = saveMarketCache(next)
      setSnapshot(cache.current)
      setPrevious(cache.previous)
      setStatus('live')
    } catch {
      setStatus((s) => (snapshot ? 'offline' : s === 'loading' ? 'offline' : s))
    }
  }, [snapshot])

  useEffect(() => {
    if (didFetch.current) return
    didFetch.current = true
    // Always refetch on mount so the status reflects reality (LIVE when online) instead of
    // lingering on CACHED. The cache still rendered instantly; this just confirms it live.
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Keep prices fresh in the background (UEX prices change slowly — minutes/hours).
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    const id = window.setInterval(() => void refreshRef.current(), 90_000)
    return () => window.clearInterval(id)
  }, [])

  // The flip timer (asymmetric): the PRICE face stays up for `holdSec` (the clear, primary view),
  // then sweeps to the % face which stays up briefly (PCT_DWELL), then sweeps back. Each state's
  // total time = the incoming sweep + that face's dwell. 0s hold = no flipping (price only).
  useEffect(() => {
    if (!holdSec || holdSec <= 0) {
      setFlipped(false)
      return
    }
    let cur = false
    setFlipped(false)
    let t = window.setTimeout(function tick() {
      cur = !cur
      setFlipped(cur)
      const dwell = cur ? PCT_DWELL_MS : holdSec * 1000
      t = window.setTimeout(tick, SWEEP_TOTAL_MS + dwell)
    }, holdSec * 1000)
    return () => window.clearTimeout(t)
  }, [holdSec])

  const indexMove = useMemo(() => {
    if (!snapshot || !previous || previous.index <= 0) return null
    return ((snapshot.index - previous.index) / previous.index) * 100
  }, [snapshot, previous])

  if (!snapshot) {
    return (
      <div className="market-board market-board--empty">
        <span className="hud-label">UEX Market</span>
        <span className="market-empty-msg">
          {status === 'offline' ? 'Offline — no cached prices yet.' : 'Loading live commodity prices…'}
        </span>
      </div>
    )
  }

  const statusLabel =
    status === 'live' ? 'LIVE' : status === 'offline' ? 'OFFLINE' : status === 'loading' ? '…' : 'CACHED'
  const pricedCount = snapshot.items.filter((i) => i.priceSell > 0).length

  return (
    <div
      className={`market-board ${flipped ? 'flipped' : ''}`}
      style={{ ['--flip-dur' as string]: `${FLIP_MS}ms` }}
    >
      <div className="market-head">
        <span className="hud-label market-title">UEX Market</span>
        <span className={`market-dot market-dot--${status}`} title={`Data status: ${statusLabel}`} />
        <span className="market-status hud-label">{statusLabel}</span>
        <span className="market-gauge">
          median <strong>{snapshot.index.toLocaleString()}</strong> aUEC/SCU
          {indexMove != null && (
            <span className={`market-move ${moveClass(indexMove)}`}>{moveText(indexMove)}</span>
          )}
        </span>
        <span className="market-head-spacer" />
        <span className="hud-label market-count">{pricedCount} priced · {timeAgo(snapshot.ts)}</span>
        <label
          className="market-hold"
          title="Seconds each side (price / supply %) stays up between flips. 0 = no flipping."
        >
          hold
          <input
            type="number"
            min={0}
            max={60}
            value={holdSec}
            onChange={(e) => setHold(parseInt(e.target.value, 10))}
          />
          s
        </label>
      </div>

      <div className="market-grid" aria-label="Live commodity prices">
        {snapshot.items.map((it, i) => (
          <span
            key={it.code}
            className={`market-cell ${it.priceSell === 0 ? 'na' : it.sellOnly ? 'sell-only' : ''}`}
            data-name={it.name}
            tabIndex={0}
          >
            {/* --sf-delay staggers each cell's flip start → smooth left→right wave. */}
            <span
              className="market-cell-inner"
              style={{ ['--sf-delay' as string]: `${i * STEP_MS}ms` }}
            >
              <span className="market-face market-front">
                <span className="market-cell-code">{it.code}</span>
                <span className="market-cell-price">{compactPrice(it.priceSell)}</span>
              </span>
              <span className="market-face market-back">
                <span className="market-cell-code">{it.code}</span>
                <span className="market-cell-pct">{it.availPct != null ? `${it.availPct}%` : '—'}</span>
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

const moveClass = (n: number) => (n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat')
const moveText = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
