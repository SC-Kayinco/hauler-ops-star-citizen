import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Edges, Html, Grid, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '@/store/useStore'
import type { BayBaseFace, BayFill, CargoBay, Ship } from '@/types'
import type { ContainerSize } from '@/data/containers'
import { BASE_FACE_LABEL, fillOptions, resolveBaseFace } from '@/lib/bayFace'
import { faceRot, layoutBays } from '@/components/plan/CargoBay3D'

const DEG = Math.PI / 180
const BASE_FACES: BayBaseFace[] = ['bottom', 'left', 'right', 'top', 'back', 'front']

/** Keep the legacy mount/side fields in sync with the chosen base surface (for back-compat reads). */
function baseFacePatch(face: BayBaseFace): Partial<CargoBay> {
  return {
    baseFace: face,
    mount: face === 'bottom' ? 'floor' : 'wall',
    side: face === 'left' ? 'left' : face === 'right' ? 'right' : undefined,
  }
}

/** Usable SCU of one bay: floor cells minus blocked columns, times stack height. */
function bayScu(b: CargoBay): number {
  const blocked = b.blockedCells.filter((k) => {
    const [x, z] = k.split(',').map(Number)
    return x >= 0 && z >= 0 && x < b.width && z < b.length
  }).length
  return (b.width * b.length - blocked) * b.maxStackHeight
}

const round2 = (v: number) => Math.round(v * 100) / 100
const snap5deg = (rad: number) => Math.round(rad / DEG / 5) * 5

/** "MOTH Wing LEFT" → "MOTH Wing RIGHT" (and vice versa); otherwise append "(mirror)". */
function mirrorName(name: string): string {
  const flip = (m: string, to: string) => (m === m.toUpperCase() ? to.toUpperCase() : to)
  if (/left/i.test(name)) return name.replace(/left/gi, (m) => flip(m, 'Right'))
  if (/right/i.test(name)) return name.replace(/right/gi, (m) => flip(m, 'Left'))
  return `${name} (mirror)`
}

/**
 * W×L×H for a requested SCU amount. Standard sizes use the REAL Star Citizen container
 * footprints from the editable Container Sizes list (8 → 2×2×2 cube, 16 → 2×4×2,
 * 32 → 2×8×2 …); unknown amounts fall back to a boxy factorization.
 */
function dimsForScu(scu: number, sizes: ContainerSize[]): { w: number; l: number; h: number } {
  const n = Math.max(1, Math.floor(scu))
  const known = sizes.find((s) => s.scu === n)
  if (known) return { w: known.w, l: known.l, h: known.h }
  const h = n >= 16 && n % 2 === 0 ? 2 : 1
  const area = n / h
  let w = Math.max(1, Math.floor(Math.sqrt(area)))
  while (area % w) w--
  return { w, l: area / w, h }
}

/**
 * Gizmo axis lock, stored as the THREE.js axis but keyed BLENDER-style: the X key locks X,
 * the Z key locks the VERTICAL axis (three Y), the Y key locks DEPTH (three Z).
 */
type AxisLock = 'x' | 'y' | 'z' | null
const BLENDER_KEY_TO_AXIS: Record<string, Exclude<AxisLock, null>> = { x: 'x', z: 'y', y: 'z' }
const AXIS_LABEL: Record<Exclude<AxisLock, null>, string> = { x: 'X', y: 'Z (up)', z: 'Y (depth)' }

/**
 * Which base face a clicked box face corresponds to: for each candidate face, the canonical
 * plate-outward direction is faceRot(face) applied to local "down" (0,-1,0); the face whose
 * outward direction best matches the clicked face's world normal wins.
 */
function pickFaceFromNormal(worldNormal: THREE.Vector3): BayBaseFace {
  let best: BayBaseFace = 'bottom'
  let bestDot = -Infinity
  for (const f of BASE_FACES) {
    const r = faceRot({ baseFace: f } as CargoBay)
    const v = new THREE.Vector3(0, -1, 0).applyEuler(new THREE.Euler(r[0], r[1], r[2]))
    const d = worldNormal.dot(v)
    if (d > bestDot) {
      bestDot = d
      best = f
    }
  }
  return best
}

/**
 * Fullscreen 3D bay editor ("Blender for cargo grids"). Works on a DRAFT copy of the
 * ship's bays — nothing touches the ship until Save. Part 2 skeleton: premium base-plate
 * rendering, click-select, right-hand property panel (name / size / position / rotation /
 * SCU budget), Save/Cancel.
 */
export default function BayDesigner({ ship, onClose }: { ship: Ship; onClose: () => void }) {
  const updateShip = useStore((s) => s.updateShip)
  const [draft, setDraft] = useState<CargoBay[]>(() =>
    ship.bays.map((b) => ({ ...b, blockedCells: [...b.blockedCells] })),
  )
  const [selId, setSelId] = useState<string | null>(draft[0]?.id ?? null)
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate')
  const [axis, setAxis] = useState<AxisLock>(null)
  const [baseMode, setBaseMode] = useState(false)
  const [addScu, setAddScu] = useState(32)
  const sizes = useStore((s) => s.containerSizes)

  const layout = useMemo(() => layoutBays(draft), [draft])
  const radius = Math.max(layout.bx, layout.bz, layout.by * 2) * 0.6 + 6
  const sel = draft.find((b) => b.id === selId) ?? null
  const selEntry = sel ? layout.placed.find((p) => p.bay.id === sel.id) ?? null : null

  const totalScu = draft.reduce((s, b) => s + bayScu(b), 0)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(ship.bays), [draft, ship.bays])

  const patchBay = (id: string, patch: Partial<CargoBay>) =>
    setDraft((d) => d.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  /** The bay's placement, seeding one from its current automatic transform on first edit. */
  const placementOf = (b: CargoBay): NonNullable<CargoBay['placement']> => {
    if (b.placement) return b.placement
    const e = layout.placed.find((p) => p.bay.id === b.id)
    const pos = e?.pos ?? [0, 0, 0]
    const rot = e?.rot ?? [0, 0, 0]
    return {
      x: round2(pos[0]),
      y: round2(pos[1]),
      z: round2(pos[2]),
      rx: Math.round(rot[0] / DEG),
      ry: Math.round(rot[1] / DEG),
      rz: Math.round(rot[2] / DEG),
    }
  }
  const setPlacement = (b: CargoBay, patch: Partial<NonNullable<CargoBay['placement']>>) =>
    patchBay(b.id, { placement: { ...placementOf(b), ...patch } })

  /** Resize, dropping blocked cells that fell outside the new footprint. */
  const resize = (b: CargoBay, patch: Partial<Pick<CargoBay, 'width' | 'length' | 'maxStackHeight'>>) => {
    const w = patch.width ?? b.width
    const l = patch.length ?? b.length
    const blockedCells = b.blockedCells.filter((k) => {
      const [x, z] = k.split(',').map(Number)
      return x < w && z < l
    })
    patchBay(b.id, { ...patch, blockedCells })
  }

  // ---- Add / duplicate / mirror / delete (all on the draft) ----
  const addBay = (scu: number) => {
    const { w, l, h } = dimsForScu(scu, sizes)
    const bay: CargoBay = {
      id: `bay-${Date.now()}`,
      name: `Area ${draft.length + 1}`,
      width: w,
      length: l,
      maxStackHeight: h,
      doorEdge: 'back',
      blockedCells: [],
      mount: 'floor',
      baseFace: 'bottom',
    }
    setDraft((d) => [...d, bay])
    setSelId(bay.id)
  }

  const duplicateBay = (mirror: boolean) => {
    if (!sel) return
    const p = placementOf(sel)
    const copy: CargoBay = {
      ...sel,
      blockedCells: [...sel.blockedCells],
      id: `bay-${Date.now()}`,
      name: mirror ? mirrorName(sel.name) : `${sel.name} copy`,
      placement: mirror
        ? { ...p, x: -p.x, ry: -p.ry, rz: -p.rz }
        : { ...p, x: p.x + sel.width + 1 },
    }
    if (mirror) {
      const f = sel.baseFace
      if (f === 'left' || f === 'right') Object.assign(copy, baseFacePatch(f === 'left' ? 'right' : 'left'))
    }
    setDraft((d) => [...d, copy])
    setSelId(copy.id)
  }

  const deleteBay = () => {
    if (!sel) return
    setDraft((d) => d.filter((b) => b.id !== sel.id))
    setSelId(null)
  }

  /** Click a plate square (selected bay) → toggle that cell blocked/usable. */
  const toggleCell = (bay: CargoBay, x: number, z: number) => {
    const key = `${x},${z}`
    const has = bay.blockedCells.includes(key)
    patchBay(bay.id, {
      blockedCells: has ? bay.blockedCells.filter((c) => c !== key) : [...bay.blockedCells, key],
    })
  }

  /** Base-pick mode: clicking a FACE of the selected bay makes it the mounting surface.
   *  A manually-placed bay keeps its position but its rotation snaps to the new face. */
  const pickBaseFace = (bay: CargoBay, face: BayBaseFace) => {
    const patch: Partial<CargoBay> = baseFacePatch(face)
    if (bay.placement) {
      const r = faceRot({ baseFace: face } as CargoBay)
      patch.placement = {
        ...bay.placement,
        rx: Math.round(r[0] / DEG),
        ry: Math.round(r[1] / DEG),
        rz: Math.round(r[2] / DEG),
      }
    }
    patchBay(bay.id, patch)
    setBaseMode(false)
  }

  // ---- Gizmo: TransformControls drives an invisible proxy; every change is snapped
  // (1 SCU translate / 5° rotate) and written straight into the draft placement, so the
  // real bay follows live. The proxy is re-synced from the layout whenever not dragging.
  const [proxy, setProxy] = useState<THREE.Mesh | null>(null)
  const draggingRef = useRef(false)
  useEffect(() => {
    if (!proxy || !selEntry || draggingRef.current) return
    proxy.position.set(selEntry.pos[0], selEntry.pos[1], selEntry.pos[2])
    proxy.rotation.set(selEntry.rot[0], selEntry.rot[1], selEntry.rot[2])
  })
  const onGizmoChange = useCallback(() => {
    if (!proxy || !sel) return
    patchBay(sel.id, {
      placement: {
        x: round2(proxy.position.x),
        y: round2(proxy.position.y),
        z: round2(proxy.position.z),
        rx: snap5deg(proxy.rotation.x),
        ry: snap5deg(proxy.rotation.y),
        rz: snap5deg(proxy.rotation.z),
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxy, sel?.id])

  const save = () => {
    updateShip(ship.id, { bays: draft })
    onClose()
  }
  const cancel = () => {
    if (dirty && !confirm('Discard the changes made in the Designer?')) return
    onClose()
  }

  // Blender-style keys: G = move, R = rotate, then X/Y/Z locks that axis (Blender frame:
  // Z = up, Y = depth — pressing the same key again unlocks). Del = delete bay,
  // Esc = clear axis lock → deselect → close. Never while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      const k = e.key.toLowerCase()
      if (k === 'g') {
        setMode('translate')
        setAxis(null)
        setBaseMode(false)
      } else if (k === 'r') {
        setMode('rotate')
        setAxis(null)
        setBaseMode(false)
      } else if (k === 'b') {
        setBaseMode((v) => !v)
      } else if (k in BLENDER_KEY_TO_AXIS) {
        const a = BLENDER_KEY_TO_AXIS[k]
        setAxis((cur) => (cur === a ? null : a))
      } else if (k === 'delete') {
        deleteBay()
      } else if (k === 'escape') {
        if (baseMode) {
          setBaseMode(false)
          return
        }
        if (axis) {
          setAxis(null)
          return
        }
        setSelId((cur) => {
          if (cur) return null
          cancel()
          return cur
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, sel?.id, axis, baseMode])

  // Changing selection drops the axis lock and base-pick mode.
  useEffect(() => {
    setAxis(null)
    setBaseMode(false)
  }, [selId])

  const accent = ship.accent ?? '#4db8e8'

  return (
    <div className="bay-designer">
      <div className="bd-scene">
        <Canvas
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 2]}
          camera={{ position: [radius * 0.85, layout.by / 2 + radius * 0.7, radius * 0.95] }}
          onPointerMissed={() => setSelId(null)}
        >
          <fog attach="fog" args={['#06131f', radius * 1.8, radius * 4.5]} />
          <ambientLight intensity={0.7} />
          <hemisphereLight args={['#9fd8ff', '#0a2236', 0.55]} />
          <pointLight position={[radius, radius * 1.4, radius]} intensity={radius * radius * 1.1} color={accent} />
          <pointLight position={[-radius, radius * 0.6, -radius]} intensity={radius * radius * 0.4} color="#2a6a90" />

          {layout.placed.map(({ bay, pos, rot }) => (
            <DesignerBay
              key={bay.id}
              bay={bay}
              pos={pos}
              rot={rot}
              accent={accent}
              selected={bay.id === selId}
              baseMode={baseMode && bay.id === selId}
              onSelect={() => setSelId(bay.id)}
              onPickFace={(f) => pickBaseFace(bay, f)}
              onToggleCell={(x, z) => toggleCell(bay, x, z)}
            />
          ))}

          {/* invisible proxy the gizmo grabs — its snapped transform is written into the draft */}
          {sel && (
            <mesh ref={setProxy} visible={false}>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
            </mesh>
          )}
          {sel && proxy && !baseMode && (
            <TransformControls
              object={proxy}
              mode={mode}
              translationSnap={1}
              rotationSnap={5 * DEG}
              showX={!axis || axis === 'x'}
              showY={!axis || axis === 'y'}
              showZ={!axis || axis === 'z'}
              onObjectChange={onGizmoChange}
              onMouseDown={() => (draggingRef.current = true)}
              onMouseUp={() => (draggingRef.current = false)}
              size={0.9}
            />
          )}

          <Grid
            position={[0, -0.04, 0]}
            args={[radius * 4, radius * 4]}
            cellSize={1}
            cellThickness={0.5}
            cellColor={accent}
            sectionSize={4}
            sectionThickness={1}
            sectionColor={accent}
            fadeDistance={radius * 3}
            fadeStrength={1.5}
            infiniteGrid
          />
          <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.1} minDistance={2} maxDistance={radius * 5} />
        </Canvas>

        <span className="holo-corner tl" />
        <span className="holo-corner tr" />
        <span className="holo-corner bl" />
        <span className="holo-corner br" />

        <div className="bd-toolbar">
          <button
            className={`view-btn ${mode === 'translate' ? 'on' : ''}`}
            onClick={() => setMode('translate')}
            title="Move the selected bay (1 SCU snap)"
          >
            Move<span className="view-key">G</span>
          </button>
          <button
            className={`view-btn ${mode === 'rotate' ? 'on' : ''}`}
            onClick={() => setMode('rotate')}
            title="Rotate the selected bay (5° snap)"
          >
            Rotate<span className="view-key">R</span>
          </button>
          {sel && (
            <>
              <button
                className={`view-btn ${baseMode ? 'on' : ''}`}
                onClick={() => setBaseMode((v) => !v)}
                title="Pick the mounting surface — click the face of the bay it attaches to"
              >
                Base<span className="view-key">B</span>
              </button>
              <button className="view-btn" onClick={() => duplicateBay(false)} title="Duplicate this bay next to itself">
                Duplicate
              </button>
              <button
                className="view-btn"
                onClick={() => duplicateBay(true)}
                title="Mirrored copy on the other side of the hull (LEFT rack → RIGHT rack)"
              >
                Mirror ⇋
              </button>
              <button className="view-btn reset" onClick={deleteBay} title="Delete this bay (Del)">
                Delete
              </button>
            </>
          )}
        </div>

        <div className="cargo3d-edithint hud-label">
          {sel
            ? baseMode
              ? 'BASE PICK — click the face this bay mounts on (the plate moves there) · Esc to cancel'
              : axis
                ? `Locked to ${AXIS_LABEL[axis]} — ${mode === 'translate' ? 'move' : 'rotate'} on that axis only · same key or Esc to unlock`
                : `Drag the gizmo to ${mode === 'translate' ? 'move (1 SCU snap)' : 'rotate (5° snap)'} · G/R switch · X/Y/Z lock an axis (Z = up) · B base face · click a plate square to block it`
            : 'Click a bay to select it · G move · R rotate · B base face'}
        </div>
      </div>

      <aside className="bd-panel">
        <div className="bd-head">
          <span className="hud-label">◧ 3D BAY DESIGNER</span>
          <h2>{ship.name}</h2>
        </div>

        <div className={`bd-total ${totalScu > ship.cargoScu ? 'over' : ''}`}>
          <span className="hud-label">Grid total</span>
          <strong>
            {totalScu} <span className="bd-cap">/ {ship.cargoScu} SCU</span>
          </strong>
        </div>

        <div className="bd-add">
          <span className="hud-label">Add container area</span>
          <div className="bd-chips">
            {[...sizes]
              .sort((a, b) => a.scu - b.scu)
              .map((s) => (
                <button
                  key={s.scu}
                  className="bd-chip"
                  onClick={() => addBay(s.scu)}
                  title={`${s.scu} SCU container = ${s.w}×${s.l}×${s.h} cells (real SC footprint — editable in Container Sizes)`}
                >
                  {s.scu}
                </button>
              ))}
          </div>
          <div className="bd-add-row">
            <Num value={addScu} min={1} onChange={setAddScu} />
            <button
              className="btn btn--sm"
              onClick={() => addBay(addScu)}
              title="Creates a bay sized for this many SCU (standard sizes use the real container footprint)"
            >
              + Add {dimsForScu(addScu, sizes).w}×{dimsForScu(addScu, sizes).l}×{dimsForScu(addScu, sizes).h}
            </button>
          </div>
        </div>

        <div className="bd-baylist">
          {draft.map((b) => (
            <button
              key={b.id}
              className={`bd-bayrow ${b.id === selId ? 'sel' : ''}`}
              onClick={() => setSelId(b.id)}
            >
              <span className="bd-bayname">{b.name}</span>
              <span className="bd-baydims">
                {b.width}×{b.length}×{b.maxStackHeight} · {bayScu(b)} SCU
              </span>
            </button>
          ))}
        </div>

        {sel ? (
          <div className="bd-fields">
            <label className="field">
              <span className="hud-label">Name</span>
              <input value={sel.name} onChange={(e) => patchBay(sel.id, { name: e.target.value })} />
            </label>

            <span className="hud-label">Size (W × L × H, SCU)</span>
            <div className="bd-row3">
              <Num value={sel.width} min={1} onChange={(v) => resize(sel, { width: v })} />
              <Num value={sel.length} min={1} onChange={(v) => resize(sel, { length: v })} />
              <Num value={sel.maxStackHeight} min={1} onChange={(v) => resize(sel, { maxStackHeight: v })} />
            </div>

            <label className="field">
              <span className="hud-label">Base surface (or press B + click a face)</span>
              <select
                value={resolveBaseFace(sel)}
                onChange={(e) => pickBaseFace(sel, e.target.value as BayBaseFace)}
              >
                {BASE_FACES.map((f) => (
                  <option key={f} value={f}>
                    {BASE_FACE_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field" title="Which way cargo anchors/fills on the surface — e.g. a rack that hangs from the ceiling down.">
              <span className="hud-label">Fill direction</span>
              <select
                value={sel.fill ?? 'default'}
                onChange={(e) => patchBay(sel.id, { fill: e.target.value as BayFill })}
              >
                {fillOptions(sel).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field" title="Largest container (SCU) that fits through this bay's door. 0 = no limit.">
              <span className="hud-label">Door max SCU (0 = none)</span>
              <Num
                value={sel.maxContainerScu ?? 0}
                min={0}
                onChange={(v) => patchBay(sel.id, { maxContainerScu: v || undefined })}
              />
            </label>

            <span className="hud-label">Position (SCU)</span>
            <div className="bd-row3">
              <Num value={round2(selEntry?.pos[0] ?? 0)} step={1} onChange={(v) => setPlacement(sel, { x: v })} />
              <Num value={round2(selEntry?.pos[1] ?? 0)} step={1} onChange={(v) => setPlacement(sel, { y: v })} />
              <Num value={round2(selEntry?.pos[2] ?? 0)} step={1} onChange={(v) => setPlacement(sel, { z: v })} />
            </div>

            <span className="hud-label">Rotation (°, 5° steps)</span>
            <div className="bd-row3">
              <Num value={Math.round((selEntry?.rot[0] ?? 0) / DEG)} step={5} onChange={(v) => setPlacement(sel, { rx: v })} />
              <Num value={Math.round((selEntry?.rot[1] ?? 0) / DEG)} step={5} onChange={(v) => setPlacement(sel, { ry: v })} />
              <Num value={Math.round((selEntry?.rot[2] ?? 0) / DEG)} step={5} onChange={(v) => setPlacement(sel, { rz: v })} />
            </div>

            {sel.placement && (
              <button className="btn btn--sm" onClick={() => patchBay(sel.id, { placement: undefined })}>
                ↺ Auto position
              </button>
            )}

            <div className="bd-scu hud-label">
              This bay: <strong>{bayScu(sel)} SCU</strong>
            </div>
          </div>
        ) : (
          <p className="muted sm">Select a bay in the scene or the list above.</p>
        )}

        <div className="bd-actions">
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={!dirty}>
            Save to ship
          </button>
        </div>
      </aside>
    </div>
  )
}

function Num({
  value,
  onChange,
  min,
  step = 1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (Number.isNaN(v)) return
        onChange(min !== undefined ? Math.max(min, v) : v)
      }}
    />
  )
}

/**
 * One bay in the Designer scene: a hologram volume + the "spindle plate" base — a dark
 * metallic slab whose top face carries 1-SCU square imprints (Hull-C style), drawn into
 * a canvas texture. Blocked cells show as red-scored squares.
 */
function DesignerBay({
  bay,
  pos,
  rot,
  accent,
  selected,
  baseMode,
  onSelect,
  onPickFace,
  onToggleCell,
}: {
  bay: CargoBay
  pos: [number, number, number]
  rot: [number, number, number]
  accent: string
  selected: boolean
  /** Base-pick armed for THIS bay: the next face click sets the mounting surface. */
  baseMode: boolean
  onSelect: () => void
  onPickFace: (face: BayBaseFace) => void
  onToggleCell: (x: number, z: number) => void
}) {
  const W = bay.width
  const L = bay.length
  const H = bay.maxStackHeight

  return (
    <group position={pos} rotation={rot}>
      {/* selectable hologram volume; in base-pick mode the clicked FACE becomes the base */}
      <mesh
        position={[0, H / 2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          if (baseMode && e.face) {
            const q = new THREE.Quaternion()
            e.object.getWorldQuaternion(q)
            onPickFace(pickFaceFromNormal(e.face.normal.clone().applyQuaternion(q).normalize()))
            return
          }
          onSelect()
        }}
      >
        <boxGeometry args={[W, H, L]} />
        <meshBasicMaterial
          transparent
          opacity={baseMode ? 0.14 : selected ? 0.09 : 0.03}
          color={baseMode ? '#4ce0a0' : selected ? '#ffd166' : accent}
        />
        <Edges color={baseMode ? '#4ce0a0' : selected ? '#ffd166' : accent} />
      </mesh>

      {/* base plate slab (top surface flush with the bay's local floor, y=0) — holographic,
          translucent like everything else in the app, never opaque */}
      <mesh position={[0, -0.11, 0]}>
        <boxGeometry args={[W + 0.5, 0.2, L + 0.5]} />
        <meshStandardMaterial
          color="#123450"
          transparent
          opacity={0.32}
          metalness={0.6}
          roughness={0.4}
          emissive="#0e2438"
          emissiveIntensity={0.5}
          depthWrite={false}
        />
        <Edges color={selected ? '#ffd166' : new THREE.Color(accent).lerp(new THREE.Color('#06131f'), 0.25)} />
      </mesh>
      <PlateCells bay={bay} interactive={selected && !baseMode} onToggleCell={onToggleCell} />

      <Html position={[0, H + 0.9, 0]} center className="c3d-bayname" wrapperClass="c3d-wrap">
        {bay.name}
      </Html>
    </group>
  )
}

/** The 1-SCU square imprints on the plate's top face (canvas texture, memoized per grid).
 *  While its bay is selected, clicking a square toggles that cell blocked/usable. */
function PlateCells({
  bay,
  interactive,
  onToggleCell,
}: {
  bay: CargoBay
  interactive: boolean
  onToggleCell: (x: number, z: number) => void
}) {
  const tex = useMemo(() => {
    const px = Math.max(16, Math.min(72, Math.floor(1600 / Math.max(bay.width, bay.length))))
    const cvs = document.createElement('canvas')
    cvs.width = bay.width * px
    cvs.height = bay.length * px
    const g = cvs.getContext('2d')!
    // Transparent background — the squares are glowing outlines, not an opaque slab.
    g.clearRect(0, 0, cvs.width, cvs.height)
    const blocked = new Set(bay.blockedCells)
    const inset = Math.max(2, px * 0.07)
    for (let z = 0; z < bay.length; z++) {
      for (let x = 0; x < bay.width; x++) {
        const bad = blocked.has(`${x},${z}`)
        const X = x * px + inset
        const Z = z * px + inset
        const S = px - inset * 2
        g.fillStyle = bad ? 'rgba(255, 93, 108, 0.10)' : 'rgba(96, 200, 245, 0.07)'
        g.fillRect(X, Z, S, S)
        g.strokeStyle = bad ? 'rgba(255, 93, 108, 0.55)' : 'rgba(96, 168, 208, 0.55)'
        g.lineWidth = Math.max(1.5, px * 0.035)
        g.strokeRect(X, Z, S, S)
        // small corner ticks for the machined-plate feel
        g.strokeStyle = bad ? 'rgba(255, 120, 135, 0.85)' : 'rgba(127, 227, 255, 0.8)'
        const t = px * 0.16
        g.beginPath()
        g.moveTo(X, Z + t)
        g.lineTo(X, Z)
        g.lineTo(X + t, Z)
        g.moveTo(X + S - t, Z + S)
        g.lineTo(X + S, Z + S)
        g.lineTo(X + S, Z + S - t)
        g.stroke()
        if (bad) {
          g.beginPath()
          g.moveTo(X + t, Z + t)
          g.lineTo(X + S - t, Z + S - t)
          g.moveTo(X + S - t, Z + t)
          g.lineTo(X + t, Z + S - t)
          g.stroke()
        }
      }
    }
    const t = new THREE.CanvasTexture(cvs)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [bay.width, bay.length, bay.blockedCells])

  useEffect(() => () => tex.dispose(), [tex])

  return (
    <mesh
      position={[0, 0.004, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(e) => {
        if (!interactive || !e.uv) return
        e.stopPropagation()
        // Plane UV → cell: u runs along width; v=1 is the z=0 row (texture flipY).
        const x = Math.min(bay.width - 1, Math.max(0, Math.floor(e.uv.x * bay.width)))
        const z = Math.min(bay.length - 1, Math.max(0, Math.floor((1 - e.uv.y) * bay.length)))
        onToggleCell(x, z)
      }}
    >
      <planeGeometry args={[bay.width, bay.length]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
