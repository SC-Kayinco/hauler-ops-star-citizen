import type { Footprint } from '@/types'

/**
 * Default footprint of each standard cargo container in 1-SCU grid cells (w x l x h).
 * 1 SCU == 1 cell == a 1.25 m cube in-game (Star Citizen Wiki). Values match the wiki's
 * internal-crate layouts (e.g. 32 SCU = 8x2x2). The PLAYER can edit these / add sizes (64…)
 * in the Container Sizes editor; the live values live in the store (`containerSizes`).
 */
export const CONTAINER_FOOTPRINTS: Record<number, Footprint> = {
  1: { w: 1, l: 1, h: 1 }, // 1.25 m cube
  2: { w: 1, l: 2, h: 1 }, // 2.50 x 1.25 x 1.25 m
  4: { w: 2, l: 2, h: 1 }, // 2.50 x 2.50 x 1.25 m (flat 2x2 pad)
  8: { w: 2, l: 2, h: 2 }, // 2.50 m cube
  16: { w: 2, l: 4, h: 2 }, // 5.00 x 2.50 x 2.50 m (20-ft ISO equivalent)
  24: { w: 2, l: 6, h: 2 }, // 7.50 x 2.50 x 2.50 m
  32: { w: 2, l: 8, h: 2 }, // 10.00 x 2.50 x 2.50 m (largest standard)
}

/** An editable container size: SCU amount + its 1-cell footprint. */
export interface ContainerSize {
  scu: number
  w: number
  l: number
  h: number
}

/** Seed list (from CONTAINER_FOOTPRINTS) — the store's `containerSizes` starts from this. */
export const DEFAULT_CONTAINER_SIZES: ContainerSize[] = [1, 2, 4, 8, 16, 24, 32].map((scu) => ({
  scu,
  w: CONTAINER_FOOTPRINTS[scu].w,
  l: CONTAINER_FOOTPRINTS[scu].l,
  h: CONTAINER_FOOTPRINTS[scu].h,
}))

/** Footprint for an SCU size, using the editable size list (falls back for unknown sizes). */
export function footprintFor(scu: number, sizes: ContainerSize[] = DEFAULT_CONTAINER_SIZES): Footprint {
  const s = sizes.find((x) => x.scu === scu)
  if (s) return { w: s.w, l: s.l, h: s.h }
  if (CONTAINER_FOOTPRINTS[scu]) return CONTAINER_FOOTPRINTS[scu]
  return { w: 1, l: Math.max(1, Math.round(scu)), h: 1 } // unknown size → a 1×scu×1 row
}

/** Floor area (cells) a container occupies, ignoring stack height. */
export function footprintArea(scu: number, sizes: ContainerSize[] = DEFAULT_CONTAINER_SIZES): number {
  const f = footprintFor(scu, sizes)
  return f.w * f.l
}

/**
 * Split a raw SCU amount into the fewest containers, largest-first, capped at maxBox.
 * Uses the editable size list (so custom sizes like 64 participate).
 */
export function splitIntoContainers(
  scu: number,
  maxBox: number = 32,
  sizes: ContainerSize[] = DEFAULT_CONTAINER_SIZES,
): number[] {
  const avail = sizes
    .map((s) => s.scu)
    .filter((s) => s <= maxBox)
    .sort((a, b) => b - a)
  const out: number[] = []
  let remaining = Math.max(0, Math.round(scu))
  for (const size of avail) {
    while (remaining >= size) {
      out.push(size)
      remaining -= size
    }
  }
  // Any leftover -> pad with 1-SCU boxes.
  while (remaining > 0) {
    out.push(1)
    remaining -= 1
  }
  return out
}

export const CONTAINER_COLORS_NOTE =
  'Container colors in plans are assigned per destination, not per size.'
