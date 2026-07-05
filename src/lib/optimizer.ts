import type { CargoBay, GroupMode, LoadPlan, Mission, PlacedContainer, ScuSize, Ship } from '@/types'
import {
  type ContainerSize,
  DEFAULT_CONTAINER_SIZES,
  footprintFor,
  splitIntoContainers,
} from '@/data/containers'
import { canonicalLocation } from '@/data/locations'

/** Distinct, readable colors assigned per destination. */
export const DEST_PALETTE = [
  '#4db8e8',
  '#f0a830',
  '#4ce0a0',
  '#ff7d9c',
  '#c9a0ff',
  '#ffd166',
  '#6ad1c4',
  '#ff9b5a',
  '#9fb4ff',
  '#b6e06a',
  '#ff5d6c',
  '#7fe3ff',
]

/**
 * Build the delivery route: unique destinations ordered by the player's
 * chosen routeIndex, falling back to first-seen order.
 */
export function buildRoute(missions: Mission[]): string[] {
  const seen = new Map<string, number>()
  missions.forEach((m, i) => {
    // Group by canonical location so OCR variants of one place ("Pyro IV"/"Pyro Iv") are ONE stop.
    const d = canonicalLocation(m.destination)
    if (!seen.has(d)) {
      seen.set(d, m.routeIndex ?? 1000 + i)
    } else if (m.routeIndex != null) {
      seen.set(d, Math.min(seen.get(d)!, m.routeIndex))
    }
  })
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([d]) => d)
}

export function destinationColors(route: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  route.forEach((d, i) => {
    map[d] = DEST_PALETTE[i % DEST_PALETTE.length]
  })
  return map
}

// 3D occupancy grid for one bay. occ[y][z][x] = true if filled.
type Occ = boolean[][][]

function emptyOcc(bay: CargoBay): Occ {
  const occ: Occ = []
  for (let y = 0; y < bay.maxStackHeight; y++) {
    const layer: boolean[][] = []
    for (let z = 0; z < bay.length; z++) {
      layer.push(new Array(bay.width).fill(false))
    }
    occ.push(layer)
  }
  // Mark blocked floor cells as occupied on every layer.
  for (const key of bay.blockedCells) {
    const [bx, bz] = key.split(',').map(Number)
    for (let y = 0; y < bay.maxStackHeight; y++) {
      if (occ[y]?.[bz]?.[bx] !== undefined) occ[y][bz][bx] = true
    }
  }
  return occ
}

interface Orient {
  fw: number
  fl: number
  fh: number
}

function orientations(scu: ScuSize, sizes: ContainerSize[]): Orient[] {
  const f = footprintFor(scu, sizes)
  const a: Orient = { fw: f.w, fl: f.l, fh: f.h }
  if (f.w === f.l) return [a]
  return [a, { fw: f.l, fl: f.w, fh: f.h }]
}

function regionFree(occ: Occ, x: number, z: number, y: number, o: Orient): boolean {
  for (let yy = y; yy < y + o.fh; yy++) {
    for (let zz = z; zz < z + o.fl; zz++) {
      for (let xx = x; xx < x + o.fw; xx++) {
        if (occ[yy][zz][xx]) return false
      }
    }
  }
  return true
}

function supported(occ: Occ, x: number, z: number, y: number, o: Orient): boolean {
  if (y === 0) return true
  for (let zz = z; zz < z + o.fl; zz++) {
    for (let xx = x; xx < x + o.fw; xx++) {
      if (!occ[y - 1][zz][xx]) return false
    }
  }
  return true
}

function fill(occ: Occ, x: number, z: number, y: number, o: Orient) {
  for (let yy = y; yy < y + o.fh; yy++)
    for (let zz = z; zz < z + o.fl; zz++)
      for (let xx = x; xx < x + o.fw; xx++) occ[yy][zz][xx] = true
}

/**
 * Find the lowest, farthest-from-door free slot for a container.
 * Canonical frame: door is at the HIGH-z edge, so smaller z == deeper.
 * We fill floor-first (y ascending), then far-to-near (z ascending).
 */
function findSlot(
  occ: Occ,
  bay: CargoBay,
  scu: ScuSize,
  sizes: ContainerSize[],
): { x: number; z: number; y: number; o: Orient } | null {
  for (let y = 0; y < bay.maxStackHeight; y++) {
    for (let z = 0; z < bay.length; z++) {
      for (let x = 0; x < bay.width; x++) {
        for (const o of orientations(scu, sizes)) {
          if (x + o.fw > bay.width || z + o.fl > bay.length || y + o.fh > bay.maxStackHeight)
            continue
          if (regionFree(occ, x, z, y, o) && supported(occ, x, z, y, o)) {
            return { x, z, y, o }
          }
        }
      }
    }
  }
  return null
}

interface PendingContainer {
  missionId: string
  /** Stable per-mission box id (`missionId:boxIndex`) for manual-move overrides. */
  key: string
  destination: string
  commodity: string
  scu: ScuSize
  routeIndex: number
  /** Where this mission's cargo is collected (primary pickup, for display). */
  origin: string
  /** Every station this mission's cargo may be collected at. */
  pickupStations: string[]
  /** Acquisition order along the pickup route (0 = already have it at the start). */
  pickupRank: number
  done: boolean
}

/**
 * Core planner. Splits each mission into containers, then packs them into the
 * ship's bays so that cargo for LATER stops sits deep (loaded first) and cargo
 * for EARLIER stops sits near the door (loaded last, unloaded first = LIFO).
 *
 * `pickupRank` (missionId → acquisition order along the pickup route) is an
 * optional refinement: within the same destination group, cargo you collect
 * EARLIER packs deeper/lower and cargo collected LATER ends up nearer the
 * door / on top — so you never need to slide a late-acquired box under an
 * already-placed one. Delivery LIFO always wins over pickup order.
 */
export function optimize(
  ship: Ship,
  missions: Mission[],
  maxBox: number = 32,
  groupMode: GroupMode = 'destination',
  sizes: ContainerSize[] = DEFAULT_CONTAINER_SIZES,
  pickupRank?: Record<string, number>,
): LoadPlan {
  // Pack the FULL load (delivered ones included) so positions stay stable as you
  // unload — delivering a mission removes its boxes without reshuffling the rest.
  const eligible = missions.filter((m) => m.scu > 0)
  const route = buildRoute(eligible)
  const routePos = new Map(route.map((d, i) => [d, i]))
  const colors = destinationColors(route)
  const warnings: string[] = []

  // 1. Expand each mission into the real containers the contract provides.
  // Box size is set per mission (mission.containerScu — e.g. Covalex hands you
  // 1-SCU crates, Red Wind up to 4-SCU); the global max-box is only a fallback.
  const shipDoor = ship.maxContainerScu ?? Infinity
  const pending: PendingContainer[] = []
  for (const m of eligible) {
    // Canonical destination so containers for the same place (OCR variants) share a color,
    // a route slot, and the delivery group.
    const dest = canonicalLocation(m.destination)
    // Prefer the exact containers the player entered; otherwise auto-split.
    const boxes =
      m.containers && m.containers.length
        ? (m.containers as ScuSize[])
        : splitIntoContainers(m.scu, m.containerScu ?? maxBox, sizes)
    boxes.forEach((scu, bi) => {
      pending.push({
        missionId: m.id,
        key: `${m.id}:${bi}`,
        destination: dest,
        commodity: m.commodity,
        scu,
        routeIndex: routePos.get(dest) ?? 0,
        origin: m.origin,
        pickupStations: [...new Set([m.origin, ...(m.pickups ?? [])].filter(Boolean))],
        pickupRank: pickupRank?.[m.id] ?? 0,
        done: m.done ?? false,
      })
    })
  }
  // Flag containers too large for the ship's loading door (e.g. a 4-SCU ammo
  // crate can't pass the Clipper's 2-SCU ramp).
  const tooBigForDoor = pending.filter((p) => p.scu > shipDoor)
  if (tooBigForDoor.length > 0) {
    warnings.push(
      `${tooBigForDoor.length} container(s) exceed ${ship.name}'s ${shipDoor} SCU door and can't be loaded.`,
    )
  }

  // 2. Placement order. Containers are placed floor-up then deep-first, so whatever sorts
  // EARLIER ends up lower/deeper.
  // PICKUP ORDER DOMINATES so the plan is physically BUILDABLE: cargo you collect earlier
  // is placed lower (you settle it on arrival); later-collected cargo stacks on top of what's
  // already aboard. You never have to slot a box into a layer whose support hasn't been
  // collected yet. With a single hold + gravity + (pickup order ≠ reverse delivery order),
  // loadability and unload-LIFO can't both be perfect — and you can't float a box, so
  // loadability wins. (pickupRank is 0 for every box until a route is optimized, so single-
  // pickup hauls and the un-routed view keep the old pure delivery-LIFO packing.)
  // Within one pickup tier: later DELIVERY stops go deeper (LIFO), then — in destination
  // mode — SMALLER boxes deeper so the biggest sits nearest the door (the player's preference);
  // commodity mode keeps identical commodities grouped within the tier.
  if (groupMode === 'commodity') {
    pending.sort(
      (a, b) =>
        a.pickupRank - b.pickupRank ||
        a.commodity.localeCompare(b.commodity) ||
        b.routeIndex - a.routeIndex ||
        a.scu - b.scu,
    )
  } else {
    pending.sort(
      (a, b) => a.pickupRank - b.pickupRank || b.routeIndex - a.routeIndex || a.scu - b.scu,
    )
  }

  // 3. Pack into bays sequentially.
  const placed: PlacedContainer[] = []
  const unplaced: LoadPlan['unplaced'] = []
  const occs = ship.bays.map((b) => emptyOcc(b))
  let counter = 0

  for (const pc of pending) {
    let done = false
    for (let bi = 0; bi < ship.bays.length; bi++) {
      const bay = ship.bays[bi]
      // Skip bays whose door (or the ship's) can't take this container size.
      const bayDoor = Math.min(shipDoor, bay.maxContainerScu ?? Infinity)
      if (pc.scu > bayDoor) continue
      const slot = findSlot(occs[bi], bay, pc.scu, sizes)
      if (slot) {
        fill(occs[bi], slot.x, slot.z, slot.y, slot.o)
        placed.push({
          id: `c${counter++}`,
          key: pc.key,
          missionId: pc.missionId,
          destination: pc.destination,
          commodity: pc.commodity,
          scu: pc.scu,
          footprint: { w: slot.o.fw, l: slot.o.fl, h: slot.o.fh },
          x: slot.x,
          z: slot.z,
          y: slot.y,
          bayId: bay.id,
          origin: pc.origin,
          pickupStations: pc.pickupStations,
          pickupRank: pc.pickupRank,
          unloadOrder: 0,
          loadOrder: 0,
          color: colors[pc.destination] ?? '#4db8e8',
          delivered: pc.done,
        })
        done = true
        break
      }
    }
    if (!done) {
      unplaced.push({
        missionId: pc.missionId,
        commodity: pc.commodity,
        scu: pc.scu,
        destination: pc.destination,
      })
    }
  }

  // 4. Compute load & unload sequences from final positions.
  const bayIndex = new Map(ship.bays.map((b, i) => [b.id, i]))
  // doorScore: higher == closer to the door (z + depth). Per-bay offset keeps order stable.
  const doorScore = (p: PlacedContainer) => (bayIndex.get(p.bayId) ?? 0) * 1000 + p.z + p.footprint.l

  // Load: in the order you collect it. Visit pickups in route order (pickupRank); at each,
  // fill the floor before stacking up (y), taking far-from-door boxes first within a layer.
  // This matches the physical build — you can only place a box once you have it and once the
  // layer beneath it exists. (pickupRank is 0 everywhere until a route is optimized, so this
  // collapses to the old far+bottom-first order for single-pickup / un-routed loads.)
  ;[...placed]
    .sort(
      (a, b) =>
        (a.pickupRank ?? 0) - (b.pickupRank ?? 0) || a.y - b.y || doorScore(a) - doorScore(b),
    )
    .forEach((p, i) => {
      p.loadOrder = i
    })

  // Unload: visit earlier stops first; within a stop take nearest-door, top boxes first.
  ;[...placed]
    .sort(
      (a, b) =>
        (routePos.get(a.destination) ?? 0) - (routePos.get(b.destination) ?? 0) ||
        doorScore(b) - doorScore(a) ||
        b.y - a.y,
    )
    .forEach((p, i) => {
      p.unloadOrder = i
    })

  const totalScu = ship.bays.reduce((s, b) => s + b.width * b.length * b.maxStackHeight, 0)
  const usedScu = placed.reduce((s, p) => s + p.scu, 0)
  const demandScu = eligible.reduce((s, m) => s + m.scu, 0)

  if (unplaced.length > 0) {
    const u = unplaced.reduce((s, x) => s + x.scu, 0)
    warnings.push(`${u} SCU did not fit (${unplaced.length} container(s)). Need a bigger ship or more bays.`)
  }
  if (demandScu > ship.cargoScu) {
    warnings.push(`Mission demand (${demandScu} SCU) exceeds this ship's rated capacity (${ship.cargoScu} SCU).`)
  }
  if (ship.bays.length === 0) {
    warnings.push('This ship has no cargo bays defined. Draw a bay in the grid editor first.')
  }

  return { shipId: ship.id, placed, unplaced, totalScu, usedScu, route, warnings }
}

/**
 * "What actually fits" advisor. Uses real 3D packing (not just SCU sum), since
 * a load can be too awkward to fit even under capacity. Greedily keeps the
 * highest-value missions the ship can fully load and flags the rest to drop.
 */
export function recommendLoadable(
  ship: Ship,
  missions: Mission[],
  maxBox: number = 32,
  groupMode: GroupMode = 'destination',
  sizes: ContainerSize[] = DEFAULT_CONTAINER_SIZES,
  pickupRank?: Record<string, number>,
) {
  const active = missions.filter((m) => !m.done && m.scu > 0)
  // Must pack in the SAME pickup-aware order the real plan uses — geometric packing
  // is order-sensitive, so a different order can falsely report "won't fit".
  const full = optimize(ship, active, maxBox, groupMode, sizes, pickupRank)
  const allFit = full.unplaced.length === 0
  // Greedy by reward (desc), smaller loads first as tiebreak.
  const sorted = [...active].sort((a, b) => (b.reward ?? 0) - (a.reward ?? 0) || a.scu - b.scu)
  const keep: Mission[] = []
  for (const m of sorted) {
    if (optimize(ship, [...keep, m], maxBox, groupMode, sizes, pickupRank).unplaced.length === 0)
      keep.push(m)
  }
  const keepIds = new Set(keep.map((m) => m.id))
  const drop = active.filter((m) => !keepIds.has(m.id))
  return {
    allFit,
    keep,
    drop,
    keptReward: keep.reduce((s, m) => s + (m.reward ?? 0), 0),
    droppedReward: drop.reduce((s, m) => s + (m.reward ?? 0), 0),
    keptScu: keep.reduce((s, m) => s + m.scu, 0),
    demand: active.reduce((s, m) => s + m.scu, 0),
  }
}

/**
 * Score every ship for a set of missions: which fits the contract best?
 * Lower score = better (just big enough, fewest leftovers).
 */
export function recommendShips(
  ships: Ship[],
  missions: Mission[],
  maxBox: number = 32,
  sizes: ContainerSize[] = DEFAULT_CONTAINER_SIZES,
) {
  const demand = missions.filter((m) => !m.done).reduce((s, m) => s + m.scu, 0)
  return ships
    .map((ship) => {
      const plan = optimize(ship, missions, maxBox, 'destination', sizes)
      const fits = plan.unplaced.length === 0 && demand <= ship.cargoScu
      const slack = ship.cargoScu - demand
      return { ship, plan, fits, slack, demand }
    })
    .sort((a, b) => {
      if (a.fits !== b.fits) return a.fits ? -1 : 1
      // Among fitting ships, prefer the smallest sufficient capacity.
      if (a.fits) return a.slack - b.slack
      // Among non-fitting, prefer the one that places the most.
      return b.plan.usedScu - a.plan.usedScu
    })
}
