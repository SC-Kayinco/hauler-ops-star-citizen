import { useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import type { BayBaseFace, BayFill, CargoBay, Ship } from '@/types'
import { BASE_FACE_LABEL, accessLabel, fillOptions, isFloorBay, resolveBaseFace } from '@/lib/bayFace'

const BASE_FACES: BayBaseFace[] = ['bottom', 'left', 'right', 'top', 'back', 'front']

/** Keep the legacy mount/side fields in sync with the chosen base surface (for back-compat reads). */
function baseFacePatch(face: BayBaseFace): Partial<CargoBay> {
  return {
    baseFace: face,
    mount: face === 'bottom' ? 'floor' : 'wall',
    side: face === 'left' ? 'left' : face === 'right' ? 'right' : undefined,
  }
}

export default function CargoGridEditor({ ship }: { ship: Ship }) {
  const updateShip = useStore((s) => s.updateShip)

  const setBays = (bays: CargoBay[]) => updateShip(ship.id, { bays })

  const updateBay = (bayId: string, patch: Partial<CargoBay>) =>
    setBays(ship.bays.map((b) => (b.id === bayId ? { ...b, ...patch } : b)))

  const addBay = () => {
    const n = ship.bays.length + 1
    setBays([
      ...ship.bays,
      {
        id: `bay${n}-${Math.floor(performance.now())}`,
        name: `Bay ${n}`,
        width: 2,
        length: 4,
        maxStackHeight: 2,
        doorEdge: 'back',
        blockedCells: [],
        mount: 'floor',
        baseFace: 'bottom',
      },
    ])
  }

  const removeBay = (bayId: string) => setBays(ship.bays.filter((b) => b.id !== bayId))

  // ---- Reorder bays (drag handle + ↑/↓). Array order drives the 3D layout position:
  // same-face racks/floors are placed along the hull in this order, so reordering here
  // moves a bay's spot in the Load Plan too. ----
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= ship.bays.length) return
    const next = ship.bays.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setBays(next)
  }

  const panelRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragFrom = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  /** Which bay row the pointer is currently over (by vertical midpoint). */
  const computeOver = (clientY: number) => {
    for (let i = 0; i < ship.bays.length; i++) {
      const r = panelRefs.current[i]?.getBoundingClientRect()
      if (r && clientY < r.top + r.height / 2) return i
    }
    return ship.bays.length - 1
  }
  const onHandleDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragFrom.current = i
    setDragIndex(i)
    setOverIndex(i)
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (dragFrom.current === null) return
    setOverIndex(computeOver(e.clientY))
  }
  const onHandleUp = (e: React.PointerEvent) => {
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    const from = dragFrom.current
    if (from !== null) reorder(from, computeOver(e.clientY))
    dragFrom.current = null
    setDragIndex(null)
    setOverIndex(null)
  }

  // Live tally of the grid you've built vs the ship's rated capacity (entered by hand).
  const gridTotal = ship.bays.reduce((s, b) => s + b.width * b.length * b.maxStackHeight, 0)
  const cap = ship.cargoScu
  const match = cap > 0 && gridTotal === cap
  const over = cap > 0 && gridTotal > cap

  const toggleCell = (bay: CargoBay, x: number, z: number) => {
    const key = `${x},${z}`
    const has = bay.blockedCells.includes(key)
    updateBay(bay.id, {
      blockedCells: has
        ? bay.blockedCells.filter((c) => c !== key)
        : [...bay.blockedCells, key],
    })
  }

  return (
    <section className="grid-editor">
      <div className="grid-editor-head">
        <div>
          <h3 className="section-label">Cargo Grid Editor</h3>
          <p className="muted sm">
            Set each bay's surface grid (Width × Length) in SCU cells, then <strong>Depth</strong> for
            how many SCU build out from the <strong>Base surface</strong>. Floor holds stack up; wing /
            wall racks build sideways out of the hull. Click cells to block unusable spots (pillars, gear).
          </p>
        </div>
        <div className="grid-editor-head-right">
          <div className={`grid-cap ${match ? 'ok' : over ? 'over' : ''}`}>
            <span className="hud-label">Grid vs ship</span>
            <span className="grid-cap-val">
              {gridTotal} / {cap} SCU
            </span>
            <span className="grid-cap-note">
              {cap === 0
                ? 'set the ship’s cargo SCU'
                : match
                  ? '✓ matches capacity'
                  : over
                    ? `${gridTotal - cap} SCU over`
                    : `${cap - gridTotal} SCU to go`}
            </span>
          </div>
          <button className="btn btn--sm" onClick={addBay}>
            + Add Bay
          </button>
        </div>
      </div>

      <div className="bay-list">
        {ship.bays.map((bay, i) => (
          <div
            className={`bay-editor panel${dragIndex === i ? ' bay-editor--dragging' : ''}${
              overIndex === i && dragIndex !== null && dragIndex !== i ? ' bay-editor--over' : ''
            }`}
            key={bay.id}
            ref={(el) => {
              panelRefs.current[i] = el
            }}
          >
            <div className="bay-editor-controls">
              <div className="bay-reorder">
                <button
                  className="bay-drag-handle"
                  title="Drag up / down to reorder this bay"
                  onPointerDown={onHandleDown(i)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                >
                  ⠿
                </button>
                <button
                  className="bay-move"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => reorder(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  className="bay-move"
                  title="Move down"
                  disabled={i === ship.bays.length - 1}
                  onClick={() => reorder(i, i + 1)}
                >
                  ↓
                </button>
              </div>
              <input
                className="bay-name"
                value={bay.name}
                onChange={(e) => updateBay(bay.id, { name: e.target.value })}
              />
              <NumField
                label="Width"
                value={bay.width}
                min={1}
                max={20}
                onChange={(v) => updateBay(bay.id, { width: v })}
              />
              <NumField
                label="Length"
                value={bay.length}
                min={1}
                max={200}
                onChange={(v) => updateBay(bay.id, { length: v })}
              />
              <NumField
                label={isFloorBay(bay) ? 'Height ↑' : 'Depth out'}
                value={bay.maxStackHeight}
                min={1}
                max={12}
                onChange={(v) => updateBay(bay.id, { maxStackHeight: v })}
              />
              <NumField
                label="Door max SCU"
                value={bay.maxContainerScu ?? 0}
                min={0}
                max={32}
                onChange={(v) => updateBay(bay.id, { maxContainerScu: v || undefined })}
              />
              <label className="num-field" title="The surface containers attach to. Cargo builds outward from it.">
                <span className="hud-label">Base surface</span>
                <select
                  value={resolveBaseFace(bay)}
                  onChange={(e) => updateBay(bay.id, baseFacePatch(e.target.value as BayBaseFace))}
                >
                  {BASE_FACES.map((f) => (
                    <option key={f} value={f}>
                      {BASE_FACE_LABEL[f]}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="num-field"
                title="Which way cargo anchors/fills on the surface — e.g. a wall rack that hangs from the ceiling down (flip top↔bottom). Mirrors the grid in 2D & 3D."
              >
                <span className="hud-label">Fill direction</span>
                <select
                  value={bay.fill ?? 'default'}
                  onChange={(e) => updateBay(bay.id, { fill: e.target.value as BayFill })}
                >
                  {fillOptions(bay).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {ship.bays.length > 1 && (
                <button className="btn btn--sm btn--danger" onClick={() => removeBay(bay.id)}>
                  Remove
                </button>
              )}
            </div>

            <div className="bay-meta hud-label">
              {bay.width} W × {bay.length} L × {bay.maxStackHeight} {isFloorBay(bay) ? 'H' : 'D'} ={' '}
              {bay.width * bay.length * bay.maxStackHeight} SCU · {BASE_FACE_LABEL[resolveBaseFace(bay)]}
            </div>

            <BayGrid
              bay={bay}
              onToggle={(x, z) => toggleCell(bay, x, z)}
              onResize={(w, l) => updateBay(bay.id, { width: w, length: l })}
            />
            <div className="door-strip hud-label">{accessLabel(bay)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function BayGrid({
  bay,
  onToggle,
  onResize,
}: {
  bay: CargoBay
  onToggle: (x: number, z: number) => void
  onResize: (w: number, l: number) => void
}) {
  const cell = Math.max(12, Math.min(26, Math.floor(520 / Math.max(bay.width, bay.length))))
  const drag = useRef<{ px: number; py: number; w: number; l: number } | null>(null)

  const onHandleDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, w: bay.width, l: bay.length }
  }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const d = drag.current
    const w = Math.max(1, Math.min(20, d.w + Math.round((e.clientX - d.px) / cell)))
    const l = Math.max(1, Math.min(200, d.l + Math.round((e.clientY - d.py) / cell)))
    if (w !== bay.width || l !== bay.length) onResize(w, l)
  }
  const onHandleUp = (e: React.PointerEvent) => {
    drag.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  const rows = []
  for (let z = 0; z < bay.length; z++) {
    const cells = []
    for (let x = 0; x < bay.width; x++) {
      const blocked = bay.blockedCells.includes(`${x},${z}`)
      cells.push(
        <button
          key={x}
          className={`cell ${blocked ? 'blocked' : ''}`}
          style={{ width: cell, height: cell }}
          onClick={() => onToggle(x, z)}
          title={`x${x} z${z}`}
        />,
      )
    }
    rows.push(
      <div className="cell-row" key={z}>
        {cells}
      </div>,
    )
  }
  return (
    <div className="bay-grid-wrap">
      <div className="bay-grid">{rows}</div>
      <div
        className="bay-resize"
        title="Drag to resize the grid (width × length)"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
      />
    </div>
  )
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="num-field">
      <span className="hud-label">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
      />
    </label>
  )
}
