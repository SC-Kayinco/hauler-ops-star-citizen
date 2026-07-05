import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { commodityColor } from '@/data/commodities'
import MarketBoard from '@/components/common/MarketBoard'
import Pager from '@/components/common/Pager'
import type { EarningEntry } from '@/types'

const PER_PAGE = 10

type Gran = 'day' | 'week' | 'month'

/** How many buckets each granularity charts back from today. */
const CAP: Record<Gran, number> = { day: 30, week: 16, month: 12 }
const GRAN_LABEL: Record<Gran, string> = { day: 'last 30 days', week: 'last 16 weeks', month: 'last 12 months' }

const pad = (n: number) => String(n).padStart(2, '0')

/** Monday-based start of the week containing d (local time). */
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7 // Mon = 0 … Sun = 6
  x.setDate(x.getDate() - dow)
  return x
}

/** A stable key for the bucket a date falls into. */
function bucketKey(d: Date, g: Gran): string {
  if (g === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  const base = g === 'week' ? startOfWeek(d) : d
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

function labelFor(d: Date, g: Gran): string {
  if (g === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Compact aUEC, e.g. 1.2M / 340k / 950. */
function short(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return `${Math.round(n)}`
}

interface Bucket {
  key: string
  label: string
  value: number
}

/** Aggregate earnings into an ordered, gap-filled list of buckets ending today. */
function buildBuckets(entries: EarningEntry[], g: Gran): Bucket[] {
  const sums = new Map<string, number>()
  for (const e of entries) {
    const k = bucketKey(new Date(e.ts), g)
    sums.set(k, (sums.get(k) ?? 0) + (e.reward || 0))
  }

  const now = new Date(Date.now())
  const starts: Date[] = []
  if (g === 'day') {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    for (let i = 0; i < CAP.day; i++) {
      const d = new Date(t)
      d.setDate(t.getDate() - i)
      starts.unshift(d)
    }
  } else if (g === 'week') {
    const t = startOfWeek(now)
    for (let i = 0; i < CAP.week; i++) {
      const d = new Date(t)
      d.setDate(t.getDate() - i * 7)
      starts.unshift(d)
    }
  } else {
    const t = new Date(now.getFullYear(), now.getMonth(), 1)
    for (let i = 0; i < CAP.month; i++) {
      const d = new Date(t)
      d.setMonth(t.getMonth() - i)
      starts.unshift(d)
    }
  }

  let buckets = starts.map((d) => ({
    key: bucketKey(d, g),
    label: labelFor(d, g),
    value: sums.get(bucketKey(d, g)) ?? 0,
  }))

  // Start the chart at the first bucket with earnings (drop leading empties).
  const firstNonZero = buckets.findIndex((b) => b.value > 0)
  if (firstNonZero > 0) buckets = buckets.slice(firstNonZero)
  return buckets
}

/**
 * Tonight's earning rate: today's total divided by hours since today's first
 * delivery (now-anchored, min 10 min so one quick delivery doesn't show silly rates).
 */
function todayRate(entries: EarningEntry[]): number | null {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const today = entries.filter((e) => e.ts >= dayStart.getTime())
  if (today.length === 0) return null
  const sum = today.reduce((a, e) => a + (e.reward || 0), 0)
  const first = Math.min(...today.map((e) => e.ts))
  const hours = Math.max((Date.now() - first) / 3_600_000, 1 / 6)
  return Math.round(sum / hours)
}

export default function EarningsView() {
  const earnings = useStore((s) => s.earnings)
  const clearEarnings = useStore((s) => s.clearEarnings)
  const updateEarning = useStore((s) => s.updateEarning)
  const [gran, setGran] = useState<Gran>('day')
  const [page, setPage] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')

  const total = earnings.reduce((a, e) => a + (e.reward || 0), 0)
  const count = earnings.length
  const avg = count ? Math.round(total / count) : 0
  const rate = todayRate(earnings)
  const buckets = buildBuckets(earnings, gran)
  const best = buckets.reduce<Bucket | null>((b, x) => (!b || x.value > b.value ? x : b), null)

  function commitEdit(id: string) {
    const n = parseInt(editVal.replace(/[^\d]/g, ''), 10)
    if (!Number.isNaN(n)) updateEarning(id, n)
    setEditId(null)
  }
  const sortedRecent = [...earnings].sort((a, b) => b.ts - a.ts)
  const recentPages = Math.max(1, Math.ceil(sortedRecent.length / PER_PAGE))
  const recentPage = Math.min(page, recentPages - 1)
  const recent = sortedRecent.slice(recentPage * PER_PAGE, recentPage * PER_PAGE + PER_PAGE)

  return (
    <div className="view earnings">
      <div className="view-head">
        <div>
          <h1>EARNINGS</h1>
          <p className="view-sub">
            Every delivery you mark ✓ is logged here. A permanent income ledger — it persists even
            after you clear or remove the mission cards.
          </p>
        </div>
        {count > 0 && (
          <div className="row-actions">
            <button
              className="btn btn--danger"
              onClick={() => {
                if (window.confirm('Reset the entire earnings log? This cannot be undone.')) {
                  clearEarnings()
                }
              }}
            >
              Reset Log
            </button>
          </div>
        )}
      </div>

      {/* Live UEX commodity prices — above the earnings headings. */}
      <MarketBoard />

      {count === 0 ? (
        <div className="empty-state">
          <h2>No earnings logged yet</h2>
          <p className="muted">
            Go to Missions and mark a contract delivered (✓). It'll be logged here and charted over
            time.
          </p>
        </div>
      ) : (
        <>
          <div className="earnings-stats">
            <div className="earn-stat total">
              <span className="earn-stat-label">Total Earned</span>
              <span className="earn-stat-val">{total.toLocaleString()}</span>
              <span className="earn-stat-sub">aUEC</span>
            </div>
            <div className="earn-stat">
              <span className="earn-stat-label">Deliveries</span>
              <span className="earn-stat-val">{count}</span>
              <span className="earn-stat-sub">contracts completed</span>
            </div>
            <div className="earn-stat">
              <span className="earn-stat-label">Avg / Delivery</span>
              <span className="earn-stat-val">{short(avg)}</span>
              <span className="earn-stat-sub">aUEC per contract</span>
            </div>
            {rate !== null && (
              <div className="earn-stat">
                <span className="earn-stat-label">Today's Rate</span>
                <span className="earn-stat-val">{short(rate)}</span>
                <span className="earn-stat-sub">aUEC / hour</span>
              </div>
            )}
            {best && best.value > 0 && (
              <div className="earn-stat">
                <span className="earn-stat-label">Best {gran}</span>
                <span className="earn-stat-val">{short(best.value)}</span>
                <span className="earn-stat-sub">{best.label}</span>
              </div>
            )}
          </div>

          <div className="panel earn-chart-panel">
            <div className="earn-chart-head">
              <div>
                <h3 className="section-label">Earnings Over Time</h3>
                <span className="earn-chart-window">{GRAN_LABEL[gran]}</span>
              </div>
              <div className="toggle-group">
                {(['day', 'week', 'month'] as Gran[]).map((g) => (
                  <button
                    key={g}
                    className={`toggle ${gran === g ? 'on' : ''}`}
                    onClick={() => setGran(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="earn-chart-scroll">
              <EarningsChart buckets={buckets} />
            </div>
          </div>

          <div className="panel earn-recent">
            <h3 className="section-label">Recent Deliveries</h3>
            <div className="earn-recent-list">
              {recent.map((e) => (
                <div className="earn-recent-row" key={e.id}>
                  <span className="commodity-dot" style={{ background: commodityColor(e.commodity) }} />
                  <span className="earn-recent-commodity">{e.commodity}</span>
                  <span className="earn-recent-dest">→ {e.destination}</span>
                  {editId === e.id ? (
                    <input
                      className="earn-edit-input"
                      autoFocus
                      value={editVal}
                      onChange={(ev) => setEditVal(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') commitEdit(e.id)
                        if (ev.key === 'Escape') setEditId(null)
                      }}
                      onBlur={() => commitEdit(e.id)}
                    />
                  ) : (
                    <span className="earn-recent-reward">{e.reward.toLocaleString()} aUEC</span>
                  )}
                  <button
                    className="icon-btn earn-edit-btn"
                    title="Correct the payout (e.g. partial delivery paid less)"
                    onClick={() => {
                      setEditId(e.id)
                      setEditVal(String(e.reward))
                    }}
                  >
                    ✎
                  </button>
                  <span className="earn-recent-date">
                    {new Date(e.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
            <Pager page={recentPage} pages={recentPages} onPage={setPage} />
          </div>
        </>
      )}
    </div>
  )
}

function EarningsChart({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) return <p className="muted">Nothing to chart yet.</p>

  const max = Math.max(...buckets.map((b) => b.value), 1)
  const slot = 48
  const padL = 46
  const padR = 12
  const padT = 16
  const padB = 30
  const plotH = 200
  const W = Math.max(buckets.length * slot + padL + padR, 320)
  const H = plotH + padT + padB
  const barW = Math.min(slot * 0.56, 34)
  const grid = [0, 0.25, 0.5, 0.75, 1]
  // Show at most ~12 x-axis labels to avoid crowding (always show the last bucket).
  const step = Math.max(1, Math.ceil(buckets.length / 12))
  const showTopLabels = buckets.length <= 14

  return (
    <svg className="earn-chart" width={W} height={H} role="img" aria-label="Earnings over time">
      <defs>
        <linearGradient id="earnBar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cyan-bright)" />
          <stop offset="100%" stopColor="var(--cyan-dim)" />
        </linearGradient>
        <linearGradient id="earnBarNow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd27a" />
          <stop offset="100%" stopColor="var(--amber)" />
        </linearGradient>
      </defs>

      {/* horizontal grid + y labels */}
      {grid.map((f) => {
        const y = padT + plotH * (1 - f)
        return (
          <g key={f}>
            <line className="earn-grid-line" x1={padL} y1={y} x2={W - padR} y2={y} />
            <text className="earn-axis-text" x={padL - 8} y={y + 3} textAnchor="end">
              {short(max * f)}
            </text>
          </g>
        )
      })}

      {buckets.map((b, i) => {
        const isNow = i === buckets.length - 1
        const h = (b.value / max) * plotH
        const x = padL + i * slot + (slot - barW) / 2
        const y = padT + plotH - h
        const showLabel = i % step === 0 || isNow
        return (
          <g key={b.key} className="earn-bar-g">
            <title>{`${b.label}: ${b.value.toLocaleString()} aUEC`}</title>
            {b.value > 0 && (
              <rect
                className="earn-bar"
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 2)}
                rx={3}
                fill={isNow ? 'url(#earnBarNow)' : 'url(#earnBar)'}
              />
            )}
            {showTopLabels && b.value > 0 && (
              <text className="earn-bar-label" x={x + barW / 2} y={y - 5}>
                {short(b.value)}
              </text>
            )}
            {showLabel && (
              <text className="earn-x-label" x={x + barW / 2} y={H - 10}>
                {b.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
