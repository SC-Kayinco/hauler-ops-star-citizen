import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useStore } from '@/store/useStore'
import {
  optimize,
  recommendShips,
  recommendLoadable,
  buildRoute,
  destinationColors,
} from '@/lib/optimizer'
import { optimizeRoute, type OptimizedRoute } from '@/lib/routeOptimizer'
import { effectivePickups, pickupAmountAt } from '@/lib/pickups'
import { canonicalLocation } from '@/data/locations'
import { accessLabel, flipX, flipZ, layerLabel, resolveBaseFace } from '@/lib/bayFace'
import { LOCATIONS } from '@/data/locations'
import CargoBay3D from './CargoBay3D'
import MarketBoard from '@/components/common/MarketBoard'
import { commodityCode } from '@/data/commodities'
import type { CargoBay, PlacedContainer, Ship } from '@/types'

export default function PlanView() {
  const ships = useStore((s) => s.ships)
  const missions = useStore((s) => s.missions)
  const maxBox = useStore((s) => s.maxBox)
  const groupMode = useStore((s) => s.groupMode)
  const selectedShipId = useStore((s) => s.selectedShipId)
  const selectShip = useStore((s) => s.selectShip)
  const setView = useStore((s) => s.setView)
  const removeMission = useStore((s) => s.removeMission)
  const reorderRoute = useStore((s) => s.reorderRoute)
  const containerSizes = useStore((s) => s.containerSizes)

  // Persisted in the store so the route panel survives tab switches and app restarts —
  // the player optimizes once and the route stays shown.
  const routeResult = useStore((s) => s.routeResult)
  const setRouteResult = useStore((s) => s.setRouteResult)

  // Only ACTIVE (undelivered) missions are planned. Delivered ones move to History and
  // free their space immediately — they no longer reserve slots, eat capacity, or appear
  // in the route. (Trade-off: marking a stop delivered re-packs the remaining cargo.)
  // All missions in this run (active, not fully completed). `runMissions` INCLUDES "dropped"
  // stops so the route/delivery lists keep showing them (greyed); `planMissions` excludes them
  // — dropped cargo has left the hold, so it's gone from packing / 3D / recommendations.
  const runMissions = useMemo(() => missions.filter((m) => m.scu > 0 && !m.done), [missions])
  const planMissions = useMemo(() => runMissions.filter((m) => !m.dropped), [runMissions])

  // Most common pickup origin across active missions — the smart default for "where am I"
  // (contracts are usually accepted at the station you're docked at).
  const pickupOrigin = useMemo(() => {
    const counts = new Map<string, number>()
    planMissions.forEach((m) => {
      if (m.origin) counts.set(m.origin, (counts.get(m.origin) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }, [planMissions])

  const currentLocation = useStore((s) => s.currentLocation)
  // Route start = the player's chosen location, falling back to the smart default.
  const routeStart = currentLocation || pickupOrigin

  function handleOptimizeRoute() {
    const dests = [...new Set(runMissions.map((m) => canonicalLocation(m.destination)))]
    // Stations cargo is collected from, honoring each mission's "where will you collect?"
    // choice — a leg the player pinned to one station drops its other stations here, so the
    // route won't send them somewhere no cargo is actually taken. The optimizer also drops
    // the station we're already at.
    const pickups = [...new Set(planMissions.flatMap((m) => effectivePickups(m)).filter(Boolean))]
    const result = optimizeRoute(dests, pickups, routeStart)
    reorderRoute(result.ordered)
    setRouteResult(result)
  }
  const ship = ships.find((sh) => sh.id === selectedShipId)

  // Acquisition order per mission, derived from the optimized route's pickup stops:
  // 0 = its cargo is at the start location (or no route computed yet); otherwise the
  // index of the EARLIEST pickup stop the mission touches. We use the earliest (min), not
  // the last, because you start placing a mission's cargo the moment you first collect any
  // of it — so multi-pickup cargo whose first source is stop 1 packs DEEP/inner (loaded
  // first), not pushed outward as if it only existed after the last stop. Feeds the packer
  // so early-acquired cargo sits deep/against-the-surface and late-acquired nearer the door.
  const pickupRankByMission = useMemo(() => {
    if (!routeResult) return undefined
    const rankByStation = new Map<string, number>()
    routeResult.stops
      .filter((s) => s.kind === 'pickup')
      .forEach((s, i) => rankByStation.set(s.destination, i + 1))
    const byMission: Record<string, number> = {}
    for (const m of planMissions) {
      const stations = effectivePickups(m)
      const ranks = stations.map((st) => rankByStation.get(st)).filter((r): r is number => r != null)
      byMission[m.id] = ranks.length ? Math.min(...ranks) : 0
    }
    return byMission
  }, [routeResult, planMissions])

  const plan = useMemo(
    () =>
      ship
        ? optimize(ship, planMissions, maxBox, groupMode, containerSizes, pickupRankByMission)
        : null,
    [ship, planMissions, maxBox, groupMode, containerSizes, pickupRankByMission],
  )
  const recs = useMemo(
    () => recommendShips(ships, planMissions, maxBox, containerSizes),
    [ships, planMissions, maxBox, containerSizes],
  )
  const route = useMemo(() => buildRoute(runMissions), [runMissions])
  const destColors = destinationColors(route)
  const advisor = useMemo(
    () =>
      ship
        ? recommendLoadable(ship, planMissions, maxBox, groupMode, containerSizes, pickupRankByMission)
        : null,
    [ship, planMissions, maxBox, groupMode, containerSizes, pickupRankByMission],
  )

  if (runMissions.length === 0) {
    return (
      <div className="view empty-state">
        <h2>No active missions</h2>
        <p className="muted">Add hauling contracts first, then come back to build a load plan.</p>
        <button className="btn btn--primary" onClick={() => setView('missions')}>
          Go to Missions
        </button>
      </div>
    )
  }

  const demand = planMissions.reduce((s, m) => s + m.scu, 0)

  return (
    <div className="view plan">
      <div className="view-head">
        <div>
          <h1>LOAD PLAN</h1>
          <p className="view-sub">
            {demand} SCU across {route.length} stops. Containers colored by destination; load deep
            first, unload nearest-door first.
          </p>
        </div>
      </div>

      {/* Live UEX commodity prices — above the ship picker. */}
      <MarketBoard />

      {/* Ship recommender */}
      <div className="rec-strip">
        {recs.slice(0, 6).map(({ ship: s, fits, slack }) => (
          <button
            key={s.id}
            className={`rec-card ${s.id === selectedShipId ? 'active' : ''} ${fits ? 'fits' : 'nofit'}`}
            style={{ '--accent': s.accent ?? '#4db8e8' } as CSSProperties}
            onClick={() => selectShip(s.id)}
          >
            <span className="rec-badge">{fits ? 'FITS' : 'TIGHT'}</span>
            <span className="rec-name">{s.name}</span>
            <span className="rec-cargo">{s.cargoScu} SCU</span>
            {fits && slack >= 0 && <span className="rec-slack">{slack} SCU spare</span>}
            {!fits && <span className="rec-slack short">needs more room</span>}
          </button>
        ))}
      </div>

      {!ship || !plan ? (
        <p className="muted">Select a ship above to plan the load.</p>
      ) : (
        <PlanForShip
          ship={ship}
          plan={plan}
          destColors={destColors}
          route={route}
          advisor={advisor}
          totalReward={planMissions.reduce((s, m) => s + (m.reward ?? 0), 0)}
          onDrop={removeMission}
          routeResult={routeResult}
          routeOrigin={routeStart}
          autoDefault={pickupOrigin}
          onOptimize={handleOptimizeRoute}
        />
      )}
    </div>
  )
}

function PlanForShip({
  ship,
  plan,
  destColors,
  route,
  advisor,
  totalReward,
  onDrop,
  routeResult,
  routeOrigin,
  autoDefault,
  onOptimize,
}: {
  ship: Ship
  plan: ReturnType<typeof optimize>
  destColors: Record<string, string>
  route: string[]
  advisor: ReturnType<typeof recommendLoadable> | null
  totalReward: number
  onDrop: (id: string) => void
  routeResult: OptimizedRoute | null
  routeOrigin: string
  /** Placeholder for the location picker — the auto-detected start (most common pickup). */
  autoDefault: string
  /** Recompute the QT route (button lives in the Route panel header). */
  onOptimize: () => void
}) {
  const groupMode = useStore((s) => s.groupMode)
  const setGroupMode = useStore((s) => s.setGroupMode)
  const [selected, setSelected] = useState<string[]>([])
  const toggleStation = (d: string) =>
    setSelected((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))

  // Pickup-stop inspector: click a PICKUP row in the route → list what to collect
  // there and highlight those boxes in the 3D hold + 2D maps.
  const [selectedPickup, setSelectedPickup] = useState<string | null>(null)
  // Within a pickup, optionally narrow to ONE contract's cargo (so you can pull just that
  // mission's boxes up the elevator and slot them, instead of all 470 SCU at once).
  const [selectedPickupGroup, setSelectedPickupGroup] = useState<string | null>(null)
  const togglePickup = (station: string) =>
    setSelectedPickup((cur) => {
      setSelectedPickupGroup(null) // reset the per-contract narrowing when switching stops
      return cur === station ? null : station
    })
  // Click a Q1/Q2 sub-row under a pickup → isolate that one contract at that stop (toggle off
  // to return to the whole stop).
  const selectPickupGroup = (station: string, key: string) => {
    setSelectedPickup(station)
    setSelectedPickupGroup((cur) => (selectedPickup === station && cur === key ? null : key))
  }

  // Manual 3D layout overrides (per ship) applied on top of the optimizer's placement.
  const moveContainer = useStore((s) => s.moveContainer)
  const clearShipLayout = useStore((s) => s.clearShipLayout)
  const overrides = useStore((s) => s.manualLayout[ship.id])
  // Missions feed the multi-pickup "where will you collect?" choice into scuByStop / routing.
  const missions = useStore((s) => s.missions)
  const setDropped = useStore((s) => s.setDropped)
  // Which contract each mission leg belongs to (for splitting a pickup by contract). A
  // standalone mission is its own group.
  const contractOfMission = useMemo(() => {
    const m = new Map<string, { key: string; title: string }>()
    for (const mi of missions)
      m.set(mi.id, { key: mi.contractId ?? mi.id, title: mi.title || mi.commodity || 'Contract' })
    return m
  }, [missions])
  const groupKeyOf = (p: PlacedContainer) => contractOfMission.get(p.missionId)?.key ?? p.missionId

  // Which delivery stops are marked "dropped" (cargo delivered, removed from hold). Keyed by
  // canonical destination; a stop counts as dropped when ALL its active legs are. The checkbox
  // in the Route/Delivery lists flips every leg of that stop.
  const droppedByDest = useMemo(() => {
    const map = new Map<string, { ids: string[]; dropped: number; total: number }>()
    for (const m of missions) {
      if (m.scu <= 0 || m.done) continue
      const d = canonicalLocation(m.destination)
      const e = map.get(d) ?? { ids: [], dropped: 0, total: 0 }
      e.ids.push(m.id)
      e.total++
      if (m.dropped) e.dropped++
      map.set(d, e)
    }
    return map
  }, [missions])
  const isDropped = (dest: string) => {
    const e = droppedByDest.get(dest)
    return !!e && e.total > 0 && e.dropped === e.total
  }
  const toggleDropped = (dest: string) => {
    const e = droppedByDest.get(dest)
    if (e) setDropped(e.ids, !isDropped(dest))
  }
  const placed = useMemo(() => {
    if (!overrides) return plan.placed
    return plan.placed.map((c) => {
      const o = overrides[c.key]
      if (!o) return c
      if ('floored' in o) return { ...c, floored: true, fx: o.fx, fz: o.fz }
      return { ...c, bayId: o.bayId, x: o.x, y: o.y, z: o.z, floored: false }
    })
  }, [plan.placed, overrides])

  // "Loaded" checklist — PERSISTED in the store by stable container key (missionId:boxIdx)
  // so it survives app/game crashes mid-loading. Both the 3D hold and the 2D bay maps
  // read/write the same set; container ids are remapped to keys here because ids are
  // regenerated on every re-optimize while keys stay stable.
  const loadedKeys = useStore((s) => s.loadedKeys)
  const setLoadedKey = useStore((s) => s.setLoadedKey)
  const keyById = useMemo(() => new Map(placed.map((p) => [p.id, p.key])), [placed])
  const loaded = useMemo(() => {
    const keys = new Set(loadedKeys)
    return new Set(placed.filter((p) => keys.has(p.key)).map((p) => p.id))
  }, [placed, loadedKeys])
  const toggleLoaded = (id: string) => {
    const key = keyById.get(id)
    if (key) setLoadedKey(key, !loaded.has(id))
  }
  // Explicit set (used by 2D drag-painting so a sweep doesn't flip-flop multi-cell boxes).
  const setLoadedFor = (id: string, value: boolean) => {
    const key = keyById.get(id)
    if (key) setLoadedKey(key, value)
  }

  // Only cargo still aboard (delivered containers are gone; the rest keep their slots).
  const aboard = placed.filter((p) => !p.delivered)

  // SCU per route stop: pickups = what you collect there, deliveries = what you drop.
  // (QT minute estimates were wildly off, so the route shows cargo amounts instead.)
  //
  // Multi-pickup legs aren't counted in full at every station (that double-counts). Per
  // pickupAmountAt: a leg pinned to one station counts there; a split leg counts its entered
  // per-station amount; an un-chosen leg counts ONCE at its earliest pickup. The "where will
  // you collect?" choice itself is made on the Missions page.
  const scuByStop = useMemo(() => {
    const map = new Map<string, number>()
    if (!routeResult) return map

    const missionById = new Map(missions.map((m) => [m.id, m]))
    const aboardScuByMission = new Map<string, number>()
    for (const p of aboard)
      aboardScuByMission.set(p.missionId, (aboardScuByMission.get(p.missionId) ?? 0) + p.scu)

    const pickupOrder = new Map<string, number>()
    routeResult.stops
      .filter((s) => s.kind === 'pickup')
      .forEach((s, i) => pickupOrder.set(s.destination, i))
    // Earliest effective pickup (by route order) per mission — where an un-chosen leg counts once.
    const earliestByMission = new Map<string, string>()
    for (const mid of aboardScuByMission.keys()) {
      const m = missionById.get(mid)
      if (!m) continue
      const eff = effectivePickups(m)
        .filter((st) => pickupOrder.has(st))
        .sort((a, b) => pickupOrder.get(a)! - pickupOrder.get(b)!)
      if (eff.length) earliestByMission.set(mid, eff[0])
    }

    for (const s of routeResult.stops) {
      let sum = 0
      if (s.kind === 'dropoff') {
        sum = aboard.filter((p) => p.destination === s.destination).reduce((a, p) => a + p.scu, 0)
      } else {
        for (const [mid, total] of aboardScuByMission) {
          const m = missionById.get(mid)
          if (!m) continue
          sum += pickupAmountAt(m, s.destination, total, (st) => earliestByMission.get(mid) === st)
        }
      }
      map.set(`${s.kind}:${s.destination}`, sum)
    }
    return map
  }, [routeResult, aboard, missions])

  // Route order index of each pickup station (for earliest-pickup attribution below).
  const pickupRouteOrder = useMemo(() => {
    const m = new Map<string, number>()
    routeResult?.stops
      .filter((s) => s.kind === 'pickup')
      .forEach((s, i) => m.set(s.destination, i))
    return m
  }, [routeResult])

  // Which station each mission's cargo is COLLECTED at — one station per mission so the
  // pickup highlight & "loaded ✓" checkbox don't bleed across stops. A mission whose pickup
  // is resolved (single station, or an explicit split) uses its chosen station(s); an
  // un-chosen multi-pickup mission is attributed to its EARLIEST pickup in route order (the
  // same rule scuByStop uses to count it once), NOT to every station it lists. Without this,
  // a leg that lists all 4 stations made ticking ONE pickup tick them all.
  const collectStationsByMission = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const m of missions) {
      const eff = effectivePickups(m)
      if (eff.length <= 1 || m.pickupChoice) {
        map.set(m.id, eff)
        continue
      }
      const earliest = [...eff]
        .filter((st) => pickupRouteOrder.has(st))
        .sort((a, b) => pickupRouteOrder.get(a)! - pickupRouteOrder.get(b)!)[0]
      map.set(m.id, [earliest ?? eff[0]])
    }
    return map
  }, [missions, pickupRouteOrder])
  const boxesAtStation = (station: string) =>
    aboard.filter((p) =>
      (collectStationsByMission.get(p.missionId) ?? p.pickupStations ?? (p.origin ? [p.origin] : [])).includes(
        station,
      ),
    )
  // PICKUP-row "loaded ✓" checkbox: marks every box collected at this stop as loaded (reuses the
  // 3D/2D loaded checklist) — it does NOT remove cargo, just records you've got it aboard.
  const isPickupLoaded = (station: string) => {
    const boxes = boxesAtStation(station)
    return boxes.length > 0 && boxes.every((p) => loaded.has(p.id))
  }
  const togglePickupLoaded = (station: string) => {
    const value = !isPickupLoaded(station)
    boxesAtStation(station).forEach((p) => setLoadedFor(p.id, value))
  }

  // All boxes collected at the selected stop (drives the COLLECT list + its contract split).
  const stationBoxes = useMemo(
    () => (selectedPickup ? boxesAtStation(selectedPickup) : []),
    [aboard, selectedPickup, collectStationsByMission],
  )
  // Boxes the 3D/2D should isolate: the whole stop, or just one contract within it.
  const pickupBoxes = useMemo(
    () => (selectedPickupGroup ? stationBoxes.filter((p) => groupKeyOf(p) === selectedPickupGroup) : stationBoxes),
    [stationBoxes, selectedPickupGroup, contractOfMission],
  )
  const pickupIds = useMemo(
    () => (selectedPickup ? new Set(pickupBoxes.map((p) => p.id)) : undefined),
    [pickupBoxes, selectedPickup],
  )

  // Per-pickup contract sub-groups (Q1/Q2…) shown as sub-rows in the route list. A stop with
  // >1 contract collected there splits so you can isolate and elevator up one mission at a time.
  const pickupGroupsByStation = useMemo(() => {
    const map = new Map<string, { key: string; title: string; scu: number; count: number; dests: string[] }[]>()
    if (!routeResult) return map
    for (const stop of routeResult.stops) {
      if (stop.kind !== 'pickup') continue
      const g = new Map<string, { key: string; title: string; scu: number; count: number; dests: Set<string> }>()
      for (const p of boxesAtStation(stop.destination)) {
        const key = groupKeyOf(p)
        const e =
          g.get(key) ??
          { key, title: contractOfMission.get(p.missionId)?.title ?? 'Contract', scu: 0, count: 0, dests: new Set<string>() }
        e.scu += p.scu
        e.count++
        e.dests.add(p.destination)
        g.set(key, e)
      }
      map.set(stop.destination, [...g.values()].map((e) => ({ ...e, dests: [...e.dests] })))
    }
    return map
  }, [routeResult, aboard, collectStationsByMission, contractOfMission])

  // Label of the isolated contract (for the COLLECT header) — its index + title at the stop.
  const selectedPickupGroupLabel = useMemo(() => {
    if (!selectedPickup || !selectedPickupGroup) return undefined
    const groups = pickupGroupsByStation.get(selectedPickup) ?? []
    const idx = groups.findIndex((g) => g.key === selectedPickupGroup)
    return idx >= 0 ? `Q${idx + 1} ${groups[idx].title}` : undefined
  }, [selectedPickup, selectedPickupGroup, pickupGroupsByStation])
  const inFilter = (p: PlacedContainer) => selected.length === 0 || selected.includes(p.destination)
  const loadSeq = [...aboard].filter(inFilter).sort((a, b) => a.loadOrder - b.loadOrder)
  const unloadSeq = [...aboard].filter(inFilter).sort((a, b) => a.unloadOrder - b.unloadOrder)
  const aboardScu = aboard.reduce((s, p) => s + p.scu, 0)
  const deliveredCount = placed.length - aboard.length

  return (
    <>
      <div className="plan-summary panel">
        <div className="plan-summary-main">
          <div className="ps-stat">
            <span className="hud-label">Ship</span>
            <span className="ps-val">{ship.name}</span>
          </div>
          <div className="ps-stat">
            <span className="hud-label">Aboard</span>
            <span className="ps-val">
              {aboardScu} / {ship.cargoScu} SCU
            </span>
          </div>
          <div className="ps-stat">
            <span className="hud-label">Containers</span>
            <span className="ps-val">{aboard.length}</span>
          </div>
          {deliveredCount > 0 && (
            <div className="ps-stat">
              <span className="hud-label">Delivered</span>
              <span className="ps-val good">{deliveredCount}</span>
            </div>
          )}
          <div className="ps-stat">
            <span className="hud-label">Fill</span>
            <span className="ps-val">{Math.round((aboardScu / ship.cargoScu) * 100)}%</span>
          </div>
          <div className="ps-stat">
            <span className="hud-label">Reward</span>
            <span className="ps-val good">{totalReward.toLocaleString()} aUEC</span>
          </div>
        </div>
        {plan.warnings.length > 0 && (
          <ul className="plan-warnings">
            {plan.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>

      {advisor && !advisor.allFit && (
        <div className="advisor panel">
          <h3 className="section-label warn">⚠ {ship.name} can't load everything</h3>
          <p className="muted sm">
            {advisor.demand} SCU requested — only {advisor.keptScu} SCU actually packs into {ship.name}
            . Suggested plan (keeps the highest-value missions that fit):
          </p>
          <div className="advisor-cols">
            <div className="advisor-col keep">
              <span className="hud-label">
                ✓ Load {advisor.keep.length} · {advisor.keptReward.toLocaleString()} aUEC
              </span>
              {advisor.keep.map((m) => (
                <div className="advisor-row" key={m.id}>
                  <span className="commodity-dot" style={{ background: destColors[m.destination] ?? '#4db8e8' }} />
                  <span>
                    {m.commodity} <span className="muted">{m.scu} SCU → {m.destination}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="advisor-col drop">
              <div className="advisor-col-head">
                <span className="hud-label">
                  ✕ Drop {advisor.drop.length} · {advisor.droppedReward.toLocaleString()} aUEC
                </span>
                {advisor.drop.length > 0 && (
                  <button className="btn btn--sm btn--danger" onClick={() => advisor.drop.forEach((m) => onDrop(m.id))}>
                    Drop all
                  </button>
                )}
              </div>
              {advisor.drop.map((m) => (
                <div className="advisor-row" key={m.id}>
                  <span>
                    {m.commodity} <span className="muted">{m.scu} SCU → {m.destination}</span>
                  </span>
                  <button className="btn btn--sm btn--danger" onClick={() => onDrop(m.id)}>
                    Drop
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 70/30: the hold on the left, route/delivery/sequence rail on the right */}
      <div className="plan-layout">
        <div className="plan-main">
          <div className="cargo3d-wrap panel">
            <CargoBay3D
              bays={ship.bays}
              placed={placed}
              highlight={selected}
              highlightIds={pickupIds}
              destColors={destColors}
              accent={ship.accent}
              onMove={(key, pos) => moveContainer(ship.id, key, pos)}
              onResetLayout={overrides ? () => clearShipLayout(ship.id) : undefined}
              loaded={loaded}
              onToggleLoad={toggleLoaded}
            />
            <span className="holo-hint hud-label">
              Drag to orbit · scroll to zoom · box labels show the commodity & size
            </span>
          </div>

          {/* Bay maps (flat reference) */}
          <div className="bay-maps">
            {ship.bays.map((bay) => (
              <BayMap
                key={bay.id}
                bay={bay}
                containers={placed.filter((p) => p.bayId === bay.id && !p.floored)}
                highlight={selected}
                highlightIds={pickupIds}
                loaded={loaded}
                onSetLoad={setLoadedFor}
              />
            ))}
          </div>

          {plan.unplaced.length > 0 && (
            <div className="panel unplaced">
              <h3 className="section-label warn">Did Not Fit ({plan.unplaced.length})</h3>
              <div className="unplaced-list">
                {plan.unplaced.map((u, i) => (
                  <span className="box-chip warn" key={i}>
                    {u.scu} SCU {u.commodity} → {u.destination}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="plan-side">
          <div className="panel plan-groupby">
            <span className="hud-label">Group by</span>
            <div className="toggle-group">
              <button
                className={`toggle ${groupMode === 'destination' ? 'on' : ''}`}
                onClick={() => setGroupMode('destination')}
              >
                Destination
              </button>
              <button
                className={`toggle ${groupMode === 'commodity' ? 'on' : ''}`}
                onClick={() => setGroupMode('commodity')}
              >
                Commodity
              </button>
            </div>
          </div>
          <div className="panel side-panel">
            <h3 className="section-label route-head">
              <span>
                <span className="side-step">1</span> Route
              </span>
              <button
                className="btn btn--sm optimize-btn"
                onClick={onOptimize}
                title="Recompute the shortest QT route through your pickups & deliveries"
              >
                ✦ Optimize
              </button>
            </h3>
            <div className="route-list">
              <LocationPicker autoDefault={autoDefault} placeholderOrigin={routeOrigin} />
              {routeResult ? (
                <RouteList
                  result={routeResult}
                  scuByStop={scuByStop}
                  selectedPickup={selectedPickup}
                  onTogglePickup={togglePickup}
                  isPickupLoaded={isPickupLoaded}
                  onTogglePickupLoaded={togglePickupLoaded}
                  groupsForStation={(s) => pickupGroupsByStation.get(s) ?? []}
                  selectedPickupGroup={selectedPickupGroup}
                  onSelectGroup={selectPickupGroup}
                />
              ) : (
                <p className="muted sm">Hit "✦ Optimize" to compute the QT route.</p>
              )}
            </div>
            {selectedPickup && (
              <PickupList
                station={selectedPickup}
                boxes={pickupBoxes}
                loaded={loaded}
                scopeLabel={selectedPickupGroupLabel}
              />
            )}
          </div>

          <div className="panel side-panel">
            <h3 className="section-label">
              <span className="side-step">2</span> Delivery
            </h3>
            <p className="muted sm">Tap the stop you're at; its cargo blinks in 3D.</p>
            <div className="station-btns station-btns--vertical">
              <button
                className={`station-btn ${selected.length === 0 ? 'on' : ''}`}
                onClick={() => setSelected([])}
              >
                Show all
              </button>
              {route.map((d, i) => (
                <div key={d} className={`station-row ${isDropped(d) ? 'dropped' : ''}`}>
                  <button
                    className={`station-btn ${selected.includes(d) ? 'on' : ''}`}
                    style={{ '--accent': destColors[d] } as CSSProperties}
                    onClick={() => toggleStation(d)}
                  >
                    <span className="legend-num">{i + 1}</span> {d}
                  </button>
                  <label
                    className="deliver-check"
                    title="Mark delivered here — drops this stop's cargo from the hold. No payout (the contract pays once all its stops are done). Click again to undo."
                  >
                    <input
                      type="checkbox"
                      checked={isDropped(d)}
                      onChange={() => toggleDropped(d)}
                    />
                  </label>
                </div>
              ))}
            </div>
            {selected.length > 0 && <DropList stations={selected} placed={placed} />}
          </div>

          <div className="panel side-panel">
            <h3 className="section-label">
              <span className="side-step">3</span> Loading / Unloading
            </h3>
            <div className="seq-stack">
              <SequenceList
                title="Loading Sequence"
                subtitle="Carry these in first → last. Deep/back boxes first."
                items={loadSeq}
                showPickup={new Set(loadSeq.map((p) => p.origin)).size > 1}
              />
              <SequenceList
                title="Unloading Sequence"
                subtitle="By stop, in route order. Nearest-door boxes come out first."
                items={unloadSeq}
                showStop
              />
            </div>
          </div>
        </aside>
      </div>
    </>
  )
}

function DropList({ stations, placed }: { stations: string[]; placed: PlacedContainer[] }) {
  const items = placed.filter((p) => stations.includes(p.destination) && !p.delivered)
  const totalScu = items.reduce((s, p) => s + p.scu, 0)
  // Group identical boxes: "3× 8 SCU Titanium (Ore)".
  const groups = new Map<string, { commodity: string; scu: number; count: number }>()
  for (const p of items) {
    const k = `${p.commodity}|${p.scu}`
    const g = groups.get(k) ?? { commodity: p.commodity, scu: p.scu, count: 0 }
    g.count++
    groups.set(k, g)
  }

  return (
    <div className="drop-list panel">
      <h4 className="section-label">
        Drop at {stations.join(' + ')} — {items.length} container(s), {totalScu} SCU
      </h4>
      <div className="drop-items">
        {[...groups.values()].map((g, i) => (
          <span className="box-chip" key={i}>
            {g.count}× {g.scu} SCU {g.commodity}
          </span>
        ))}
      </div>
      <p className="muted sm">Blinking boxes in the hold above are the ones to unload here.</p>
    </div>
  )
}

function BayMap({
  bay,
  containers,
  highlight,
  highlightIds,
  loaded,
  onSetLoad,
}: {
  bay: CargoBay
  containers: PlacedContainer[]
  highlight: string[]
  /** Specific container ids to highlight (pickup-stop mode). */
  highlightIds?: Set<string>
  /** Shared "loaded" checklist (container ids). Click a cell to toggle; press-and-drag to sweep
   *  many at once. ✓ shown when loaded. */
  loaded: Set<string>
  onSetLoad: (id: string, value: boolean) => void
}) {
  // Drag-to-paint: the first cell you press sets the mode (add if it wasn't loaded, else remove);
  // dragging over more cells applies the SAME mode (so a sweep never flip-flops a multi-cell box).
  const [paint, setPaint] = useState<boolean | null>(null)
  useEffect(() => {
    if (paint === null) return
    const stop = () => setPaint(null)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [paint])

  const startPaint = (id: string) => {
    const mode = !loaded.has(id)
    setPaint(mode)
    onSetLoad(id, mode)
  }
  const dragOver = (id: string) => {
    if (paint !== null) onSetLoad(id, paint)
  }
  // Build per-layer cell maps: layer -> "x,z" -> {container, isOrigin}
  const layers: Record<number, Map<string, { c: PlacedContainer; origin: boolean }>> = {}
  for (let y = 0; y < bay.maxStackHeight; y++) layers[y] = new Map()

  for (const c of containers) {
    if (c.delivered) continue
    for (let yy = c.y; yy < c.y + c.footprint.h; yy++) {
      for (let zz = c.z; zz < c.z + c.footprint.l; zz++) {
        for (let xx = c.x; xx < c.x + c.footprint.w; xx++) {
          // Origin = the box's corner cell WITHIN this layer, so multi-layer boxes
          // (8+ SCU are h=2) get their label/✓ on every layer they fill, not just the floor.
          const origin = zz === c.z && xx === c.x
          layers[yy]?.set(`${xx},${zz}`, { c, origin })
        }
      }
    }
  }

  const cell = Math.max(14, Math.min(30, Math.floor(420 / Math.max(bay.width, bay.length))))

  return (
    <div className="bay-map panel">
      <div className="bay-map-head">
        <h4>{bay.name}</h4>
        <span className="hud-label">
          {bay.width}×{bay.length}×{bay.maxStackHeight}
          {bay.mount && bay.mount !== 'floor' ? ` · ${bay.mount}` : ''}
          {bay.maxContainerScu ? ` · max ${bay.maxContainerScu} SCU` : ''}
        </span>
      </div>
      <div className="bay-layers">
        {Array.from({ length: bay.maxStackHeight }, (_, y) => bay.maxStackHeight - 1 - y).map((y) => (
          <div className="bay-layer" key={y}>
            <span className="layer-label hud-label">{layerLabel(y, resolveBaseFace(bay))}</span>
            <div className="layer-grid">
              {Array.from({ length: bay.length }, (_, z) => (
                <div className="cell-row" key={z}>
                  {Array.from({ length: bay.width }, (_, x) => {
                    // Mirror the data cell when this bay's fill direction is flipped, so the 2D
                    // map shows cargo anchored where it really attaches (e.g. ceiling-down racks).
                    const ax = flipX(bay, x)
                    const az = flipZ(bay, z)
                    const blocked = bay.blockedCells.includes(`${ax},${az}`)
                    const occ = layers[y].get(`${ax},${az}`)
                    const hot =
                      occ && (highlight.includes(occ.c.destination) || highlightIds?.has(occ.c.id))
                    const isLoaded = occ ? loaded.has(occ.c.id) : false
                    return (
                      <div
                        key={x}
                        className={`map-cell ${blocked ? 'blocked' : ''} ${occ ? 'filled' : ''} ${hot ? 'hot' : ''} ${isLoaded ? 'loaded' : ''}`}
                        style={{
                          width: cell,
                          height: cell,
                          background: occ ? occ.c.color : undefined,
                          borderColor: occ ? occ.c.color : undefined,
                        }}
                        title={
                          occ
                            ? `${occ.c.commodity} ${occ.c.scu} SCU → ${occ.c.destination}\nClick (or drag across) to mark ${isLoaded ? 'NOT loaded' : 'loaded'}`
                            : ''
                        }
                        onPointerDown={
                          occ
                            ? (e) => {
                                e.preventDefault()
                                startPaint(occ.c.id)
                              }
                            : undefined
                        }
                        onPointerEnter={occ ? () => dragOver(occ.c.id) : undefined}
                        role={occ ? 'button' : undefined}
                      >
                        {occ?.origin && (
                          <span className="map-cell-label">
                            {commodityCode(occ.c.commodity)}
                            <span className="map-cell-scu">{occ.c.scu}</span>
                          </span>
                        )}
                        {occ?.origin && isLoaded && <span className="map-cell-check">✓</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="door-strip hud-label">{accessLabel(bay)}</div>
    </div>
  )
}

interface SeqGroup {
  key: string
  count: number
  scu: number
  commodity: string
  destination: string
  origin?: string
  color: string
  first: PlacedContainer
}

/**
 * Collapse a run of identical containers (same commodity + size + destination) into
 * one step, e.g. ten 8-SCU Titanium boxes → "10× 8 SCU". Items must already be sorted
 * by load/unload order so each run stays contiguous.
 */
function groupSequence(items: PlacedContainer[]): SeqGroup[] {
  const groups: SeqGroup[] = []
  for (const c of items) {
    const last = groups[groups.length - 1]
    if (
      last &&
      last.commodity === c.commodity &&
      last.scu === c.scu &&
      last.destination === c.destination &&
      last.origin === c.origin
    ) {
      last.count++
    } else {
      groups.push({
        key: c.id,
        count: 1,
        scu: c.scu,
        commodity: c.commodity,
        destination: c.destination,
        origin: c.origin,
        color: c.color,
        first: c,
      })
    }
  }
  return groups
}

function SequenceList({
  title,
  subtitle,
  items,
  showStop,
  showPickup,
}: {
  title: string
  subtitle: string
  items: PlacedContainer[]
  showStop?: boolean
  /** Show where each box is collected (loading list, multi-station runs). */
  showPickup?: boolean
}) {
  const groups = groupSequence(items)
  return (
    <section className="panel seq-list">
      <h3 className="section-label">{title}</h3>
      <p className="muted sm">{subtitle}</p>
      <ol className="seq-items">
        {groups.map((g, i) => (
          <li className="seq-item" key={g.key}>
            <span className="seq-num" style={{ background: g.color }}>
              {i + 1}
            </span>
            <span className="seq-box">
              {g.count}× {g.scu} SCU
            </span>
            <span className="seq-commodity">{g.commodity}</span>
            {showPickup && g.origin && (
              <span className="seq-pickup hud-label">PICKUP: {g.origin}</span>
            )}
            <span className="seq-route">
              <span className="seq-dest">→ {g.destination}</span>
              {!showStop && g.count === 1 && (
                <span className="seq-pos hud-label">
                  {`x${g.first.x} z${g.first.z}${g.first.y > 0 ? ` L${g.first.y + 1}` : ''}`}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * The route's START row, doubling as the "where am I" picker: a free-text input backed by a
 * <datalist> so typing filters the location list natively (no extra dependency). Favorites
 * are listed first; ★ pins/unpins the current value. Empty = auto — the input shows the
 * auto-detected start (`placeholderOrigin`, the most common pickup) as the placeholder, so
 * the row always reads as the route's starting point.
 */
function LocationPicker({
  autoDefault,
  placeholderOrigin,
}: {
  autoDefault: string
  /** The resolved start shown when nothing is typed (= currentLocation || autoDefault). */
  placeholderOrigin: string
}) {
  const currentLocation = useStore((s) => s.currentLocation)
  const setCurrentLocation = useStore((s) => s.setCurrentLocation)
  const favoriteLocations = useStore((s) => s.favoriteLocations)
  const toggleFavoriteLocation = useStore((s) => s.toggleFavoriteLocation)

  // De-duplicate: a few UEX names repeat across systems (e.g. "Jumptown"), which would
  // collide as <option>/<datalist> React keys.
  const names = [...new Set(LOCATIONS.map((l) => l.name))]
  const favs = favoriteLocations.filter((f) => names.includes(f))
  const rest = names.filter((n) => !favs.includes(n))
  const selected = currentLocation || ''
  const isFav = selected !== '' && favoriteLocations.includes(selected)
  const placeholder = placeholderOrigin || autoDefault || 'Set your start location…'

  return (
    <div className="route-row route-row--origin loc-row">
      <span className="route-row-num" title="Start of the route">
        ◈
      </span>
      <input
        className="loc-input loc-input--route"
        list="hauler-locations"
        placeholder={placeholder}
        value={selected}
        onChange={(e) => setCurrentLocation(e.target.value)}
        title="Your starting location. Type to search / pick from the list. Leave empty = auto (most common pickup)."
      />
      <datalist id="hauler-locations">
        {favs.map((n) => (
          <option key={n} value={n}>
            ★ favorite
          </option>
        ))}
        {rest.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <button
        className={`icon-btn loc-fav-btn ${isFav ? 'on' : ''}`}
        title={
          selected === ''
            ? 'Type or pick a location, then ★ to save it as a favorite'
            : isFav
              ? 'Remove from favorites'
              : 'Add to favorites'
        }
        disabled={selected === ''}
        onClick={() => selected !== '' && toggleFavoriteLocation(selected)}
      >
        {isFav ? '★' : '☆'}
      </button>
      {selected !== '' && (
        <button
          className="icon-btn loc-clear-btn"
          title="Clear (back to auto)"
          onClick={() => setCurrentLocation('')}
        >
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * Vertical, numbered route: start → PICKUP stops only (deliveries live in the Delivery
 * section). PICKUP rows are clickable — selecting one lists what to collect there and
 * highlights those boxes — and carry a "loaded ✓" checkbox for the whole stop.
 */
function RouteList({
  result,
  scuByStop,
  selectedPickup,
  onTogglePickup,
  isPickupLoaded,
  onTogglePickupLoaded,
  groupsForStation,
  selectedPickupGroup,
  onSelectGroup,
}: {
  result: OptimizedRoute
  /** SCU handled at each stop, keyed `kind:destination` — collect amount for pickups, drop amount for deliveries. */
  scuByStop: Map<string, number>
  selectedPickup: string | null
  onTogglePickup: (station: string) => void
  /** Whether every box collected at this pickup is already marked loaded ✓. */
  isPickupLoaded: (station: string) => boolean
  onTogglePickupLoaded: (station: string) => void
  /** Contract sub-groups (Q1/Q2…) collected at a station. */
  groupsForStation: (station: string) => { key: string; title: string; scu: number; count: number; dests: string[] }[]
  selectedPickupGroup: string | null
  onSelectGroup: (station: string, key: string) => void
}) {
  return (
    <>
      {result.stops
        .filter((s) => s.kind === 'pickup')
        .map((stop, i) => {
          const scu = scuByStop.get(`pickup:${stop.destination}`) ?? 0
          const collected = isPickupLoaded(stop.destination)
          const groups = groupsForStation(stop.destination)
          return (
            <Fragment key={`pickup:${stop.destination}`}>
              <div className={`route-row route-row--pickup ${collected ? 'collected' : ''}`}>
                <button
                  className={`route-row--btn ${selectedPickup === stop.destination && !selectedPickupGroup ? 'on' : ''}`}
                  title="Click to see what to collect here (boxes highlight in the plan)"
                  onClick={() => onTogglePickup(stop.destination)}
                >
                  <span className="route-row-num">{i + 1}</span>
                  <span className="route-pickup-tag hud-label">PICKUP</span>
                  <span
                    className="route-planet-badge"
                    style={{ background: stop.planetColor, color: '#000' }}
                  >
                    {stop.planetLabel}
                  </span>
                  <span className="route-stop-name">{stop.destination}</span>
                  {scu > 0 && <span className="route-stop-scu hud-label pickup">+{scu} SCU</span>}
                </button>
                <label
                  className="deliver-check"
                  title="Mark everything collected here as loaded ✓ (shows in the 3D hold). Click again to clear."
                >
                  <input
                    type="checkbox"
                    checked={collected}
                    onChange={() => onTogglePickupLoaded(stop.destination)}
                  />
                </label>
              </div>
              {/* >1 contract collected here → Q1/Q2… sub-rows; click one to isolate just its
                  cargo in the 3D hold (pull that mission up the elevator on its own). */}
              {groups.length > 1 &&
                groups.map((g, gi) => (
                  <button
                    key={g.key}
                    className={`route-row route-subrow ${
                      selectedPickup === stop.destination && selectedPickupGroup === g.key ? 'on' : ''
                    }`}
                    title={`Isolate ${g.title} (${g.dests.join(', ')}) in the 3D hold`}
                    onClick={() => onSelectGroup(stop.destination, g.key)}
                  >
                    <span className="route-subrow-tag hud-label">Q{gi + 1}</span>
                    <span className="route-stop-name">
                      {g.title} <span className="muted">→ {g.dests.join(', ')}</span>
                    </span>
                    <span className="route-stop-scu hud-label pickup">+{g.scu} SCU</span>
                  </button>
                ))}
            </Fragment>
          )
        })}
      {result.unknownDests.length > 0 && (
        <span className="route-unknown hud-label">
          {result.unknownDests.length} unknown location{result.unknownDests.length === 1 ? '' : 's'}
        </span>
      )}
    </>
  )
}

/**
 * What to collect at a pickup stop: grouped boxes with SCU sizes, their bay
 * positions, and a ✓ for ones already marked loaded. Shown when a PICKUP row
 * is selected; the same boxes blink in the 3D hold and 2D maps.
 */
/** Collapse identical boxes into "2× 8 SCU Stims → Everus" chips. */
function boxChips(boxes: PlacedContainer[]) {
  const m = new Map<string, { commodity: string; scu: number; destination: string; color: string; count: number }>()
  for (const p of boxes) {
    const k = `${p.commodity}|${p.scu}|${p.destination}`
    const g = m.get(k) ?? { commodity: p.commodity, scu: p.scu, destination: p.destination, color: p.color, count: 0 }
    g.count++
    m.set(k, g)
  }
  return [...m.values()]
}

function PickupList({
  station,
  boxes,
  loaded,
  scopeLabel,
}: {
  station: string
  boxes: PlacedContainer[]
  loaded: Set<string>
  /** When one contract (Q1/Q2) is isolated from the route, its name — shown in the header. */
  scopeLabel?: string
}) {
  const totalScu = boxes.reduce((s, p) => s + p.scu, 0)
  const loadedCount = boxes.filter((p) => loaded.has(p.id)).length

  return (
    <div className="pickup-list">
      <h4 className="section-label">
        Collect at {station}
        {scopeLabel ? ` · ${scopeLabel}` : ''} — {boxes.length} box{boxes.length === 1 ? '' : 'es'}, {totalScu} SCU
        {loadedCount > 0 && <span className="good"> · {loadedCount} ✓</span>}
      </h4>
      {boxes.length === 0 ? (
        <p className="muted sm">Nothing to collect here (boxes may already be delivered).</p>
      ) : (
        <>
          <div className="pickup-items">
            {boxChips(boxes).map((c, i) => (
              <span className="box-chip" key={i} style={{ borderColor: c.color }}>
                {c.count}× {c.scu} SCU {c.commodity} <span className="muted">→ {c.destination}</span>
              </span>
            ))}
          </div>
          <p className="muted sm">Highlighted boxes in the hold are the ones to slot in here.</p>
        </>
      )}
    </div>
  )
}
