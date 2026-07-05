/**
 * Live commodity market data from the UEX Corp public API (api.uexcorp.space) — the same
 * source and look as the commodity heatmap on uexcorp.space's homepage. The `/2.0/commodities`
 * endpoint's `price_sell` is exactly what the site shows (Agricium 9,585 → "AGRI 9.6K"), so the
 * grid here matches the site 1:1.
 *
 * Layout mirrors the site: every available commodity, alphabetical by code, each cell = CODE +
 * compact sell price (or "—" when it has no current sell price). Cells whose commodity can only
 * be SOLD (no buy price — mined ores, harvested gems, loot, drugs) are tinted red, like the site.
 *
 * Fetched LIVE while the app is open; the last good snapshot is cached in localStorage so the
 * grid still renders offline (with a "cached/offline" note).
 *
 * NOTE on the index: UEX's homepage "UEC IDX 636.42" is a proprietary purchasing-power index
 * (a fixed, undisclosed basket) and is NOT exposed by the public API — it can't be reproduced
 * exactly. The header shows an honest live gauge instead: the MEDIAN sell price per SCU across
 * priced commodities (median, not mean — a few rare goods sell for millions/SCU).
 */

const API = 'https://api.uexcorp.space/2.0'
const CACHE_KEY = 'uex-market-cache-v3' // v3: availPct is now supply level (buy stock vs average)
/** Re-fetch in the background when the cached snapshot is older than this. */
export const STALE_MS = 10 * 60 * 1000

export interface MarketItem {
  /** UEX short code, e.g. "AGRI". */
  code: string
  /** Full commodity name, e.g. "Agricium" — shown in the hover tooltip. */
  name: string
  /** Reference sell price per SCU (aUEC); 0 when the commodity has no current sell price. */
  priceSell: number
  /** True when the commodity can only be sold (no buy price) — tinted red, like the site. */
  sellOnly: boolean
  /**
   * Supply level: current buy stock as a % of its average (100 = normal, <100 scarce, >100
   * plentiful). 0 for sell-only goods (no buy terminals). Cells flip between price and this %
   * — uexcorp shows a similar varied %, but its exact formula isn't in the public API, so this
   * is the closest honest, varied equivalent (verified: price/stock deviations don't match).
   */
  availPct: number
}

export interface MarketSnapshot {
  /** Epoch ms when fetched. */
  ts: number
  items: MarketItem[]
  /** Median sell price per SCU across priced commodities (a live, outlier-resistant gauge). */
  index: number
}

interface MarketCache {
  current: MarketSnapshot
  previous: MarketSnapshot | null
}

interface RawCommodity {
  id: number
  name: string
  code: string
  price_buy: number
  price_sell: number
  is_available: number
  is_visible?: number
}

interface RawPriceRow {
  id_commodity: number
  price_buy: number
  scu_buy: number
  scu_buy_avg: number
}

/**
 * Supply level per commodity id from /commodities_prices_all: across terminals that BUY the
 * commodity (price_buy > 0), current buy stock as a % of its average (100 = normal). Varied and
 * meaningful; 0 for sell-only goods. Optional — if this heavier endpoint is unreachable the
 * board still works (supply just shows 0).
 */
async function fetchSupply(): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  try {
    const res = await fetch(`${API}/commodities_prices_all`)
    if (!res.ok) return map
    const json = await res.json()
    const rows: RawPriceRow[] = json?.data ?? json
    if (!Array.isArray(rows)) return map
    const tally = new Map<number, { now: number; avg: number }>()
    for (const r of rows) {
      if (!(r.price_buy > 0)) continue // only terminals you can BUY at
      const t = tally.get(r.id_commodity) ?? { now: 0, avg: 0 }
      t.now += r.scu_buy || 0
      t.avg += r.scu_buy_avg || 0
      tally.set(r.id_commodity, t)
    }
    for (const [id, t] of tally) {
      if (t.avg > 0) map.set(id, Math.min(999, Math.round((100 * t.now) / t.avg)))
    }
  } catch {
    /* offline / endpoint down — supply stays 0, prices still render */
  }
  return map
}

function median(nums: number[]): number {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Fetch the live commodity list and fold it into a snapshot. Throws on network/HTTP error. */
export async function fetchMarket(): Promise<MarketSnapshot> {
  const res = await fetch(`${API}/commodities`)
  if (!res.ok) throw new Error(`UEX API ${res.status}`)
  const json = await res.json()
  const raw: RawCommodity[] = json?.data ?? json
  if (!Array.isArray(raw)) throw new Error('UEX API: unexpected payload')

  const avail = await fetchSupply()

  // Every visible commodity (priced or not — the site shows "—" for unpriced ones). UEX lists
  // ore/refined variants that can share a code; dedupe by code, keeping the one with a real
  // sell price (the priciest), so e.g. AGRI shows the refined 9,585 not the 0-priced ore.
  const byCode = new Map<string, MarketItem>()
  for (const c of raw) {
    if (c.is_available !== 1 || c.is_visible === 0 || !c.code) continue
    const item: MarketItem = {
      code: c.code,
      name: c.name,
      priceSell: c.price_sell > 0 ? c.price_sell : 0,
      sellOnly: !(c.price_buy > 0),
      availPct: avail.get(c.id) ?? 0,
    }
    const existing = byCode.get(c.code)
    if (!existing || item.priceSell > existing.priceSell) byCode.set(c.code, item)
  }

  // Alphabetical by code — the site's grid order.
  const items = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
  const index = median(items.filter((i) => i.priceSell > 0).map((i) => i.priceSell))
  return { ts: Date.now(), items, index }
}

export function loadMarketCache(): MarketCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as MarketCache
    if (!c?.current?.items?.length) return null
    return c
  } catch {
    return null
  }
}

/**
 * Persist a fresh snapshot, rotating the prior CURRENT into PREVIOUS so movement can be shown.
 * Returns the new cache (so callers can use the rotated `previous` for deltas immediately).
 */
export function saveMarketCache(next: MarketSnapshot): MarketCache {
  const prior = loadMarketCache()
  const cache: MarketCache = { current: next, previous: prior?.current ?? null }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage full / unavailable — board still works from memory this session */
  }
  return cache
}

/** Compact aUEC price, e.g. 9585 → "9.6K", 1583870 → "1.6M", 982 → "982", 0 → "—". */
export function compactPrice(n: number): string {
  if (!(n > 0)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

/** "2m ago" / "3h ago" / "just now" from an epoch-ms timestamp. */
export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
