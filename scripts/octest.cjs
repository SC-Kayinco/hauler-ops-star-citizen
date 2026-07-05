// Verify the OCR pipeline + CURRENT production parser on real capture screenshots.
// Usage: node scripts/octest.cjs [filename-fragment ...]  (no args = ALL captures)
const { createWorker } = require('tesseract.js')
const path = require('node:path')
const fs = require('node:fs')

const toNum = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0
const clean = (s) => s.replace(/[|[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
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

// ===== MIRROR of src/lib/parseMission.ts — keep in sync =====
function parseMissions(raw) {
  const flat = raw.replace(/\r/g, '').replace(/\s+/g, ' ').trim()

  const contMatch = flat.match(/(\d+)\s*SCU\s+(?:cargo\s+container|kargo\s+konteyner)/i)
  const containerScu = contMatch ? toNum(contMatch[1]) : null

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

    if (commodity) missions.push({ commodity, scu, containerScu, pickup, pickups, dropoff, reward, contractedBy })
  }

  const dropoffs = [...new Set(missions.map((m) => m.dropoff).filter(Boolean))]
  if (dropoffs.length === 1) {
    for (const m of missions) if (!m.dropoff) m.dropoff = dropoffs[0]
  }

  if (missions.length === 0) {
    const alt = flat.match(/(\d+)\s*SCU\s+of\s+(.+?)\s+to\s+([^.\n]+?)(?:\.|$)/i)
    if (alt) {
      const pickupM = flat.match(/Collect\s+.+?\s+from\s+([^.\n]+?)(?:\.|$)/i)
      missions.push({
        commodity: clean(alt[2]),
        scu: toNum(alt[1]),
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
// ===== end mirror =====

function mergeParsed(primary, full) {
  const base = primary.length ? primary : full
  const fb = full[0]
  return base.map((m, i) => ({
    ...m,
    containerScu: m.containerScu ?? full[i]?.containerScu ?? fb?.containerScu ?? null,
    reward: m.reward ?? full[i]?.reward ?? fb?.reward ?? null,
  }))
}

function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

;(async () => {
  const dir = 'C:\\Users\\kivan\\OneDrive\\Belgeler\\HaulerOps\\captures'
  const wants = process.argv.slice(2)
  let files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()
  if (wants.length) files = files.filter((f) => wants.some((w) => f.includes(w)))
  const worker = await createWorker('eng')
  for (const f of files) {
    const p = path.join(dir, f)
    const { w, h } = pngSize(p)
    const fullText = (await worker.recognize(p)).data.text
    const rect = {
      left: Math.round(0.59 * w),
      top: Math.round(0.14 * h),
      width: Math.round(0.41 * w),
      height: Math.round(0.71 * h),
    }
    const cropText = (await worker.recognize(p, { rectangle: rect })).data.text
    console.log('\n==================== ' + f + ' ====================')
    console.log(JSON.stringify(mergeParsed(parseMissions(cropText), parseMissions(fullText)), null, 2))
  }
  await worker.terminate()
  console.log('\nDONE')
})()
