// Quick parser test on captured Turkish crop text — no OCR, instant.
// Simulates the app's binarized-OCR quirks: garbled "<> 0/" progress prefixes
// (O letter, lost slash, fused diamond) — every objective must still parse.
const text = `0p0L Br 42.000
Kontrat Uygunlugu 2h 11m
Kimden Covalex Independent Contractors
ONCELIKLi HEDEFLER
<> O/3 SCU miktarinda Waste 6gesini Seraphim Station [
above Crusader konumuna teslim et.
¢ CRU-L1 Ambitious Dream istasyonu konumundan
Waste teslim alin.
¢ CRU-L5 Beautiful Glen istasyonu konumundan Waste
teslim alin.
©3 SCU miktarinda Scrap 8gesini Seraphim Station
above Crusader konumuna teslim et.
¢ CRU-L1 Ambitious Dream istasyonu konumundan
Scrap teslim alin.
¢& CRU-L5 Beautiful Glen istasyonu konumundan Scrap
teslim alin.
KABUL ET`

const toNum = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0
const clean = (s) => s.replace(/\s+/g, ' ').replace(/[|[\]{}]/g, ' ').trim()
const cleanLoc = (s) =>
  clean(s)
    .replace(/\s+[iIl](?=[\s,.]|$)/g, '')
    .replace(/\s+[lI1i|]{1,4}$/, '')
    .replace(/\s+in\s+/i, ', ')
    .replace(/\s*,\s*/g, ', ')
    .trim()
const tidyCommodity = (s) =>
  clean(s)
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9)\]]+$/, '')

function parseMissions(raw) {
  const flat = raw.replace(/\r/g, '').replace(/\s+/g, ' ').trim()

  const rewardMatch =
    flat.match(/(?:Reward|[OÖo0B][dDpP][üuU0][lL1|])\D{0,40}?(\d[\d.,]{2,})/i) ??
    flat.match(/\b(\d{2,3}[.,]\d{3})\b/)
  const reward = rewardMatch ? toNum(rewardMatch[1]) : null

  const contractedMatch = flat.match(
    /(?:Contracted\s*By|Kimden)\s+([A-Za-z0-9 '&.-]{3,60}?)(?:\s+(?:Deliver|Details|Primary|Reward|Contract|Detaylar|Oncelikl|Hedefler|Kimden)|$)/i,
  )
  const contractedBy = contractedMatch ? clean(contractedMatch[1]) : null

  const missions = []
  const splitRe = /(?<![\dOoQl])(?=(?:Deliver\s+\d|[\dOoQl]{1,4}\s*SCU\s+miktar))/i
  const filterRe = /(?:Deliver\s+\d|[\dOoQl]{1,4}\s*SCU\s+miktar)/i
  const chunks = flat.split(splitRe).filter((c) => filterRe.test(c))
  console.log('chunks:', chunks.length)

  for (const chunk of chunks) {
    const headEn = chunk.match(/Deliver\s+[\d ]*[/|]?\s*(\d+)\s*SCU\s+of\s+(.+)/i)
    const headTr = chunk.match(
      /([\dOoQl]{1,4})\s*SCU\s+miktar\S*\s+(.+?)\s+\S*[gq]esini\s+(.+?)\s+konumuna/i,
    )
    let scu = 0, commodity = '', dropoff = ''
    if (headEn) {
      scu = toNum(headEn[1])
      const rest = headEn[2]
      const withTo = rest.match(/^(.+?)\s+to\s+(.+?)(?:\.|Collect|Deliver|$)/i)
      if (withTo) { commodity = tidyCommodity(withTo[1]); dropoff = cleanLoc(withTo[2]) }
      else commodity = tidyCommodity(rest.replace(/(?:\.|Collect|Deliver).*$/i, ''))
    } else if (headTr) {
      scu = toNum(headTr[1].replace(/[OoQ]/g, '0').replace(/l/g, '1'))
      commodity = tidyCommodity(headTr[2])
      dropoff = cleanLoc(headTr[3])
    } else continue

    const pickups = []
    for (const m of chunk.matchAll(/Collect\s+.+?\s+from\s+(.+?)(?:\.|Deliver|$)/gi)) {
      const p = cleanLoc(m[1])
      if (p && !pickups.includes(p)) pickups.push(p)
    }
    for (const m of chunk.matchAll(/([A-Za-z][A-Za-z0-9' .-]{2,60}?)\s+konumundan/gi)) {
      const p = cleanLoc(m[1])
      if (p && !pickups.includes(p)) pickups.push(p)
    }
    const pickup = pickups[0] ?? ''
    if (commodity) missions.push({ commodity, scu, pickup, pickups, dropoff, reward, contractedBy })
  }
  return missions
}

console.log(JSON.stringify(parseMissions(text), null, 2))
