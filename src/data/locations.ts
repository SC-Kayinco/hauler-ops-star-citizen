/**
 * Star Citizen location database for route optimization.
 * Travel times are approximate averages — actual QT times vary 20-30%
 * depending on orbital positions. Player can report inaccuracies.
 *
 * The location list itself is generated from the UEX Corp API and baked in
 * (see ./scLocations.generated.ts + scripts/genLocations.cjs); a small manual
 * supplement below covers content UEX doesn't carry yet.
 */
import { LOCATIONS as UEX_LOCATIONS } from './scLocations.generated'

export type PlanetId =
  | 'hurston'
  | 'crusader'
  | 'arccorp'
  | 'microtech'
  | 'pyro-i'
  | 'pyro-ii'
  | 'pyro-iii'
  | 'pyro-iv'
  | 'pyro-v'
  | 'pyro-vi'

export const PLANET_LABEL: Record<PlanetId, string> = {
  hurston: 'HUR',
  crusader: 'CRU',
  arccorp: 'ARC',
  microtech: 'MIC',
  'pyro-i': 'PY-I',
  'pyro-ii': 'PY-II',
  'pyro-iii': 'PY-III',
  'pyro-iv': 'PY-IV',
  'pyro-v': 'PY-V',
  'pyro-vi': 'PY-VI',
}

export const PLANET_COLOR: Record<PlanetId, string> = {
  hurston: '#f59e0b',
  crusader: '#4db8e8',
  arccorp: '#a78bfa',
  microtech: '#60a5fa',
  'pyro-i': '#f97316',
  'pyro-ii': '#fb923c',
  'pyro-iii': '#ef4444',
  'pyro-iv': '#dc2626',
  'pyro-v': '#b91c1c',
  'pyro-vi': '#991b1b',
}

/**
 * Approximate one-way QT travel time between planet groups (minutes).
 * Symmetric. Within-system = 0, same location = 0.
 */
const QT_PAIRS: [PlanetId, PlanetId, number][] = [
  // Stanton inner
  ['hurston', 'crusader', 9],
  ['hurston', 'arccorp', 11],
  ['hurston', 'microtech', 16],
  ['crusader', 'arccorp', 6],
  ['crusader', 'microtech', 11],
  ['arccorp', 'microtech', 8],
  // Stanton ↔ Pyro (includes QT to jump point + transit)
  ['hurston', 'pyro-i', 23],
  ['hurston', 'pyro-ii', 25],
  ['hurston', 'pyro-iii', 27],
  ['hurston', 'pyro-iv', 29],
  ['hurston', 'pyro-v', 32],
  ['hurston', 'pyro-vi', 35],
  ['crusader', 'pyro-i', 21],
  ['crusader', 'pyro-ii', 23],
  ['crusader', 'pyro-iii', 25],
  ['crusader', 'pyro-iv', 27],
  ['crusader', 'pyro-v', 30],
  ['crusader', 'pyro-vi', 33],
  ['arccorp', 'pyro-i', 20],
  ['arccorp', 'pyro-ii', 22],
  ['arccorp', 'pyro-iii', 24],
  ['arccorp', 'pyro-iv', 26],
  ['arccorp', 'pyro-v', 29],
  ['arccorp', 'pyro-vi', 32],
  ['microtech', 'pyro-i', 19],
  ['microtech', 'pyro-ii', 21],
  ['microtech', 'pyro-iii', 23],
  ['microtech', 'pyro-iv', 25],
  ['microtech', 'pyro-v', 28],
  ['microtech', 'pyro-vi', 31],
  // Within Pyro
  ['pyro-i', 'pyro-ii', 8],
  ['pyro-i', 'pyro-iii', 11],
  ['pyro-i', 'pyro-iv', 14],
  ['pyro-i', 'pyro-v', 18],
  ['pyro-i', 'pyro-vi', 22],
  ['pyro-ii', 'pyro-iii', 8],
  ['pyro-ii', 'pyro-iv', 11],
  ['pyro-ii', 'pyro-v', 15],
  ['pyro-ii', 'pyro-vi', 19],
  ['pyro-iii', 'pyro-iv', 6],
  ['pyro-iii', 'pyro-v', 10],
  ['pyro-iii', 'pyro-vi', 14],
  ['pyro-iv', 'pyro-v', 7],
  ['pyro-iv', 'pyro-vi', 11],
  ['pyro-v', 'pyro-vi', 6],
]

const QT_MAP = new Map<string, number>()
for (const [a, b, t] of QT_PAIRS) {
  QT_MAP.set(`${a}:${b}`, t)
  QT_MAP.set(`${b}:${a}`, t)
}

/** Approximate QT time in minutes between two planet groups. */
export function interPlanetMin(a: PlanetId, b: PlanetId): number {
  if (a === b) return 0
  return QT_MAP.get(`${a}:${b}`) ?? 20
}

export interface SCLocation {
  id: string
  name: string
  planet: PlanetId
  /**
   * Extra minutes to reach this location after arriving in the planet's
   * general vicinity: 0-1 = orbital station, 3 = lagrange/moon, 6 = surface.
   */
  localMin: number
  /** Lower-cased keywords; longer = more specific (used for scoring). */
  keywords: string[]
}

/**
 * Content UEX doesn't carry yet (very new) — hand-kept, verify in-game. The Aberdeen
 * Orbital Laser Platforms shipped with New Aberdeen but aren't in UEX's station/outpost/
 * POI sets as of this build. They sit in low Aberdeen orbit (a Hurston moon).
 */
const MANUAL_LOCATIONS: SCLocation[] = [
  { id: 'vivere-olp', name: 'Vivere OLP', planet: 'hurston', localMin: 3, keywords: ['vivere olp', 'vivere'] },
  { id: 'ruptura-olp', name: 'Ruptura OLP', planet: 'hurston', localMin: 3, keywords: ['ruptura olp', 'ruptura'] },
]

/** Extra in-game aliases the OCR may produce, appended to a generated entry by its name. */
const ALIASES: Record<string, string[]> = {
  Lorville: ['teasa spaceport', 'teasa'],
  // OCR routinely misreads the 'l' in Perlman as 'i' → "Periman" / "Perimon", leaving this
  // Aberdeen-orbit HDMS outpost (Hurston) unmatched ("?"). Map those readings to it.
  'HDMS-Perlman': ['hdms-periman', 'periman', 'hdms-perimon', 'perimon'],
}

/**
 * The full location list: UEX-generated Stanton + Pyro entries (with any alias additions)
 * plus the manual supplement. The route optimizer & OCR matcher read this.
 */
export const LOCATIONS: SCLocation[] = [
  ...UEX_LOCATIONS.map((l) =>
    ALIASES[l.name] ? { ...l, keywords: [...l.keywords, ...ALIASES[l.name]] } : l,
  ),
  ...MANUAL_LOCATIONS,
]

// Build keyword → location index for fast lookup (longer keywords win ties)
const KW_INDEX = new Map<string, SCLocation>()
for (const loc of LOCATIONS) {
  // Sort keywords desc by length so we register the most specific ones last
  // (Map.set overwrites, so last set wins — but we want longer to win).
  // We'll handle scoring in matchLocation instead.
  for (const kw of loc.keywords) {
    KW_INDEX.set(kw, loc)
  }
}

/**
 * Canonical display name for a destination string: the matched location's NAME, or the
 * trimmed raw string when unknown. Collapses OCR variants of the same place — "Chawla's
 * Beach on Pyro IV", "...Pyro Iv", "...Pyro n" all become "Chawla's Beach" — so they merge
 * into ONE route/delivery stop instead of appearing several times. Unknown places keep
 * their raw text (can't safely merge), so distinct unknowns stay distinct.
 */
export function canonicalLocation(raw: string): string {
  return matchLocation(raw)?.name ?? raw.trim()
}

/**
 * Match a raw destination string (e.g. from OCR) to the nearest known location.
 * Returns null only if no planet can be inferred at all.
 */
export function matchLocation(dest: string): SCLocation | null {
  const norm = dest
    .toLowerCase()
    // Normalize the many apostrophe glyphs OCR emits (curly ’ ‘, backtick, acute) to a plain
    // ' so "Sacren’s Plot" matches the keyword "sacren's plot" instead of staying unmatched.
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[,;.!?[\]{}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Score each location by best matching keyword length
  let best: SCLocation | null = null
  let bestScore = 0

  for (const loc of LOCATIONS) {
    for (const kw of loc.keywords) {
      if (norm.includes(kw) && kw.length > bestScore) {
        bestScore = kw.length
        best = loc
      }
    }
  }

  if (best) return best

  // Fallback: detect planet from generic keywords, synthesize a location entry
  const fallbacks: [string, PlanetId, number][] = [
    ['above hurston', 'hurston', 1],
    ['on hurston', 'hurston', 6],
    ['hurston', 'hurston', 3],
    ['above crusader', 'crusader', 1],
    ["crusader's", 'crusader', 3],
    ['on crusader', 'crusader', 6],
    ['crusader', 'crusader', 3],
    ['above arccorp', 'arccorp', 1],
    ['on arccorp', 'arccorp', 6],
    ['arccorp', 'arccorp', 3],
    ['above microtech', 'microtech', 1],
    ['on microtech', 'microtech', 6],
    ['microtech', 'microtech', 3],
    ['on pyro iv', 'pyro-iv', 6],
    ['pyro iv', 'pyro-iv', 4],
    ['on pyro iii', 'pyro-iii', 6],
    ['pyro iii', 'pyro-iii', 4],
    ['on pyro ii', 'pyro-ii', 6],
    ['pyro ii', 'pyro-ii', 4],
    ['on pyro i', 'pyro-i', 6],
    ['pyro i', 'pyro-i', 4],
    ['on pyro v', 'pyro-v', 6],
    ['pyro v', 'pyro-v', 4],
    ['on pyro vi', 'pyro-vi', 6],
    ['pyro vi', 'pyro-vi', 4],
    ['pyro', 'pyro-iii', 4],
  ]

  for (const [kw, planet, localMin] of fallbacks) {
    if (norm.includes(kw)) {
      return {
        id: `inferred-${planet}`,
        name: dest,
        planet,
        localMin,
        keywords: [],
      }
    }
  }

  return null
}
