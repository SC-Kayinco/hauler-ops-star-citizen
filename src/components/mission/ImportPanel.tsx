import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import { useStore } from '@/store/useStore'
import { commodityColor } from '@/data/commodities'
import { parseMissions } from '@/lib/parseMission'
import { applyTemplate, buildTemplate, contractSignature, templateStatus, type TemplateStatus } from '@/lib/templates'
import { PICKUP_SPLIT } from '@/lib/pickups'
import BoxEditor from './BoxEditor'
import SaveIcon from '@/components/common/SaveIcon'
import Lightbox from '@/components/common/Lightbox'
import type { ImportContract, ImportLeg, Mission, ParsedMission } from '@/types'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => rej(new Error('image load failed'))
    im.src = src
  })
}

interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Otsu's method: the luminance threshold that best separates a bimodal histogram. */
function otsuThreshold(hist: Uint32Array, total: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let max = 0
  let threshold = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > max) {
      max = between
      threshold = i
    }
  }
  return threshold
}

/**
 * Crop → high-quality upscale → grayscale → contrast-stretch → INVERT (and optionally
 * binarize), producing a Tesseract-friendly image. The contract panel is light text on a
 * dark, glowing translucent panel; at 4K the PRIMARY OBJECTIVES column is a small slice of
 * the frame, so we:
 *  1) crop to just that column (region) so other columns don't interleave,
 *  2) upscale to `targetW` px wide with high-quality smoothing (more pixels per glyph —
 *     Tesseract reads best when cap-height is ~30-40px),
 *  3) grayscale, then stretch the 2nd→98th luminance percentile onto 0→255 (robust to the
 *     panel glow, which a naive min/max stretch would be thrown off by),
 *  4) INVERT to dark-text-on-light — Tesseract is trained on black-on-white, so this alone
 *     meaningfully improves accuracy on this light-on-dark HUD,
 *  5) when `binarize`, hard-threshold via Otsu so digits/letters become crisp solid black
 *     (used for the objectives column, where the exact commodity + SCU matter most).
 */
async function toCanvas(
  dataUrl: string,
  region?: Region,
  targetW = 2000,
  binarize = false,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataUrl)
  const sx = region ? region.x0 * img.width : 0
  const sy = region ? region.y0 * img.height : 0
  const sw = (region ? region.x1 - region.x0 : 1) * img.width
  const sh = (region ? region.y1 - region.y0 : 1) * img.height
  const scale = sw < targetW ? targetW / sw : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(sw * scale)
  canvas.height = Math.round(sh * scale)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  const n = px.length / 4

  // Grayscale into a buffer + build a luminance histogram.
  const gray = new Uint8ClampedArray(n)
  const hist = new Uint32Array(256)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) | 0
    gray[j] = g
    hist[g]++
  }

  // Percentile contrast stretch: map the 2nd→98th percentile luminance onto 0→255.
  let lo = 0
  let hi = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= n * 0.02) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= n * 0.98) {
      hi = v
      break
    }
  }
  const range = hi > lo ? hi - lo : 255

  // Stretched luminance into a buffer (+ its histogram, for Otsu when binarizing).
  const st = new Uint8ClampedArray(n)
  const shist = new Uint32Array(256)
  for (let j = 0; j < n; j++) {
    let v = ((gray[j] - lo) / range) * 255
    v = v < 0 ? 0 : v > 255 ? 255 : v
    const sv = v | 0
    st[j] = sv
    shist[sv]++
  }

  if (binarize) {
    // Bright (text) → black, dark (panel) → white: crisp black-on-white for OCR.
    const t = otsuThreshold(shist, n)
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const v = st[j] > t ? 0 : 255
      px[i] = px[i + 1] = px[i + 2] = v
    }
  } else {
    // Invert only: dark text on light background, preserving anti-aliased edges.
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const v = 255 - st[j]
      px[i] = px[i + 1] = px[i + 2] = v
    }
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/** A compact JPEG preview of a capture, kept on the card so the player can eyeball
 *  the source screenshot against the parsed text (click enlarges to full-res). */
async function makeThumb(dataUrl: string, maxW = 420): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, maxW / img.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.6)
}

// The PRIMARY OBJECTIVES column (right side of the contract screen). x0 is kept
// tight to the right so the middle DETAILS column doesn't bleed into the text.
const OBJECTIVES_REGION: Region = { x0: 0.59, y0: 0.14, x1: 1, y1: 0.85 }

// Same column at 32:9 ultrawide (e.g. Samsung Odyssey G9, 5120×1440). SC doesn't stretch
// the contract panel to the full width — it stays centered — so the objectives column sits
// in the MIDDLE of the frame (~0.55–0.73 wide), not against the right edge. Measured from
// real G9 captures. x1 stops before the panel's right border so nothing bleeds in.
const ULTRAWIDE_REGION: Region = { x0: 0.56, y0: 0.28, x1: 0.73, y1: 0.83 }

/**
 * Merge a clean read of the objectives column (commodity/scu/locations) with a
 * full-screen read (reward + container size + "Contracted By", which live in the
 * top header outside the objectives column and so only appear in the full read).
 */
function mergeParsed(primary: ParsedMission[], full: ParsedMission[]): ParsedMission[] {
  const base = primary.length ? primary : full
  const fb = full[0]
  return base.map((m, i) => ({
    ...m,
    containerScu: m.containerScu ?? full[i]?.containerScu ?? fb?.containerScu ?? null,
    reward: m.reward ?? full[i]?.reward ?? fb?.reward ?? null,
    contractedBy: m.contractedBy ?? full[i]?.contractedBy ?? fb?.contractedBy ?? null,
  }))
}

export default function ImportPanel({ onAdd }: { onAdd: (m: Omit<Mission, 'id'>) => string }) {
  // Read fresh each render so the desktop bridge is picked up once available.
  const bridge = typeof window !== 'undefined' ? window.hauler : undefined

  const [capturesDir, setCapturesDir] = useState('')
  const [count, setCount] = useState(1)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [newCapture, setNewCapture] = useState<string | null>(null)
  const cards = useStore((s) => s.pendingImports)
  const addPendingImports = useStore((s) => s.addPendingImports)
  const updatePendingImport = useStore((s) => s.updatePendingImport)
  const removePendingImport = useStore((s) => s.removePendingImport)
  const clearPendingImports = useStore((s) => s.clearPendingImports)
  const saveTemplate = useStore((s) => s.saveTemplate)
  const templates = useStore((s) => s.missionTemplates)
  const ocrMode = useStore((s) => s.ocrMode)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const ocrSrcRef = useRef<'local' | 'cdn'>('local')
  const forceCdnRef = useRef(false)

  useEffect(() => {
    if (!bridge) return
    bridge.getCapturesDir().then(setCapturesDir).catch(() => {})
    const off = bridge.onNewCapture((f) => setNewCapture(f.name))
    return off
  }, [bridge])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const getWorker = async () => {
    if (workerRef.current) return workerRef.current
    setStatus('Loading OCR engine…')
    // Prefer the bundled (fully offline) assets under /tesseract; fall back to the CDN
    // if local loading throws OR (later) if the local engine reads no text.
    const base = new URL('tesseract/', document.baseURI).href.replace(/\/$/, '')
    if (!forceCdnRef.current) {
      try {
        workerRef.current = await createWorker('eng', 1, {
          workerPath: `${base}/worker.min.js`,
          corePath: `${base}/core`,
          langPath: `${base}/lang`,
          workerBlobURL: false,
        })
        ocrSrcRef.current = 'local'
        return workerRef.current
      } catch {
        /* fall through to the online engine */
      }
    }
    setStatus('Loading OCR engine (online)…')
    workerRef.current = await createWorker('eng')
    ocrSrcRef.current = 'cdn'
    return workerRef.current
  }

  const importN = async () => {
    const b = window.hauler
    if (!b) return
    setError('')
    setNewCapture(null)
    try {
      const caps = await b.listCaptures()
      if (!caps.length) {
        setError('No screenshots in the capture folder yet. Take one in-game first.')
        return
      }
      const n = Math.max(1, Math.min(count || 1, caps.length))
      const pick = caps.slice(0, n)
      const worker = await getWorker()
      const collected: ImportContract[] = []
      let totalText = 0
      for (let idx = 0; idx < pick.length; idx++) {
        setStatus(`Reading screenshot ${idx + 1}/${pick.length}…`)
        const dataUrl = await b.readImage(pick[idx].path)
        if (!dataUrl) continue
        // Pick the objectives-column crop tuned to this screenshot's aspect ratio — SC centers
        // the contract panel differently per aspect, so a region tuned to 16:9 misses on 32:9.
        // 'auto' crops only a ratio we've tuned (16:9 or 32:9 ultrawide) and otherwise falls
        // back to whole-image OCR (layout-independent); 'crop' forces a crop, best-guessing by
        // ratio; 'full' never crops.
        let cropRegion: Region | null = null
        if (ocrMode !== 'full') {
          const probe = await loadImage(dataUrl)
          const ar = probe.width / probe.height
          if (Math.abs(ar - 16 / 9) < 0.15) cropRegion = OBJECTIVES_REGION
          else if (ar >= 3.0) cropRegion = ULTRAWIDE_REGION // 32:9 (Samsung Odyssey G9 & co.)
          else if (ocrMode === 'crop') cropRegion = OBJECTIVES_REGION
        }
        // Full screen (multi-column layout) → automatic page segmentation for reward/header.
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
        const fullText = (await worker.recognize(await toCanvas(dataUrl))).data.text
        // Objectives column → treat as a single uniform block, upscaled higher (it's a small
        // slice of a 4K frame) and binarized so each glyph carries enough crisp pixels.
        let cropText = ''
        if (cropRegion) {
          await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
          cropText = (await worker.recognize(await toCanvas(dataUrl, cropRegion, 3000, true))).data.text
        }
        totalText += fullText.trim().length + cropText.trim().length
        const merged = cropRegion
          ? mergeParsed(parseMissions(cropText), parseMissions(fullText))
          : parseMissions(fullText)
        if (!merged.length) continue
        const thumb = await makeThumb(dataUrl)
        const first = merged[0]
        // One screenshot = ONE contract. Each parsed objective becomes a delivery LEG under
        // it; legs share the contract's reward (counted once, on add) but keep their OWN
        // pickup(s) — a contract can collect different commodities from different stations,
        // so a leg must not inherit every other leg's pickup. `pickup` is the contract's
        // primary origin / fallback for legs OCR found no pickup for.
        collected.push({
          _id: nanoid(8),
          pickup: first.pickup || 'Origin',
          reward: first.reward ?? null,
          contractedBy: first.contractedBy ?? null,
          _thumb: thumb,
          _capPath: pick[idx].path,
          _capName: pick[idx].name,
          legs: merged.map<ImportLeg>((m) => ({
            commodity: m.commodity || 'Cargo',
            scu: Number(m.scu) || 0,
            containerScu: m.containerScu ?? null,
            dropoff: m.dropoff || 'Destination',
            pickups: m.pickups && m.pickups.length ? m.pickups : undefined,
          })),
        })
      }
      if (!collected.length) {
        // OCR read essentially nothing → the offline engine likely failed. Retry once online.
        if (totalText < 12 && ocrSrcRef.current === 'local' && !forceCdnRef.current) {
          forceCdnRef.current = true
          workerRef.current?.terminate()
          workerRef.current = null
          setStatus('')
          return importN() // re-run with the online engine
        }
        setError(
          totalText < 12
            ? 'OCR read no text from the image(s). The offline engine failed and the online one is unavailable — check your internet and retry.'
            : 'Read text, but no contract found. Capture the FULL contract screen (with the PRIMARY OBJECTIVES list visible), then retry.',
        )
      }
      // Recall saved layouts: any imported contract whose signature matches a saved template
      // gets its box splits / pickup layout filled in automatically (read live to avoid stale).
      const savedTemplates = useStore.getState().missionTemplates
      addPendingImports(collected.map((c) => applyTemplate(c, savedTemplates)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed.')
    } finally {
      setStatus('')
    }
  }

  // Add every delivery leg of a contract as its own mission (the planner routes each
  // drop-off separately), but count the contract's reward ONCE — on the first leg only,
  // so the earnings/total reflect the single contract reward, never a multiple.
  const addContract = (c: ImportContract) => {
    const contractId = nanoid(8) // shared by every leg so the list shows one grouped card
    // Stamp every leg with the contract's signature so later pickup-split edits can be learned
    // back into a saved template (and a re-import recalls them).
    const sig = contractSignature(c)
    c.legs.forEach((leg, i) => {
      // This leg's own pickups (falls back to the contract's primary pickup). origin = the
      // first; pickups[] only when this one commodity is genuinely split across stations.
      const legPickups = leg.pickups && leg.pickups.length ? leg.pickups : [c.pickup || 'Origin']
      // A recalled pickup-amount split (from a saved template) pre-fills the split chooser.
      const hasSplit = leg.pickupSplit && Object.keys(leg.pickupSplit).length > 0
      onAdd({
        contractId,
        title: c.contractedBy ?? undefined,
        origin: legPickups[0] || 'Origin',
        pickups: legPickups.length > 1 ? legPickups : undefined,
        destination: leg.dropoff || 'Destination',
        commodity: leg.commodity || 'Cargo',
        scu: Number(leg.scu) || 0,
        containerScu: leg.containerScu ?? undefined,
        containers: leg.containers && leg.containers.length ? leg.containers : undefined,
        reward: i === 0 ? (c.reward ?? undefined) : undefined,
        thumb: c._thumb,
        capturePath: c._capPath,
        templateSig: sig,
        pickupChoice: hasSplit ? PICKUP_SPLIT : undefined,
        pickupSplit: hasSplit ? leg.pickupSplit : undefined,
      })
    })
  }
  const update = (id: string, patch: Partial<ImportContract>) => updatePendingImport(id, patch)
  const discard = (id: string) => removePendingImport(id)
  const confirmOne = (c: ImportContract) => {
    addContract(c)
    discard(c._id)
  }
  const confirmAll = () => {
    cards.forEach(addContract)
    clearPendingImports()
  }
  // Re-read the full-res capture for the lightbox; fall back to the stored thumb.
  const openImage = async (c: ImportContract) => {
    const b = window.hauler
    if (c._capPath && b) {
      try {
        const full = await b.readImage(c._capPath)
        if (full) {
          setLightbox(full)
          return
        }
      } catch {
        /* fall through to thumb */
      }
    }
    if (c._thumb) setLightbox(c._thumb)
  }

  const busy = status !== ''

  // --- Desktop-only notice (browser/dev preview) ---
  if (!bridge) {
    return (
      <section className="import-panel panel">
        <h3 className="section-label">Import from Screenshot</h3>
        <p className="muted sm">
          Screenshot import runs in the desktop app (HAULER OPS.exe). Point OBS's screenshot output
          to the capture folder, bind your HOTAS key to OBS's “Screenshot” hotkey, then choose how
          many recent captures to read. It's read on your device with free OCR — no account, no cost.
        </p>
      </section>
    )
  }

  return (
    <section className="import-panel panel">
      <div className="import-head">
        <h3 className="section-label">Import from Screenshot</h3>
        <div className="import-actions">
          <label className="import-count">
            <span className="hud-label">Last</span>
            <input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <button className="btn btn--primary" onClick={importN} disabled={busy}>
            {busy ? status || 'Reading…' : `Import last ${count}`}
          </button>
        </div>
      </div>

      <p className="muted sm capture-dir">
        Read on your device with free OCR. OBS screenshot folder:{' '}
        <code>{capturesDir || '…'}</code>
        <span className="dir-hint"> — change it in Settings ⚙</span>
      </p>

      {newCapture && (
        <div className="new-capture-banner" onClick={importN}>
          📸 New screenshot: <strong>{newCapture}</strong> — click to import
        </div>
      )}

      {error && <p className="import-error">⚠ {error}</p>}

      {cards.length > 0 && (
        <div className="confirm-stack">
          <div className="confirm-stack-head">
            <span className="hud-label">Review {cards.length} contract(s) — fix anything OCR missed</span>
            <button className="btn btn--sm btn--primary" onClick={confirmAll}>
              Add all
            </button>
          </div>
          {cards.map((c) => (
            <ContractCard
              key={c._id}
              contract={c}
              templateState={templateStatus(buildTemplate(c), templates)}
              onChange={(patch) => update(c._id, patch)}
              onConfirm={() => confirmOne(c)}
              onDiscard={() => discard(c._id)}
              onSave={() => saveTemplate(c)}
              onOpenImage={() => openImage(c)}
            />
          ))}
        </div>
      )}

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </section>
  )
}

function ContractCard({
  contract,
  templateState,
  onChange,
  onConfirm,
  onDiscard,
  onSave,
  onOpenImage,
}: {
  contract: ImportContract
  /** Save state: unsaved / synced (saved & current) / dirty (edited since save). */
  templateState: TemplateStatus
  onChange: (patch: Partial<ImportContract>) => void
  onConfirm: () => void
  onDiscard: () => void
  onSave: () => void
  onOpenImage: () => void
}) {
  const setLeg = (i: number, patch: Partial<ImportLeg>) =>
    onChange({ legs: contract.legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) })
  const removeLeg = (i: number) => onChange({ legs: contract.legs.filter((_, idx) => idx !== i) })
  const addLeg = () => {
    const last = contract.legs[contract.legs.length - 1]
    onChange({
      legs: [
        ...contract.legs,
        {
          commodity: last?.commodity ?? 'Cargo',
          scu: 0,
          containerScu: last?.containerScu ?? null,
          dropoff: '',
        },
      ],
    })
  }
  const totalScu = contract.legs.reduce((s, l) => s + (Number(l.scu) || 0), 0)

  return (
    <div className={`contract-card ${contract.checked ? 'checked' : ''}`}>
      <div className="contract-top">
        {contract._thumb && (
          <button
            className="ss-thumb-btn"
            onClick={onOpenImage}
            title={`Click to enlarge${contract._capName ? ` — ${contract._capName}` : ' the source screenshot'}`}
          >
            <img className="ss-thumb" src={contract._thumb} alt="source screenshot" />
            <span className="ss-thumb-zoom">⛶</span>
          </button>
        )}
        <div className="contract-headline">
          {contract._recalled && (
            <span
              className="recall-badge"
              title="Recognized from a saved template — box splits & pickups were filled in automatically. Edit anything that's off."
            >
              ↩ saved layout applied
            </span>
          )}
          <input
            className="contract-title"
            value={contract.contractedBy ?? ''}
            placeholder="Contracted by"
            onChange={(e) => onChange({ contractedBy: e.target.value })}
          />
          <div className="contract-meta">
            <label
              className="field"
              title="The contract's primary pickup — used as the default for any delivery below that has no pickup of its own."
            >
              <span className="hud-label">Default Pickup</span>
              <input value={contract.pickup} onChange={(e) => onChange({ pickup: e.target.value })} />
            </label>
            <label className="field field--sm" title="The single contract reward — counted once for the whole contract, not per delivery.">
              <span className="hud-label">Reward</span>
              <input
                type="number"
                value={contract.reward ?? ''}
                placeholder="aUEC"
                onChange={(e) => onChange({ reward: e.target.value ? Number(e.target.value) : null })}
              />
            </label>
            <span className="contract-total hud-label">
              {contract.legs.length} drop{contract.legs.length === 1 ? '' : 's'} · {totalScu} SCU
            </span>
          </div>
        </div>
        <div className="confirm-btns">
          <button className="btn btn--sm btn--primary" onClick={onConfirm}>
            ✓ Add
          </button>
          <button
            className={`btn btn--sm tpl-save ${templateState === 'synced' ? 'on' : ''} ${templateState === 'dirty' ? 'dirty' : ''}`}
            onClick={onSave}
            title={
              templateState === 'synced'
                ? 'Saved — this layout auto-applies on a future import.'
                : templateState === 'dirty'
                  ? 'Changed since you saved — click to update the saved layout.'
                  : 'Save this box layout & pickups so a future import of the same contract fills them in automatically'
            }
          >
            <SaveIcon /> {templateState === 'synced' ? 'Saved' : templateState === 'dirty' ? 'Update' : 'Save'}
          </button>
          <button
            className={`btn btn--sm box-check ${contract.checked ? 'on' : ''}`}
            onClick={() => onChange({ checked: !contract.checked })}
            title="Mark this contract as reviewed/verified"
          >
            {contract.checked ? '✓ Checked' : 'Box Check'}
          </button>
          <button className="btn btn--sm btn--danger" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>

      <div className="contract-legs">
        {contract.legs.map((leg, i) => (
          <div className="leg-row" key={i}>
            <div className="leg-fields">
              <span className="commodity-dot" style={{ background: commodityColor(leg.commodity) }} />
              <label className="field">
                <span className="hud-label">Commodity</span>
                <input value={leg.commodity} onChange={(e) => setLeg(i, { commodity: e.target.value })} />
              </label>
              <label className="field field--sm">
                <span className="hud-label">SCU</span>
                <input
                  type="number"
                  value={leg.scu}
                  onChange={(e) => setLeg(i, { scu: Number(e.target.value) || 0 })}
                />
              </label>
              <label
                className="field field--sm"
                title="The container size the contract provides (e.g. “packaged in 4 SCU or smaller” → 4). Sets how the SCU splits into boxes. Leave 'auto' to use the global max box size."
              >
                <span className="hud-label">Box SCU ⓘ</span>
                <input
                  type="number"
                  value={leg.containerScu ?? ''}
                  placeholder="auto"
                  onChange={(e) => setLeg(i, { containerScu: e.target.value ? Number(e.target.value) : null })}
                />
              </label>
              <label className="field">
                <span className="hud-label">Destination</span>
                <input value={leg.dropoff} onChange={(e) => setLeg(i, { dropoff: e.target.value })} />
              </label>
              <label
                className="field"
                title="Where THIS commodity is collected. Leave blank to use the contract's Default Pickup. If this one commodity is split across stations, list them all separated with | ."
              >
                <span className="hud-label">Pickup ⓘ</span>
                <input
                  value={(leg.pickups ?? []).join(' | ')}
                  placeholder={contract.pickup || 'pickup station'}
                  onChange={(e) =>
                    setLeg(i, {
                      pickups: e.target.value
                        .split('|')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              {contract.legs.length > 1 && (
                <button
                  className="btn btn--sm btn--danger leg-remove"
                  onClick={() => removeLeg(i)}
                  title="Remove this delivery"
                >
                  ✕
                </button>
              )}
            </div>
            <BoxEditor
              boxes={leg.containers ?? []}
              scu={Number(leg.scu) || 0}
              onChange={(c) => setLeg(i, { containers: c })}
            />
          </div>
        ))}
        <button className="btn btn--sm leg-add" onClick={addLeg} title="Add another delivery to this contract">
          + Add delivery
        </button>
      </div>
    </div>
  )
}
