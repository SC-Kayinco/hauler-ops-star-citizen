import type { BayBaseFace, BayFill, CargoBay } from '@/types'

/**
 * Resolve a bay's base/mount surface. Containers attach to this face and build OUTWARD
 * (the bay's height/maxStackHeight axis = depth away from the face). The packer is
 * unchanged — it always fills the height axis from 0 up, which now means "from the base
 * face outward", so wall racks build out of the hull instead of stacking in mid-air.
 *
 * Falls back to `side` (then floor) for older bays saved before `baseFace` existed.
 */
export function resolveBaseFace(bay: CargoBay): BayBaseFace {
  if (bay.baseFace) return bay.baseFace
  if (bay.mount === 'wall' || bay.mount === 'external') return bay.side === 'right' ? 'right' : 'left'
  return 'bottom'
}

/** A floor hold (cargo stacks vertically up) vs a face-mounted rack (builds out sideways/down). */
export const isFloorBay = (bay: CargoBay): boolean => resolveBaseFace(bay) === 'bottom'

/** Human label for the surface, for editor menus. */
export const BASE_FACE_LABEL: Record<BayBaseFace, string> = {
  bottom: 'Floor (stack up)',
  top: 'Ceiling (hang down)',
  left: 'Left wall (out ←)',
  right: 'Right wall (out →)',
  back: 'Back wall (out front)',
  front: 'Front wall (out back)',
}

/**
 * Label for a single height-layer in the 2D bay map, given the base face.
 * Floor holds read "Floor / Layer 2…"; racks read "On surface / Out 2…" so players
 * don't mistake the depth-from-hull axis for vertical height.
 * @param y    0-based layer index (0 = touching the base face)
 * @param face the bay's base surface
 */
export function layerLabel(y: number, face: BayBaseFace): string {
  if (face === 'bottom') return y === 0 ? 'Floor' : `Layer ${y + 1}`
  return y === 0 ? 'On surface' : `Out ${y + 1}`
}

/** What the door/opening strip should read for this bay. */
export const accessLabel = (bay: CargoBay): string =>
  isFloorBay(bay) ? '▲ RAMP / DOOR ▲' : '◢ MOUNTING SURFACE ◣'

/** Whether a bay's fill mirrors the width (fw) and/or length (fl) axis. */
export function bayFlips(bay: CargoBay): { fw: boolean; fl: boolean } {
  const f = bay.fill ?? 'default'
  return { fw: f === 'flipW' || f === 'flipWL', fl: f === 'flipL' || f === 'flipWL' }
}

/** Mirror a cell's x within the bay width if the W axis is flipped (footprint-aware). */
export const flipX = (bay: CargoBay, x: number, w = 1) =>
  bayFlips(bay).fw ? bay.width - x - w : x
/** Mirror a cell's z within the bay length if the L axis is flipped (footprint-aware). */
export const flipZ = (bay: CargoBay, z: number, l = 1) =>
  bayFlips(bay).fl ? bay.length - z - l : z

/** Fill-direction menu options, labeled for the surface (vertical wording for racks). */
export function fillOptions(bay: CargoBay): { value: BayFill; label: string }[] {
  const floor = isFloorBay(bay)
  return [
    { value: 'default', label: 'Default' },
    { value: 'flipW', label: floor ? 'Flip left ↔ right' : 'Flip top ↔ bottom' },
    { value: 'flipL', label: floor ? 'Flip front ↔ back' : 'Flip fore ↔ aft' },
    { value: 'flipWL', label: 'Flip both' },
  ]
}
