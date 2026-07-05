import type { ParsedMission } from '@/types'

const toNum = (s: string) => parseInt(s.replace(/[^\d]/g, ''), 10) || 0

/**
 * OCR reads the objective's progress prefix "0/" (zero-slash) as a single "7" glyph, so
 * "0/48 SCU" comes through as "748 SCU" — always a leading 7 in front of the real total
 * (32→732, 40→740, 48→748). Hauling legs are virtually never 700–7999 SCU, so a 3–4 digit
 * SCU starting with 7 is this misread: drop the leading 7. Plain 2-digit/≤699 values pass through.
 */
const fixProgressScu = (n: number): number => {
  const s = String(n)
  return s.length >= 3 && s.length <= 4 && s[0] === '7' ? Number(s.slice(1)) || n : n
}
const clean = (s: string) =>
  s
    .replace(/[|[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Clean a location string: drop lone single-letter wrap artifacts, a trailing
 * garbled Roman-numeral token (OCR reads "III" as "lll"/"lil"), turn "X in Y"
 * into "X, Y", tidy commas.
 */
const cleanLoc = (s: string) =>
  clean(s)
    .replace(/\s+[iIl](?=[\s,.]|$)/g, '')
    .replace(/\s+[lI1i|]{1,4}$/, '')
    .replace(/\s+in\s+/i, ', ')
    .replace(/\s*,\s*/g, ', ')
    .trim()

/** Strip leading/trailing OCR junk from a commodity name ("Souvenirs =" -> "Souvenirs"). */
const tidyCommodity = (s: string) =>
  clean(s)
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9)\]]+$/, '')

/**
 * Parse OCR text from a Star Citizen hauling contract into missions.
 * Supports both English and Turkish (community patch) UI.
 *
 * English: "Deliver 0/2 SCU of Souvenirs to Bueno Ravine on Pyro III.
 *            Collect Souvenirs from ArcCorp Mining Area 056."
 *
 * Turkish: "0/2 SCU miktarinda Souvenirs ögesini Bueno Ravine konumuna teslim et."
 *           (OCR reads ö as d/é/6 so we match \S*gesini)
 */
export function parseMissions(raw: string): ParsedMission[] {
  const flat = raw.replace(/\r/g, '').replace(/\s+/g, ' ').trim()

  const contMatch = flat.match(/(\d+)\s*SCU\s+(?:cargo\s+container|kargo\s+konteyner)/i)
  const containerScu = contMatch ? toNum(contMatch[1]) : null

  // Reward: English "Reward" OR Turkish "Ödül" (OCR may garble ö → O/0/6/B/p)
  // Fallback: first 5-6 digit number formatted with dot/comma thousand separator (Turkish: 156.750)
  const rewardMatch =
    flat.match(/(?:Reward|[OÖo0B][dDpP][üuU0][lL1|])\D{0,40}?(\d[\d.,]{2,})/i) ??
    flat.match(/\b(\d{2,3}[.,]\d{3})\b/)
  const reward = rewardMatch ? toNum(rewardMatch[1]) : null

  // Contracted by: English OR Turkish "Kimden"
  const contractedMatch = flat.match(
    /(?:Contracted\s*By|Kimden)\s+([A-Za-z0-9 '&.-]{3,60}?)(?:\s+(?:Deliver|Details|Primary|Reward|Contract|Detaylar|Oncelikl|Hedefler|Kimden)|$)/i,
  )
  const contractedBy = contractedMatch ? clean(contractedMatch[1]) : null

  const missions: ParsedMission[] = []

  // Split at English "Deliver N" OR Turkish "N SCU miktar…". The Turkish anchor is the
  // digit token right before "SCU miktar" — deliberately NOT the full "0/3" progress
  // fraction, because the app's binarized OCR pass sometimes garbles the leading
  // "<> 0/" (diamond bullet + progress) and that must not lose the objective.
  // O/o/Q/l are accepted as misread digits. The lookbehind keeps the split at the
  // FIRST digit of a multi-digit total — without it "0/32 SCU" splits mid-number
  // and reads 2 SCU instead of 32 (and "0/20" became 0).
  const splitRe = /(?<![\dOoQl])(?=(?:Deliver\s+\d|[\dOoQl]{1,4}\s*SCU\s+miktar))/i
  const filterRe = /(?:Deliver\s+\d|[\dOoQl]{1,4}\s*SCU\s+miktar)/i
  const chunks = flat.split(splitRe).filter((c) => filterRe.test(c))

  for (const chunk of chunks) {
    // --- English pattern ---
    // Capture the TOTAL right before "SCU", skipping an optional "current/" progress prefix
    // (the slash distinguishes it). Without the slash, OCR's "0/"→"7" misread leaves "748",
    // which fixProgressScu corrects. The old greedy `[\d ]*` ate digits and misread "748"→"8".
    const headEn = chunk.match(/Deliver\s+(?:\d+\s*[/|]\s*)?(\d+)\s*SCU\s+of\s+(.+)/i)

    // --- Turkish pattern ---
    // "0/2 SCU miktarinda <commodity> ögesini <dest> konumuna teslim et"
    // Only the total (the digit token before SCU) is required — the chunk already
    // starts there. OCR reads ö as d/é/6/8, so \S*[gq]esini captures all variants.
    const headTr = chunk.match(
      /([\dOoQl]{1,4})\s*SCU\s+miktar\S*\s+(.+?)\s+\S*[gq]esini\s+(.+?)\s+konumuna/i,
    )

    let scu = 0
    let commodity = ''
    let dropoff = ''

    if (headEn) {
      scu = fixProgressScu(toNum(headEn[1]))
      const rest = headEn[2]
      const withTo = rest.match(/^(.+?)\s+to\s+(.+?)(?:\.|Collect|Deliver|$)/i)
      if (withTo) {
        commodity = tidyCommodity(withTo[1])
        dropoff = cleanLoc(withTo[2])
      } else {
        commodity = tidyCommodity(rest.replace(/(?:\.|Collect|Deliver).*$/i, ''))
      }
    } else if (headTr) {
      // Map misread digits (O/o/Q → 0, l → 1) before parsing the SCU total.
      scu = fixProgressScu(toNum(headTr[1].replace(/[OoQ]/g, '0').replace(/l/g, '1')))
      commodity = tidyCommodity(headTr[2])
      dropoff = cleanLoc(headTr[3])
    } else {
      continue
    }

    // Pickups: English "Collect ... from <place>" / Turkish "<place> konumundan ...
    // teslim alın". A contract can collect from SEVERAL stations, so gather them all;
    // the first becomes the primary `pickup`. Bullet glyphs (©/¢) before the Turkish
    // place aren't in the capture class, so the span can't run backwards past them.
    const pickups: string[] = []
    for (const m of chunk.matchAll(/Collect\s+.+?\s+from\s+(.+?)(?:\.|Deliver|$)/gi)) {
      const p = cleanLoc(m[1])
      if (p && !pickups.includes(p)) pickups.push(p)
    }
    for (const m of chunk.matchAll(/([A-Za-z][A-Za-z0-9' .-]{2,60}?)\s+konumundan/gi)) {
      const p = cleanLoc(m[1])
      if (p && !pickups.includes(p)) pickups.push(p)
    }
    const pickup = pickups[0] ?? ''

    if (commodity) {
      missions.push({ commodity, scu, containerScu, pickup, pickups, dropoff, reward, contractedBy })
    }
  }

  // If every parsed dropoff agrees, fill any blanks with it.
  const dropoffs = [...new Set(missions.map((m) => m.dropoff).filter(Boolean))]
  if (dropoffs.length === 1) {
    for (const m of missions) if (!m.dropoff) m.dropoff = dropoffs[0]
  }

  // English fallback: a single "N SCU of X to Y" anywhere.
  if (missions.length === 0) {
    const alt = flat.match(/(?:\d+\s*[/|]\s*)?(\d+)\s*SCU\s+of\s+(.+?)\s+to\s+([^.\n]+?)(?:\.|$)/i)
    if (alt) {
      const pickupM = flat.match(/Collect\s+.+?\s+from\s+([^.\n]+?)(?:\.|$)/i)
      missions.push({
        commodity: clean(alt[2]),
        scu: fixProgressScu(toNum(alt[1])),
        containerScu,
        pickup: pickupM ? cleanLoc(pickupM[1]) : '',
        dropoff: cleanLoc(alt[3]),
        reward,
        contractedBy,
      })
    }
  }

  return missions
}
