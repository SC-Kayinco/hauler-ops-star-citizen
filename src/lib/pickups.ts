import type { Mission } from '@/types'

/** `pickupChoice` sentinel meaning "split this leg across several stations" (see Mission). */
export const PICKUP_SPLIT = '__split__'

/** All stations a mission lists as collection points (primary origin + extras), deduped. */
export function allPickupStations(m: Mission): string[] {
  return [...new Set([m.origin, ...(m.pickups ?? [])].filter(Boolean))]
}

/** True when a mission's commodity can be collected from more than one station. */
export function isMultiPickup(m: Mission): boolean {
  return allPickupStations(m).length > 1
}

/**
 * The stations the route should ACTUALLY visit for this mission, given the player's choice:
 * - single-pickup → that one station;
 * - chose one station → just it (others drop off the route);
 * - split → the stations with a positive entered amount (falls back to all if none entered);
 * - not chosen yet → all listed stations.
 */
export function effectivePickups(m: Mission): string[] {
  const all = allPickupStations(m)
  if (all.length <= 1) return all
  if (m.pickupChoice && m.pickupChoice !== PICKUP_SPLIT) return [m.pickupChoice]
  if (m.pickupChoice === PICKUP_SPLIT && m.pickupSplit) {
    const used = Object.keys(m.pickupSplit).filter((k) => (m.pickupSplit![k] ?? 0) > 0)
    return used.length ? used : all
  }
  return all
}

/**
 * How much SCU of `m` is collected at `station`, out of `total` aboard.
 * - station not used → 0;
 * - split → the entered per-station amount;
 * - single chosen / single-pickup → the full total;
 * - unresolved multi-pickup → the full total ONLY at its earliest pickup (per `isEarliest`),
 *   so it's counted once across the route instead of at every station.
 */
export function pickupAmountAt(
  m: Mission,
  station: string,
  total: number,
  isEarliest: (station: string) => boolean,
): number {
  const eff = effectivePickups(m)
  if (!eff.includes(station)) return 0
  if (m.pickupChoice === PICKUP_SPLIT && m.pickupSplit) return m.pickupSplit[station] ?? 0
  if (eff.length === 1) return total
  // unresolved multi-pickup → count once at the earliest stop
  return isEarliest(station) ? total : 0
}
