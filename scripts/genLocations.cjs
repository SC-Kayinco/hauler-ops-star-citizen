#!/usr/bin/env node
/**
 * Generate src/data/scLocations.generated.ts from the UEX Corp public API
 * (api.uexcorp.space) — the community location database. Pulls live Stanton +
 * Pyro space stations, surface outposts, and cities, folds moons into their
 * parent planet group (the app's route model is planet-level), and emits typed
 * SCLocation entries with rich keywords for the OCR matcher.
 *
 * Run: node scripts/genLocations.cjs            (writes the .ts file)
 *      node scripts/genLocations.cjs --dry      (prints stats + match probes only)
 *
 * Re-run whenever a new SC patch adds locations. Data is BAKED into the repo so
 * the app stays fully offline — no runtime API dependency.
 */
const fs = require('fs')
const path = require('path')

const API = 'https://api.uexcorp.space/2.0'
const get = (ep) => fetch(`${API}/${ep}`).then((r) => r.json()).then((j) => j.data || j)

// UEX planet_name (parent planet for moons) → the app's PlanetId.
const PLANET = {
  // Stanton
  Hurston: 'hurston',
  Crusader: 'crusader',
  ArcCorp: 'arccorp',
  MicroTech: 'microtech',
  // Pyro (some planets carry proper names)
  'Pyro I': 'pyro-i',
  Monox: 'pyro-ii',
  Bloom: 'pyro-iii',
  'Pyro IV': 'pyro-iv',
  'Pyro V': 'pyro-v',
  Terminus: 'pyro-vi',
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

const lc = (s) => s.toLowerCase().trim()

// L-station nickname prefix (e.g. "CRU-L1") → planet-name aliases the game/OCR may use.
const LPREFIX = { ARC: 'arccorp', CRU: 'crusader', HUR: 'hurston', MIC: 'microtech' }

function keywordsFor(name, nickname) {
  const kw = new Set()
  const add = (s) => {
    const v = lc(s)
    if (v && v.length >= 2) kw.add(v)
  }
  add(name)
  if (nickname) add(nickname)
  // Despaced-before-digits variant: "ArcCorp Mining Area 157" → "arccorp mining area157"
  // (OCR frequently drops the space before a trailing number).
  if (/\s\d/.test(name)) add(name.replace(/\s+(\d)/g, '$1'))
  // L-station aliases: nickname "CRU-L1" → "crusader l1" / "crusader's l1".
  const m = (nickname || '').match(/^([A-Z]{3})-?L(\d)/i)
  if (m && LPREFIX[m[1].toUpperCase()]) {
    const planet = LPREFIX[m[1].toUpperCase()]
    add(`${planet} l${m[2]}`)
    add(`${planet}'s l${m[2]}`)
    add(`${m[1].toLowerCase()}-l${m[2]}`)
  }
  return [...kw]
}

// localMin: extra minutes after arriving in the planet's vicinity.
// orbital station = 1, lagrange = 3, moon station = 3, surface outpost/city = 6.
function localMin(rec) {
  if (rec.is_lagrange == 1) return 3
  if (rec._t === 'city') return 6
  if (rec._t === 'outpost') return 6
  // station
  if (rec.moon_name) return 3
  return 1
}

async function main() {
  const [st, op, ci] = await Promise.all([
    get('space_stations'),
    get('outposts'),
    get('cities'),
  ])
  const all = [
    ...st.map((x) => ({ ...x, _t: 'station' })),
    ...op.map((x) => ({ ...x, _t: 'outpost' })),
    ...ci.map((x) => ({ ...x, _t: 'city' })),
  ]

  const out = []
  const skipped = []
  const seenId = new Set()
  for (const r of all) {
    if (r.is_available_live != 1) continue
    if (r.is_jump_point == 1) {
      skipped.push(`${r.name} (jump point)`)
      continue
    }
    const planet = PLANET[r.planet_name]
    if (!planet) {
      skipped.push(`${r.name} [${r.star_system_name}/${r.planet_name || 'no-planet'}]`)
      continue
    }
    let id = slug(r.nickname || r.name) || slug(r.name)
    while (seenId.has(id)) id += '-x'
    seenId.add(id)
    out.push({
      id,
      name: r.name,
      planet,
      localMin: localMin(r),
      keywords: keywordsFor(r.name, r.nickname),
      _system: r.star_system_name,
      _planetName: r.planet_name,
      _moon: r.moon_name || '',
      _cargo: r.has_freight_elevator == 1 || r.has_cargo_center == 1,
    })
  }
  out.sort((a, b) => a.planet.localeCompare(b.planet) || a.name.localeCompare(b.name))
  return { out, skipped }
}

main().then(({ out, skipped }) => {
  const dry = process.argv.includes('--dry')

  // ---- Stats ----
  const byPlanet = {}
  for (const o of out) byPlanet[o.planet] = (byPlanet[o.planet] || 0) + 1
  console.error(`Generated ${out.length} locations:`)
  for (const p of Object.keys(byPlanet).sort()) console.error(`  ${p}: ${byPlanet[p]}`)
  console.error(`Skipped ${skipped.length} (jump points / non-Stanton-Pyro / no planet).`)

  // ---- Match probes: the user's contract locations + a few seeded ones ----
  const probes = [
    "Brio's Breaker Yard", "ArcCorp Mining Area 157", "ArcCorp Mining Area157",
    'Rayari Kaltag Research Outpost', 'HDMS-Perlman', 'Vivere OLP', 'Ruptura OLP',
    "Chawla's Beach", "Sacren's Plot", "Shepherd's Rest", "Jackson's Swap",
    'Seraphim Station', 'Orison', 'Baijini Point', 'Port Tressler', "Crusader's L1",
  ]
  const norm = (d) => d.toLowerCase().replace(/[,;.!?[\]{}|]/g, ' ').replace(/\s+/g, ' ').trim()
  const match = (dest) => {
    const n = norm(dest)
    let best = null, score = 0
    for (const loc of out) for (const kw of loc.keywords)
      if (n.includes(kw) && kw.length > score) { score = kw.length; best = loc }
    return best
  }
  console.error('\nMatch probes:')
  for (const p of probes) {
    const m = match(p)
    console.error(`  ${p.padEnd(34)} -> ${m ? `${m.name} [${m.planet}]` : '*** NO MATCH ***'}`)
  }

  if (dry) return

  // ---- Emit TS ----
  const lines = out.map((o) => {
    const kws = JSON.stringify(o.keywords)
    const note = `${o._system}/${o._planetName}${o._moon ? '/' + o._moon : ''}${o._cargo ? ' · cargo' : ''}`
    return `  { id: ${JSON.stringify(o.id)}, name: ${JSON.stringify(o.name)}, planet: ${JSON.stringify(o.planet)}, localMin: ${o.localMin}, keywords: ${kws} }, // ${note}`
  })
  const header = `// AUTO-GENERATED by scripts/genLocations.cjs from the UEX Corp API (api.uexcorp.space).
// Live Stanton + Pyro stations, outposts & cities; moons folded into their parent planet.
// Do NOT edit by hand — re-run \`node scripts/genLocations.cjs\` to refresh after a patch.
// Trailing comment per row = source system/planet[/moon] (· cargo = has a freight elevator).
import type { SCLocation } from './locations'

export const LOCATIONS: SCLocation[] = [
${lines.join('\n')}
]
`
  const dest = path.join(__dirname, '..', 'src', 'data', 'scLocations.generated.ts')
  fs.writeFileSync(dest, header)
  console.error(`\nWrote ${dest}`)
}).catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
