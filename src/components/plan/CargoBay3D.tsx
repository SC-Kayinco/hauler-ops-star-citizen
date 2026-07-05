import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Edges, Html, Grid, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import type { CargoBay, PlacedContainer } from '@/types'
import { bayFlips, flipX, flipZ, isFloorBay, resolveBaseFace } from '@/lib/bayFace'

type ViewName = 'persp' | 'front' | 'back' | 'left' | 'right' | 'top'
type Vec3 = [number, number, number]

interface Props {
  bays: CargoBay[]
  placed: PlacedContainer[]
  /** Destinations currently selected for delivery — their containers blink, others dim. */
  highlight: string[]
  /** Specific container ids to highlight (e.g. boxes collected at a selected pickup stop). */
  highlightIds?: Set<string>
  destColors: Record<string, string>
  accent?: string
  /** Commit a manual move of a container (edit mode) — into a bay cell or parked on the floor. */
  onMove?: (
    key: string,
    pos: { bayId: string; x: number; y: number; z: number } | { floored: true; fx: number; fz: number },
  ) => void
  /** Clear all manual placements for this ship (back to auto). Undefined = nothing to reset. */
  onResetLayout?: () => void
  /** "Loaded" checklist (container ids) — owned by the parent and shared with the 2D bay maps,
   *  so checking a box in 3D or 2D stays in sync across both views. */
  loaded: Set<string>
  onToggleLoad: (id: string) => void
}

function lighten(hex: string, amt = 0.5) {
  return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amt)
}

interface BayPlacement {
  bay: CargoBay
  pos: Vec3
  /**
   * Euler XYZ rotation (radians). Orients the bay so its HEIGHT axis points OUT of its base
   * face: a floor hold stacks up (rot 0); a wing/wall rack tips 90° so cargo builds sideways
   * out of the hull instead of floating upward. The box-local frame (x=width, y=height/out,
   * z=length) is unchanged — only the whole bay is rotated.
   */
  rot: Vec3
}

const HALF_PI = Math.PI / 2

/**
 * Arrange bays in a ship-like layout. Floor holds sit centre and stack up; face-mounted racks
 * (e.g. the Argo MOTH wings) flank the hull and build OUTWARD from their base surface — their
 * height axis points away from the ship, so a rack's WIDTH becomes its on-screen vertical size
 * and its HEIGHT (depth) runs outward.
 */
function layoutBays(bays: CargoBay[]): { placed: BayPlacement[]; bx: number; bz: number; by: number } {
  const GAP = 2.5
  const racks = bays.filter((b) => !isFloorBay(b))
  const floors = bays.filter((b) => isFloorBay(b))
  const by = Math.max(1, ...floors.map((b) => b.maxStackHeight), ...racks.map((b) => b.width))

  if (racks.length === 0) {
    let cursor = 0
    const placed = bays.map((b) => {
      const x = cursor + b.width / 2
      cursor += b.width + GAP
      return { bay: b, pos: [x, 0, 0] as Vec3, rot: [0, 0, 0] as Vec3 }
    })
    const totalW = Math.max(cursor - GAP, 1)
    placed.forEach((p) => (p.pos[0] -= totalW / 2))
    return { placed, bx: totalW, bz: Math.max(1, ...bays.map((b) => b.length)), by }
  }

  const placed: BayPlacement[] = []
  const floorTotalZ = floors.reduce((s, b) => s + b.length, 0) + Math.max(0, floors.length - 1) * GAP
  let fz = 0
  floors.forEach((b) => {
    const zc = fz + b.length / 2 - floorTotalZ / 2
    fz += b.length + GAP
    placed.push({ bay: b, pos: [0, 0, zc], rot: [0, 0, 0] })
  })
  const floorW = Math.max(4, ...floors.map((b) => b.width))
  const halfZ = Math.max(floorTotalZ, 1) / 2
  // Stagger multiple racks sharing a face so they don't overlap.
  const cursorByFace: Record<string, number> = {}
  racks.forEach((b, i) => {
    const face0 = resolveBaseFace(b)
    const face = face0 === 'bottom' ? (i % 2 === 0 ? 'left' : 'right') : face0
    const stack = cursorByFace[face] ?? 0
    cursorByFace[face] = stack + b.length + GAP
    const along = stack + b.length / 2 - halfZ
    if (face === 'left' || face === 'right') {
      const dir = face === 'left' ? -1 : 1
      // Base sits just outside the floor hold; cargo builds outward (±X). Width → vertical.
      placed.push({
        bay: b,
        pos: [dir * (floorW / 2 + GAP), b.width / 2, along],
        rot: [0, 0, dir === -1 ? HALF_PI : -HALF_PI],
      })
    } else if (face === 'top') {
      placed.push({ bay: b, pos: [along, by + GAP + b.maxStackHeight, 0], rot: [Math.PI, 0, 0] })
    } else {
      // front / back: base on the fore/aft face, cargo builds along ±Z.
      const dir = face === 'back' ? -1 : 1
      placed.push({ bay: b, pos: [0, b.width / 2, dir * (halfZ + GAP)], rot: [dir === -1 ? HALF_PI : -HALF_PI, 0, 0] })
    }
  })
  const maxDepth = Math.max(0, ...racks.map((b) => b.maxStackHeight))
  const bx = floorW + 2 * (GAP + maxDepth)
  const bz = Math.max(floorTotalZ, ...racks.map((b) => b.length), 1)
  return { placed, bx, bz, by }
}

// ---- Manual-edit geometry helpers (cell snapping) ----

type Occ = Record<string, boolean[][][]> // bayId -> [y][z][x]

/** Occupancy grid per bay from the current placement, excluding one container (the one being moved). */
function buildOcc(bays: CargoBay[], placed: PlacedContainer[], excludeKey: string): Occ {
  const occ: Occ = {}
  for (const b of bays) {
    const layers: boolean[][][] = []
    for (let y = 0; y < b.maxStackHeight; y++) {
      const layer: boolean[][] = []
      for (let z = 0; z < b.length; z++) layer.push(new Array(b.width).fill(false))
      layers.push(layer)
    }
    for (const key of b.blockedCells) {
      const [bx, bz] = key.split(',').map(Number)
      for (let y = 0; y < b.maxStackHeight; y++) if (layers[y]?.[bz]?.[bx] !== undefined) layers[y][bz][bx] = true
    }
    occ[b.id] = layers
  }
  for (const c of placed) {
    if (c.delivered || c.floored || c.key === excludeKey) continue
    const layers = occ[c.bayId]
    if (!layers) continue
    const { w, l, h } = c.footprint
    for (let y = c.y; y < c.y + h; y++)
      for (let z = c.z; z < c.z + l; z++)
        for (let x = c.x; x < c.x + w; x++) if (layers[y]?.[z]?.[x] !== undefined) layers[y][z][x] = true
  }
  return occ
}

function regionFree(layers: boolean[][][], bay: CargoBay, x: number, z: number, y: number, w: number, l: number, h: number) {
  if (x < 0 || z < 0 || y < 0 || x + w > bay.width || z + l > bay.length || y + h > bay.maxStackHeight) return false
  for (let yy = y; yy < y + h; yy++)
    for (let zz = z; zz < z + l; zz++) for (let xx = x; xx < x + w; xx++) if (layers[yy][zz][xx]) return false
  return true
}
function supported(layers: boolean[][][], x: number, z: number, y: number, w: number, l: number) {
  if (y === 0) return true
  for (let zz = z; zz < z + l; zz++) for (let xx = x; xx < x + w; xx++) if (!layers[y - 1][zz][xx]) return false
  return true
}
/** Lowest valid layer for a footprint at (x,z), gravity-style. -1 if it won't fit. */
function lowestY(layers: boolean[][][], bay: CargoBay, x: number, z: number, w: number, l: number, h: number) {
  for (let y = 0; y <= bay.maxStackHeight - h; y++) {
    if (regionFree(layers, bay, x, z, y, w, l, h) && supported(layers, x, z, y, w, l)) return y
  }
  return -1
}

/** Local box-center within a bay's centred frame (respects the bay's fill-mirror). */
function localCenter(c: PlacedContainer, bay: CargoBay): { lx: number; ly: number; lz: number } {
  const { fw, fl } = bayFlips(bay)
  const { w, l, h } = c.footprint
  return {
    lx: (fw ? bay.width - c.x - w : c.x) + w / 2 - bay.width / 2,
    ly: c.y + h / 2,
    lz: (fl ? bay.length - c.z - l : c.z) + l / 2 - bay.length / 2,
  }
}

/** World position of a container's centre, given its bay's layout placement. */
function worldCenter(c: PlacedContainer, layout: BayPlacement[]): Vec3 | null {
  const entry = layout.find((L) => L.bay.id === c.bayId)
  if (!entry) return null
  const { lx, ly, lz } = localCenter(c, entry.bay)
  const v = new THREE.Vector3(lx, ly, lz).applyEuler(
    new THREE.Euler(entry.rot[0], entry.rot[1], entry.rot[2]),
  )
  return [entry.pos[0] + v.x, entry.pos[1] + v.y, entry.pos[2] + v.z]
}

/** Snap a dropped world point to a valid cell in whichever bay it's over (with gravity). */
function snapToCell(
  wx: number,
  wz: number,
  layout: BayPlacement[],
  footprint: { w: number; l: number; h: number },
  occ: Occ,
): { bayId: string; x: number; y: number; z: number } | null {
  const { w, l, h } = footprint
  for (const { bay, pos, rot } of layout) {
    // Drag-drop snapping only targets floor holds (tipped wall racks aren't a flat top-down
    // surface to drop onto); a drop over a rack falls through to floor-parking instead.
    if (Math.abs(rot[0]) > 1e-3 || Math.abs(rot[1]) > 1e-3 || Math.abs(rot[2]) > 1e-3) continue
    const lx = wx - pos[0]
    const lz = wz - pos[2]
    // Is the point over this bay's footprint (with a small margin)?
    if (Math.abs(lx) > bay.width / 2 + 1 || Math.abs(lz) > bay.length / 2 + 1) continue
    // World→display cell, then un-mirror to the stored cell if this bay's fill is flipped.
    let x0 = flipX(bay, Math.round(lx + bay.width / 2 - w / 2), w)
    let z0 = flipZ(bay, Math.round(lz + bay.length / 2 - l / 2), l)
    x0 = Math.max(0, Math.min(bay.width - w, x0))
    z0 = Math.max(0, Math.min(bay.length - l, z0))
    const y = lowestY(occ[bay.id], bay, x0, z0, w, l, h)
    if (y < 0) return null // over this bay but no room
    return { bayId: bay.id, x: x0, y, z: z0 }
  }
  return null
}

/** The topmost non-delivered box under a top-down world point in a floor bay (for swapping),
 *  excluding the dragged box. Accounts for the bay's fill-mirror. */
function boxAt(
  wx: number,
  wz: number,
  layout: BayPlacement[],
  placed: PlacedContainer[],
  excludeKey: string,
): PlacedContainer | null {
  for (const { bay, pos, rot } of layout) {
    if (Math.abs(rot[0]) > 1e-3 || Math.abs(rot[1]) > 1e-3 || Math.abs(rot[2]) > 1e-3) continue
    const lx = wx - pos[0] + bay.width / 2
    const lz = wz - pos[2] + bay.length / 2
    if (lx < 0 || lz < 0 || lx > bay.width || lz > bay.length) continue
    // Display cell → stored cell (un-mirror).
    const cx = flipX(bay, Math.floor(lx))
    const cz = flipZ(bay, Math.floor(lz))
    let best: PlacedContainer | null = null
    for (const p of placed) {
      if (p.delivered || p.floored || p.bayId !== bay.id || p.key === excludeKey) continue
      const { w, l } = p.footprint
      if (cx >= p.x && cx < p.x + w && cz >= p.z && cz < p.z + l && (!best || p.y > best.y)) best = p
    }
    if (best) return best
  }
  return null
}

// World-space top-down rectangle (centre + half-extents on X/Z).
interface AABB {
  cx: number
  cz: number
  hw: number
  hl: number
}

/** Obstacles a parked box must avoid: every bay's world footprint + the other parked boxes. */
function floorObstacles(layout: BayPlacement[], parked: PlacedContainer[]): AABB[] {
  const list: AABB[] = []
  for (const { bay, pos, rot } of layout) {
    const e = new THREE.Euler(rot[0], rot[1], rot[2])
    // Top-down footprint of the rotated W×H×L volume + its rotated centre.
    const c = new THREE.Vector3(0, bay.maxStackHeight / 2, 0).applyEuler(e)
    const ax = new THREE.Vector3(bay.width / 2, 0, 0).applyEuler(e)
    const ay = new THREE.Vector3(0, bay.maxStackHeight / 2, 0).applyEuler(e)
    const az = new THREE.Vector3(0, 0, bay.length / 2).applyEuler(e)
    list.push({
      cx: pos[0] + c.x,
      cz: pos[2] + c.z,
      hw: Math.abs(ax.x) + Math.abs(ay.x) + Math.abs(az.x),
      hl: Math.abs(ax.z) + Math.abs(ay.z) + Math.abs(az.z),
    })
  }
  for (const p of parked) list.push({ cx: p.fx ?? 0, cz: p.fz ?? 0, hw: p.footprint.w / 2, hl: p.footprint.l / 2 })
  return list
}

/** Nearest integer ground spot where the footprint won't overlap any bay or parked box.
 *  Spirals outward from the dropped point; flush edges are allowed. */
function findFreeFloorSpot(
  fx: number,
  fz: number,
  fp: { w: number; l: number },
  obstacles: AABB[],
): { fx: number; fz: number } {
  const overlaps = (cx: number, cz: number) =>
    obstacles.some(
      (o) => Math.abs(cx - o.cx) < fp.w / 2 + o.hw - 1e-6 && Math.abs(cz - o.cz) < fp.l / 2 + o.hl - 1e-6,
    )
  if (!overlaps(fx, fz)) return { fx, fz }
  for (let r = 1; r <= 60; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue // current ring only
        if (!overlaps(fx + dx, fz + dz)) return { fx: fx + dx, fz: fz + dz }
      }
    }
  }
  return { fx, fz }
}

export default function CargoBay3D({
  bays,
  placed,
  highlight,
  highlightIds,
  destColors,
  accent = '#5cc8f5',
  onMove,
  onResetLayout,
  loaded,
  onToggleLoad,
}: Props) {
  const controller = useRef<((v: ViewName) => void) | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showHull, setShowHull] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // The "loaded" checklist is owned by the parent (PlanForShip) so the 2D bay maps share it.
  const register = useCallback((fn: (v: ViewName) => void) => {
    controller.current = fn
  }, [])
  const setView = useCallback((v: ViewName) => controller.current?.(v), [])

  const { placed: layout, bx, bz, by } = layoutBays(bays)
  const radius = Math.max(bx, bz, by * 2) * 0.6 + 6
  const anySelected = highlight.length > 0 || (highlightIds?.size ?? 0) > 0
  /** A box is "hot" if its delivery stop is selected OR it's individually flagged (pickup mode). */
  const isHot = (p: PlacedContainer) =>
    highlight.includes(p.destination) || highlightIds?.has(p.id) === true

  // Leaving edit mode clears any selection.
  useEffect(() => {
    if (!editMode) {
      setSelectedKey(null)
      setDropTarget(null)
    }
  }, [editMode])

  const selectedContainer = useMemo(
    () => (editMode && selectedKey ? placed.find((p) => p.key === selectedKey && !p.delivered) ?? null : null),
    [editMode, selectedKey, placed],
  )
  // The gizmo attaches directly to this mesh (set via callback ref) so its pivot sits at
  // the box centre and dragging moves the actual box (not an empty wrapper at the origin).
  const [proxy, setProxy] = useState<THREE.Mesh | null>(null)
  const selWorld: Vec3 | null = selectedContainer
    ? selectedContainer.floored
      ? [selectedContainer.fx ?? 0, selectedContainer.footprint.h / 2, selectedContainer.fz ?? 0]
      : worldCenter(selectedContainer, layout)
    : null

  // Live "where would it land" target while dragging: a valid bay cell, or a floor-park spot.
  type DropT =
    | { kind: 'bay'; bayId: string; x: number; y: number; z: number }
    | { kind: 'swap'; bayId: string; x: number; y: number; z: number; otherKey: string }
    | { kind: 'floor'; fx: number; fz: number }
  const [dropTarget, setDropTarget] = useState<DropT | null>(null)
  const lastTargetRef = useRef('')

  const computeTarget = useCallback((): DropT | null => {
    if (!proxy || !selectedContainer) return null
    const wp = new THREE.Vector3()
    proxy.getWorldPosition(wp)
    const fp = selectedContainer.footprint
    // Dropping ON another box of the same footprint → SWAP their positions (lets you put a box
    // in another's place, not just into empty cells).
    const other = boxAt(wp.x, wp.z, layout, placed, selectedContainer.key)
    if (
      other &&
      other.footprint.w === fp.w &&
      other.footprint.l === fp.l &&
      other.footprint.h === fp.h
    ) {
      return { kind: 'swap', bayId: other.bayId, x: other.x, y: other.y, z: other.z, otherKey: other.key }
    }
    const occ = buildOcc(bays, placed, selectedContainer.key)
    const bayT = snapToCell(wp.x, wp.z, layout, selectedContainer.footprint, occ)
    if (bayT) return { kind: 'bay', ...bayT }
    // Off any bay → park on the floor at the nearest spot clear of every bay AND parked box.
    const parked = placed.filter((p) => p.floored && !p.delivered && p.key !== selectedContainer.key)
    const obstacles = floorObstacles(layout, parked)
    const spot = findFreeFloorSpot(Math.round(wp.x), Math.round(wp.z), selectedContainer.footprint, obstacles)
    return { kind: 'floor', fx: spot.fx, fz: spot.fz }
  }, [proxy, selectedContainer, bays, placed, layout])

  const onGizmoChange = useCallback(() => {
    const t = computeTarget()
    const k = t
      ? t.kind === 'floor'
        ? `f:${t.fx}:${t.fz}`
        : `${t.kind}:${t.bayId}:${t.x}:${t.y}:${t.z}`
      : ''
    if (k !== lastTargetRef.current) {
      lastTargetRef.current = k
      setDropTarget(t)
    }
  }, [computeTarget])

  const commitMove = useCallback(() => {
    const sel = selectedContainer
    const t = computeTarget()
    if (sel && onMove && t) {
      if (t.kind === 'floor') {
        onMove(sel.key, { floored: true, fx: t.fx, fz: t.fz })
      } else if (t.kind === 'swap') {
        // Swap: dragged box takes the other's cell; the other takes the dragged box's old spot.
        const back =
          sel.floored
            ? { floored: true as const, fx: sel.fx ?? 0, fz: sel.fz ?? 0 }
            : { bayId: sel.bayId, x: sel.x, y: sel.y, z: sel.z }
        onMove(sel.key, { bayId: t.bayId, x: t.x, y: t.y, z: t.z })
        onMove(t.otherKey, back)
      } else {
        onMove(sel.key, { bayId: t.bayId, x: t.x, y: t.y, z: t.z })
      }
    }
    setSelectedKey(null) // re-render restores the box (at new cell if committed, else original)
    setDropTarget(null)
    lastTargetRef.current = ''
  }, [selectedContainer, onMove, computeTarget])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === 'Escape') {
        setSelectedKey(null)
        return
      }
      const k = e.code.replace('Numpad', '').replace('Digit', '')
      let v: ViewName | null = null
      if (k === '1') v = e.ctrlKey ? 'back' : 'front'
      else if (k === '3') v = e.ctrlKey ? 'left' : 'right'
      else if (k === '7') v = 'top'
      else if (k === '5' || k === '0') v = 'persp'
      if (v) {
        e.preventDefault()
        controller.current?.(v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [isFull, setIsFull] = useState(false)
  useEffect(() => {
    const onFs = () => setIsFull(document.fullscreenElement === wrapRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else wrapRef.current?.requestFullscreen()
  }

  const PRESETS: { id: ViewName; label: string; key: string }[] = [
    { id: 'persp', label: 'Persp', key: '5' },
    { id: 'front', label: 'Front', key: '1' },
    { id: 'back', label: 'Back', key: '⌃1' },
    { id: 'left', label: 'Left', key: '⌃3' },
    { id: 'right', label: 'Right', key: '3' },
    { id: 'top', label: 'Top', key: '7' },
  ]

  return (
    <div className="cargo3d" ref={wrapRef}>
      <Canvas
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        onPointerMissed={() => editMode && setSelectedKey(null)}
      >
        <fog attach="fog" args={['#06131f', radius * 1.8, radius * 4.5]} />
        <ambientLight intensity={0.65} />
        <hemisphereLight args={['#9fd8ff', '#0a2236', 0.5]} />
        <pointLight position={[radius, radius * 1.4, radius]} intensity={radius * radius * 1.1} color={accent} />
        <pointLight position={[-radius, radius * 0.6, -radius]} intensity={radius * radius * 0.4} color="#2a6a90" />

        {showHull && <ShipHull bx={bx} bz={bz} by={by} accent={accent} />}

        {/* Containers parked on the cargo-area floor (manually moved out of the bays) */}
        {placed
          .filter((p) => p.floored && !p.delivered && !(editMode && p.key === selectedKey))
          .map((p) => (
            <FlooredBox
              key={p.id}
              c={p}
              color={destColors[p.destination] ?? accent}
              dim={anySelected && !isHot(p)}
              editMode={editMode}
              onSelect={() => setSelectedKey(p.key)}
            />
          ))}

        {layout.map(({ bay, pos, rot }) => (
          <BayVolume
            key={bay.id}
            bay={bay}
            pos={pos}
            rot={rot}
            containers={placed.filter((p) => p.bayId === bay.id && !p.floored)}
            isHot={isHot}
            anySelected={anySelected}
            destColors={destColors}
            accent={accent}
            hovered={hovered}
            setHovered={setHovered}
            loaded={loaded}
            onToggleLoad={onToggleLoad}
            editMode={editMode}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        ))}

        {/* Move gizmo for the selected container (edit mode). The ghost box is rendered
            standalone at the box's world centre; the gizmo attaches to it via `object`. */}
        {selectedContainer && selWorld && (
          <mesh ref={setProxy} position={selWorld} renderOrder={1000}>
            <boxGeometry
              args={[
                selectedContainer.footprint.w - 0.07,
                selectedContainer.footprint.h - 0.07,
                selectedContainer.footprint.l - 0.07,
              ]}
            />
            <meshStandardMaterial
              color={destColors[selectedContainer.destination] ?? accent}
              emissive={destColors[selectedContainer.destination] ?? accent}
              emissiveIntensity={0.7}
              transparent
              opacity={0.8}
              depthTest={false}
            />
            <Edges color="#ffffff" />
          </mesh>
        )}
        {selectedContainer && proxy && (
          <TransformControls
            object={proxy}
            mode="translate"
            onObjectChange={onGizmoChange}
            onMouseUp={commitMove}
            size={0.9}
          />
        )}

        {/* Green highlight: a bay cell, or a floor-park pad — wherever the box would land */}
        {dropTarget &&
          selectedContainer &&
          (() => {
            const fp = selectedContainer.footprint
            if (dropTarget.kind === 'floor') {
              return (
                <mesh position={[dropTarget.fx, fp.h / 2, dropTarget.fz]}>
                  <boxGeometry args={[fp.w, fp.h, fp.l]} />
                  <meshBasicMaterial color="#4ce0a0" transparent opacity={0.35} depthWrite={false} />
                  <Edges color="#4ce0a0" />
                </mesh>
              )
            }
            const e = layout.find((L) => L.bay.id === dropTarget.bayId)
            if (!e) return null
            const lx = flipX(e.bay, dropTarget.x, fp.w) + fp.w / 2 - e.bay.width / 2
            const ly = dropTarget.y + fp.h / 2
            const lz = flipZ(e.bay, dropTarget.z, fp.l) + fp.l / 2 - e.bay.length / 2
            return (
              <group position={e.pos} rotation={e.rot}>
                <mesh position={[lx, ly, lz]}>
                  <boxGeometry args={[fp.w, fp.h, fp.l]} />
                  <meshBasicMaterial color="#4ce0a0" transparent opacity={0.35} depthWrite={false} />
                  <Edges color="#4ce0a0" />
                </mesh>
              </group>
            )
          })()}

        <Grid
          position={[0, -0.02, 0]}
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

        <OrbitControls
          makeDefault
          enablePan
          enableDamping
          dampingFactor={0.1}
          minDistance={2}
          maxDistance={radius * 5}
          // While a box is selected, the mouse drives the gizmo — don't let it orbit the camera.
          enableRotate={!selectedKey}
        />
        <CameraRig register={register} centerY={by / 2} radius={radius} />
        <FlyKeys radius={radius} />
      </Canvas>

      <span className="holo-corner tl" />
      <span className="holo-corner tr" />
      <span className="holo-corner bl" />
      <span className="holo-corner br" />

      <div className="cargo3d-topright">
        <button
          className={`view-btn ${editMode ? 'on' : ''}`}
          onClick={() => setEditMode((e) => !e)}
          title="Edit layout — click a box, drag the XYZ gizmo to move it"
        >
          {editMode ? 'Editing' : 'Edit'}
        </button>
        {editMode && onResetLayout && (
          <button className="view-btn reset" onClick={onResetLayout} title="Discard manual moves, back to auto">
            Reset
          </button>
        )}
        <button
          className={`view-btn ${showHull ? 'on' : ''}`}
          onClick={() => setShowHull((s) => !s)}
          title="Show/hide ship hull outline"
        >
          Hull
        </button>
        <button className="fullscreen-btn" onClick={toggleFull} title="Toggle fullscreen">
          {isFull ? '✕' : '⛶'}
        </button>
      </div>

      {editMode && (
        <div className="cargo3d-edithint hud-label">
          {selectedContainer
            ? 'Drag the colored arrows · green cell = where it lands · WASD/QE to fly · Esc to cancel'
            : 'Click a container to select it · WASD/QE to fly around'}
        </div>
      )}

      <div className="view-presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="view-btn" onClick={() => setView(p.id)} title={`${p.label} (${p.key})`}>
            {p.label}
            <span className="view-key">{p.key}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function CameraRig({
  register,
  centerY,
  radius,
}: {
  register: (fn: (v: ViewName) => void) => void
  centerY: number
  radius: number
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null

  useEffect(() => {
    const R = radius
    const poses: Record<ViewName, Vec3> = {
      persp: [R * 0.85, R * 0.7, R * 0.95],
      front: [0, R * 0.12, -R * 1.45], // in front of the nose, looking aft
      back: [0, R * 0.12, R * 1.45],
      right: [R * 1.45, R * 0.12, 0],
      left: [-R * 1.45, R * 0.12, 0],
      top: [0.001, R * 1.7, 0.001],
    }
    const apply = (v: ViewName) => {
      const [px, py, pz] = poses[v] ?? poses.persp
      if (v === 'top') camera.up.set(0, 0, -1)
      else camera.up.set(0, 1, 0)
      camera.position.set(px, centerY + py, pz)
      camera.lookAt(0, centerY, 0)
      if (controls) {
        controls.target.set(0, centerY, 0)
        controls.update()
      }
    }
    register(apply)
    apply('persp')
  }, [camera, controls, register, centerY, radius])

  return null
}

/** Unreal-style WASD fly movement layered on top of OrbitControls (soft, velocity-lerped).
 *  W/S = along the view direction, A/D = strafe, E/Q = up/down. Mouse orbit/zoom still works. */
function FlyKeys({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null
  const keys = useRef<Set<string>>(new Set())
  const vel = useRef(new THREE.Vector3())

  useEffect(() => {
    const typing = () => {
      const el = document.activeElement
      return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
    }
    const down = (e: KeyboardEvent) => {
      if (typing()) return
      const k = e.key.toLowerCase()
      if (k.length === 1 && 'wasdqe'.includes(k)) keys.current.add(k)
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useFrame((_, dt) => {
    const k = keys.current
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize()
    const dir = new THREE.Vector3()
    if (k.has('w')) dir.add(fwd)
    if (k.has('s')) dir.sub(fwd)
    if (k.has('d')) dir.add(right)
    if (k.has('a')) dir.sub(right)
    if (k.has('e')) dir.y += 1
    if (k.has('q')) dir.y -= 1
    const speed = radius * 0.9
    const targetVel = dir.lengthSq() > 0 ? dir.normalize().multiplyScalar(speed) : new THREE.Vector3(0, 0, 0)
    vel.current.lerp(targetVel, Math.min(1, dt * 6)) // soft accel/decel
    if (vel.current.lengthSq() > 1e-5) {
      const move = vel.current.clone().multiplyScalar(Math.min(dt, 0.05))
      camera.position.add(move)
      if (controls?.target) {
        controls.target.add(move)
        controls.update()
      }
    }
  })
  return null
}

function FaintBox({ args, position, edge }: { args: Vec3; position: Vec3; edge: THREE.Color }) {
  return (
    <mesh position={position}>
      <boxGeometry args={args} />
      <meshBasicMaterial transparent opacity={0.012} color="#5cc8f5" />
      <Edges color={edge} />
    </mesh>
  )
}

/**
 * A faint bounding hull around the WHOLE bay layout (works for any ship — even a plain
 * box), plus a nose marker at the front, so the hold has spatial context.
 */
function ShipHull({ bx, bz, by, accent }: { bx: number; bz: number; by: number; accent: string }) {
  const edge = new THREE.Color(accent).lerp(new THREE.Color('#0a2236'), 0.45)
  const w = bx + 1.8
  const h = by + 1
  const d = bz + 3
  return (
    <group>
      {/* main body enclosing all bays */}
      <FaintBox args={[w, h, d]} position={[0, h / 2, 0]} edge={edge} />
      {/* nose at the front (-z) */}
      <FaintBox
        args={[Math.max(2, w * 0.45), h * 0.62, 2.4]}
        position={[0, h * 0.32, -(d / 2 + 1.2)]}
        edge={edge}
      />
      <Html position={[0, 0.3, -(d / 2 + 3)]} center className="c3d-nose" wrapperClass="c3d-wrap">
        ▲ NOSE
      </Html>
    </group>
  )
}

function BayVolume({
  bay,
  pos,
  rot,
  containers,
  isHot,
  anySelected,
  destColors,
  accent,
  hovered,
  setHovered,
  loaded,
  onToggleLoad,
  editMode,
  selectedKey,
  onSelect,
}: {
  bay: CargoBay
  pos: Vec3
  rot: Vec3
  containers: PlacedContainer[]
  isHot: (c: PlacedContainer) => boolean
  anySelected: boolean
  destColors: Record<string, string>
  accent: string
  hovered: string | null
  setHovered: (id: string | null) => void
  loaded: Set<string>
  onToggleLoad: (id: string) => void
  editMode: boolean
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const W = bay.width
  const L = bay.length
  const H = bay.maxStackHeight
  const { fw, fl } = bayFlips(bay)

  return (
    <group position={pos} rotation={rot}>
      <mesh position={[0, H / 2, 0]}>
        <boxGeometry args={[W, H, L]} />
        <meshBasicMaterial transparent opacity={0.02} color={accent} />
        <Edges color={accent} />
      </mesh>

      <Html position={[0, H + 0.9, 0]} center className="c3d-bayname" wrapperClass="c3d-wrap">
        {bay.name}
      </Html>
      <Html position={[0, 0.1, L / 2 + 0.7]} center className="c3d-door" wrapperClass="c3d-wrap">
        {isFloorBay(bay) ? '▼ RAMP / DOOR' : '◢ HULL SURFACE'}
      </Html>

      {containers
        .filter((c) => !c.delivered)
        // Hide the box being edited — the gizmo proxy represents it.
        .filter((c) => !(editMode && c.key === selectedKey))
        .map((c) => (
          <ContainerBox
            key={c.id}
            c={c}
            W={W}
            L={L}
            color={destColors[c.destination] ?? accent}
            flipW={fw}
            flipL={fl}
            highlight={isHot(c)}
            dim={anySelected && !isHot(c)}
            hovered={hovered === c.id}
            onHover={(v) => setHovered(v ? c.id : null)}
            checked={loaded.has(c.id)}
            onToggleLoad={() => onToggleLoad(c.id)}
            editMode={editMode}
            onSelect={() => onSelect(c.key)}
          />
        ))}
    </group>
  )
}

/** A container parked on the cargo-area floor (manually moved out of a bay). Selectable in edit mode. */
function FlooredBox({
  c,
  color,
  dim,
  editMode,
  onSelect,
}: {
  c: PlacedContainer
  color: string
  dim: boolean
  editMode: boolean
  onSelect: () => void
}) {
  const { w, l, h } = c.footprint
  const inset = 0.07
  return (
    <group position={[c.fx ?? 0, h / 2, c.fz ?? 0]} visible={!dim}>
      <mesh
        onClick={(e) => {
          if (!editMode) return
          e.stopPropagation()
          onSelect()
        }}
      >
        <boxGeometry args={[w - inset, h - inset, l - inset]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} metalness={0.2} roughness={0.5} />
        <Edges color={lighten(color)} />
      </mesh>
      <Html position={[0, h / 2 + 0.25, 0]} center className="c3d-door" wrapperClass="c3d-wrap">
        PARKED
      </Html>
    </group>
  )
}

function ContainerBox({
  c,
  W,
  L,
  color,
  flipW,
  flipL,
  highlight,
  dim,
  hovered,
  onHover,
  checked,
  onToggleLoad,
  editMode,
  onSelect,
}: {
  c: PlacedContainer
  W: number
  L: number
  color: string
  /** Mirror this box along the bay width / length axis (bay fill direction). */
  flipW: boolean
  flipL: boolean
  highlight: boolean
  dim: boolean
  hovered: boolean
  onHover: (v: boolean) => void
  checked: boolean
  onToggleLoad: () => void
  editMode: boolean
  onSelect: () => void
}) {
  // Steady emphasis only — no pulsing. A selected pickup/stop ISOLATES its boxes (others are
  // hidden via `dim`), so the shown boxes need no attention-grabbing animation; hover lifts
  // them slightly and reveals the label.
  const emissiveIntensity = hovered && !editMode ? 0.95 : highlight ? 0.6 : 0.35

  const { w, l, h } = c.footprint
  const cx = (flipW ? W - c.x - w : c.x) + w / 2 - W / 2
  const cy = c.y + h / 2
  const cz = (flipL ? L - c.z - l : c.z) + l / 2 - L / 2
  const inset = 0.07

  return (
    <group position={[cx, cy, cz]} visible={!dim}>
      <mesh
        onPointerOver={(e) => {
          if (dim) return // hidden (isolated-out) boxes must not hover or label
          e.stopPropagation()
          onHover(true)
        }}
        onPointerOut={() => onHover(false)}
        onClick={(e) => {
          if (!editMode) return
          e.stopPropagation()
          onSelect()
        }}
        onDoubleClick={(e) => {
          if (editMode) return
          e.stopPropagation()
          onToggleLoad()
        }}
      >
        <boxGeometry args={[w - inset, h - inset, l - inset]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissiveIntensity}
          metalness={0.2}
          roughness={0.5}
        />
        <Edges color={checked ? '#4ce0a0' : lighten(color)} />
      </mesh>

      {checked && (
        <Html position={[0, 0, 0]} center wrapperClass="c3d-wrap" zIndexRange={[100, 0]}>
          <span className="c3d-check" title="Loaded — double-click the box to clear">
            ✓
          </span>
        </Html>
      )}

      {/* Labels are HOVER-ONLY now (they used to show on every highlighted box, which buried the
          hold in text when a pickup collected many boxes). Hover a box to read its name + SCU. */}
      {hovered && !editMode && !dim && (
        <Html
          position={[0, h / 2 + 0.06, 0]}
          center
          className="c3d-label hover"
          wrapperClass="c3d-wrap"
          zIndexRange={[100, 0]}
        >
          <span className="c3d-name" title={`${c.commodity} · ${c.scu} SCU → ${c.destination}`}>
            {c.commodity}
          </span>
          <span className="c3d-scu">{c.scu}</span>
        </Html>
      )}
    </group>
  )
}
