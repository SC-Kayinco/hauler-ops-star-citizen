import { matchLocation, interPlanetMin, PLANET_LABEL, PLANET_COLOR, type PlanetId } from '@/data/locations'

export interface RouteStop {
  destination: string
  /** 'pickup' = collect cargo here first; 'dropoff' = deliver here. */
  kind: 'pickup' | 'dropoff'
  planetId: PlanetId | null
  planetLabel: string
  planetColor: string
  /** Cumulative QT travel time from the start location (minutes). */
  cumMin: number
}

export interface OptimizedRoute {
  /** DELIVERY destinations in optimized visit order (feeds reorderRoute / LIFO packing). */
  ordered: string[]
  /** Every stop in visit order: pickups first, then deliveries. */
  stops: RouteStop[]
  /** Total estimated travel time in minutes. */
  totalMin: number
  /** Stops that couldn't be matched to any known location (appended last in their group). */
  unknownDests: string[]
}

/** Travel cost from one planet+localMin to a destination location. */
function travelCost(
  fromPlanet: PlanetId | null,
  toPlanet: PlanetId,
  toLocalMin: number,
): number {
  if (!fromPlanet) return toLocalMin
  return interPlanetMin(fromPlanet, toPlanet) + toLocalMin
}

interface MatchedStop {
  dest: string
  /** Canonical location id — used to detect a pickup that sits AT the start location. */
  locId: string
  planet: PlanetId
  localMin: number
}

/** Greedy nearest-neighbor ordering starting from curPlanet. Mutates nothing. */
function nearestNeighborOrder(
  items: MatchedStop[],
  startPlanet: PlanetId | null,
): { ordered: MatchedStop[]; endPlanet: PlanetId | null } {
  const remaining = [...items]
  const ordered: MatchedStop[] = []
  let curPlanet = startPlanet

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestCost = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cost = travelCost(curPlanet, remaining[i].planet, remaining[i].localMin)
      if (cost < bestCost) {
        bestCost = cost
        bestIdx = i
      }
    }
    const pick = remaining.splice(bestIdx, 1)[0]
    ordered.push(pick)
    curPlanet = pick.planet
  }
  return { ordered, endPlanet: curPlanet }
}

/**
 * Greedy nearest-neighbor route optimizer with pickup support.
 *
 * The route is: start location → every pickup station (nearest-neighbor) →
 * every delivery destination (nearest-neighbor from the last pickup). All
 * cargo is collected before the first delivery, which matches the LIFO load
 * plan's "everything aboard before you fly the route" assumption.
 *
 * A pickup that resolves to the SAME location as the start is listed FIRST, at zero travel
 * time (you collect it on departure, before flying anywhere). Unknown stops (no location
 * match) are appended at the end of their group in original order.
 *
 * @param destinations - unique delivery destinations from active missions
 * @param pickups - unique pickup stations to visit before delivering
 * @param start - where the player is right now (route starting point)
 */
export function optimizeRoute(
  destinations: string[],
  pickups: string[],
  start: string,
): OptimizedRoute {
  if (destinations.length === 0 && pickups.length === 0) {
    return { ordered: [], stops: [], totalMin: 0, unknownDests: [] }
  }

  const startLoc = matchLocation(start)

  const matchGroup = (items: string[]) => {
    const matched: MatchedStop[] = []
    const unknown: string[] = []
    for (const dest of items) {
      const loc = matchLocation(dest)
      if (!loc) {
        unknown.push(dest)
        continue
      }
      matched.push({ dest, locId: loc.id, planet: loc.planet, localMin: loc.localMin })
    }
    return { matched, unknown }
  }

  const pk = matchGroup(pickups)
  const dl = matchGroup(destinations)

  // A pickup that sits AT the start location is collected on departure (no travel). Show it
  // FIRST — at the top of the list, zero travel time — instead of dropping it, so the player
  // sees they're also loading cargo where they already are. The rest are nearest-neighbored.
  const atStartPk = startLoc ? pk.matched.filter((m) => m.locId === startLoc.id) : []
  const restPk = startLoc ? pk.matched.filter((m) => m.locId !== startLoc.id) : pk.matched

  const pkOrder = nearestNeighborOrder(restPk, startLoc?.planet ?? null)
  const dlOrder = nearestNeighborOrder(dl.matched, pkOrder.endPlanet ?? startLoc?.planet ?? null)

  // Build stops with cumulative travel times: pickups first, then deliveries.
  const stops: RouteStop[] = []
  let cum = 0
  let cp: PlanetId | null = startLoc?.planet ?? null

  const push = (m: MatchedStop, kind: RouteStop['kind']) => {
    cum += travelCost(cp, m.planet, m.localMin)
    cp = m.planet
    stops.push({
      destination: m.dest,
      kind,
      planetId: m.planet,
      planetLabel: PLANET_LABEL[m.planet],
      planetColor: PLANET_COLOR[m.planet],
      cumMin: cum,
    })
  }
  const pushUnknown = (dest: string, kind: RouteStop['kind']) =>
    stops.push({ destination: dest, kind, planetId: null, planetLabel: '?', planetColor: '#6b7280', cumMin: cum })

  // Start-location pickups first, at zero added travel (you're already standing there).
  for (const m of atStartPk)
    stops.push({
      destination: m.dest,
      kind: 'pickup',
      planetId: m.planet,
      planetLabel: PLANET_LABEL[m.planet],
      planetColor: PLANET_COLOR[m.planet],
      cumMin: 0,
    })
  for (const m of pkOrder.ordered) push(m, 'pickup')
  for (const dest of pk.unknown) pushUnknown(dest, 'pickup')
  for (const m of dlOrder.ordered) push(m, 'dropoff')
  for (const dest of dl.unknown) pushUnknown(dest, 'dropoff')

  return {
    ordered: [...dlOrder.ordered.map((m) => m.dest), ...dl.unknown],
    stops,
    totalMin: cum,
    unknownDests: [...pk.unknown, ...dl.unknown],
  }
}
