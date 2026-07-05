// Debug: dump raw OCR text so we can see Turkish translation keywords
const { createWorker } = require('tesseract.js')
const path = require('node:path')
const fs = require('node:fs')

function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

;(async () => {
  const dir = 'C:\\Users\\kivan\\OneDrive\\Belgeler\\HaulerOps\\captures'
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()
  // Filename (or fragment) as CLI arg; defaults to the most recent capture.
  const want = process.argv[2]
  const last = want ? files.find((f) => f.includes(want)) : files[files.length - 1]
  if (!last) { console.log(want ? `No capture matching "${want}"` : 'No captures found in ' + dir); process.exit(1) }

  const p = path.join(dir, last)
  const { w, h } = pngSize(p)
  console.log(`File: ${last}  (${w}x${h})`)

  const worker = await createWorker('eng')

  const fullText = (await worker.recognize(p)).data.text
  console.log('\n=== FULL IMAGE RAW TEXT ===')
  console.log(fullText)

  const rect = {
    left: Math.round(0.59 * w),
    top: Math.round(0.14 * h),
    width: Math.round(0.41 * w),
    height: Math.round(0.71 * h),
  }
  const cropText = (await worker.recognize(p, { rectangle: rect })).data.text
  console.log('\n=== CROP (right column) RAW TEXT ===')
  console.log(cropText)

  await worker.terminate()
  console.log('\nDONE')
})()
