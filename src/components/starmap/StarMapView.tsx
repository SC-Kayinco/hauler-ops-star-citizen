import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Line, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '@/store/useStore'
import { optimize } from '@/lib/optimizer'
import { effectivePickups } from '@/lib/pickups'
import {
  canonicalLocation,
  LOCATIONS,
  matchLocation,
  PLANET_COLOR,
  PLANET_LABEL,
  type PlanetId,
  type SCLocation,
} from '@/data/locations'

type Vec3 = [number, number, number]
type ViewName = 'persp' | 'front' | 'back' | 'left' | 'right' | 'top'
const CAM_R = 54

/** Friendly planet display names (PlanetId has no human label otherwise). */
const PLANET_NAME: Record<PlanetId, string> = {
  hurston: 'Hurston',
  crusader: 'Crusader',
  arccorp: 'ArcCorp',
  microtech: 'microTech',
  'pyro-i': 'Pyro I',
  'pyro-ii': 'Pyro II',
  'pyro-iii': 'Pyro III',
  'pyro-iv': 'Pyro IV',
  'pyro-v': 'Pyro V',
  'pyro-vi': 'Pyro VI',
}

type SystemKey = 'stanton' | 'pyro'
const SYSTEMS: Record<SystemKey, { name: string; star: string; planets: PlanetId[] }> = {
  stanton: { name: 'Stanton', star: '#ffd27f', planets: ['hurston', 'crusader', 'arccorp', 'microtech'] },
  pyro: {
    name: 'Pyro',
    star: '#ff7a3c',
    planets: ['pyro-i', 'pyro-ii', 'pyro-iii', 'pyro-iv', 'pyro-v', 'pyro-vi'],
  },
}
const systemOf = (p: PlanetId): SystemKey => (p.startsWith('pyro') ? 'pyro' : 'stanton')

const MIN_R = 16
const MAX_R = 46
const PLANET_R = 1.9
const CLOUD_R = 3.4

interface PlanetNode {
  id: PlanetId
  pos: Vec3
  orbit: number
}
interface LocNode {
  loc: SCLocation
  pos: Vec3
}

/** Lay out a system in 3D: planets on flat orbit rings, each planet's locations as a small
 *  spherical cloud (fibonacci distribution) around it. */
function layoutSystem(key: SystemKey) {
  const planets = SYSTEMS[key].planets
  const N = planets.length
  const byPlanet = new Map<PlanetId, SCLocation[]>()
  for (const p of planets) byPlanet.set(p, [])
  for (const l of LOCATIONS) if (byPlanet.has(l.planet)) byPlanet.get(l.planet)!.push(l)

  const planetNodes: PlanetNode[] = []
  const locNodes: LocNode[] = []
  const posById = new Map<string, Vec3>()
  const GOLDEN = Math.PI * (1 + Math.sqrt(5))

  planets.forEach((id, i) => {
    const orbit = N === 1 ? 28 : MIN_R + ((MAX_R - MIN_R) * i) / (N - 1)
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N
    const px = orbit * Math.cos(angle)
    const pz = orbit * Math.sin(angle)
    planetNodes.push({ id, pos: [px, 0, pz], orbit })

    const locs = byPlanet.get(id) ?? []
    const c = locs.length
    locs.forEach((loc, j) => {
      // Fibonacci sphere around the planet so stations form a tidy cloud.
      const k = j + 0.5
      const phi = Math.acos(1 - (2 * k) / Math.max(1, c))
      const theta = GOLDEN * k
      const lx = px + CLOUD_R * Math.sin(phi) * Math.cos(theta)
      const ly = CLOUD_R * Math.cos(phi) * 0.7
      const lz = pz + CLOUD_R * Math.sin(phi) * Math.sin(theta)
      const pos: Vec3 = [lx, ly, lz]
      locNodes.push({ loc, pos })
      posById.set(loc.id, pos)
    })
  })

  return { planetNodes, locNodes, posById }
}

/** Camera view presets (Blender/Load-Plan style), registered so the toolbar buttons + number
 *  keys can snap the camera. The system is centred at the origin on the XZ plane. */
function CameraRig({ register }: { register: (fn: (v: ViewName) => void) => void }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null

  useEffect(() => {
    const R = CAM_R
    const poses: Record<ViewName, Vec3> = {
      persp: [R * 0.05, R * 0.82, R * 1.15],
      front: [0, R * 0.18, -R * 1.5],
      back: [0, R * 0.18, R * 1.5],
      right: [R * 1.5, R * 0.18, 0],
      left: [-R * 1.5, R * 0.18, 0],
      top: [0.001, R * 1.8, 0.001],
    }
    const apply = (v: ViewName) => {
      const [px, py, pz] = poses[v] ?? poses.persp
      camera.up.set(0, v === 'top' ? 0 : 1, v === 'top' ? -1 : 0)
      camera.position.set(px, py, pz)
      camera.lookAt(0, 0, 0)
      if (controls) {
        controls.target.set(0, 0, 0)
        controls.update()
      }
    }
    register(apply)
    apply('persp')
  }, [camera, controls, register])

  return null
}

/** WASD/QE fly movement layered on top of OrbitControls (soft, velocity-lerped). */
function FlyKeys() {
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
    const speed = CAM_R * 0.9
    const targetVel = dir.lengthSq() > 0 ? dir.normalize().multiplyScalar(speed) : new THREE.Vector3()
    vel.current.lerp(targetVel, Math.min(1, dt * 6))
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

/** Flat orbit ring on the XZ plane. */
function OrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.06, radius + 0.06, 128]} />
      <meshBasicMaterial color="#3a7fa0" transparent opacity={0.35} side={2} />
    </mesh>
  )
}

function Planet({
  node,
  onSelect,
  onHover,
}: {
  node: PlanetNode
  onSelect: () => void
  onHover: (h: boolean) => void
}) {
  const color = PLANET_COLOR[node.id]
  return (
    <group position={node.pos}>
      <mesh
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          onHover(false)
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[PLANET_R, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.55} />
      </mesh>
      <Html position={[0, PLANET_R + 1.1, 0]} center wrapperClass="sm3d-wrap" className="sm3d-planet-label">
        <span className="sm3d-badge-tag" style={{ color }}>
          {PLANET_LABEL[node.id]}
        </span>
        {PLANET_NAME[node.id]}
      </Html>
    </group>
  )
}

function LocationPoint({
  node,
  selected,
  here,
  onSelect,
  onHover,
}: {
  node: LocNode
  selected: boolean
  here: boolean
  onSelect: () => void
  onHover: (name: string | null) => void
}) {
  const color = PLANET_COLOR[node.loc.planet]
  const r = here ? 0.5 : selected ? 0.46 : 0.3
  return (
    <mesh
      position={node.pos}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        onHover(node.loc.name)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        onHover(null)
        document.body.style.cursor = 'auto'
      }}
    >
      <sphereGeometry args={[r, 14, 14]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={here || selected ? 1.1 : 0.7}
        roughness={0.4}
      />
    </mesh>
  )
}

function SystemScene({
  system,
  selected,
  hovered,
  onSelectLoc,
  onSelectPlanet,
  onHoverLoc,
  onToggleStop,
  currentLocation,
  favorites,
  routeOverlay,
}: {
  system: SystemKey
  selected: string | null
  hovered: string | null
  onSelectLoc: (name: string) => void
  onSelectPlanet: (id: PlanetId) => void
  onHoverLoc: (name: string | null) => void
  onToggleStop: (kind: 'start' | 'pickup' | 'dropoff', name: string) => void
  currentLocation: string
  favorites: string[]
  routeOverlay: {
    pts: { pos: Vec3; n: number; kind: 'start' | 'pickup' | 'dropoff'; name: string; done: boolean }[]
  } | null
}) {
  const layout = useMemo(() => layoutSystem(system), [system])
  const star = SYSTEMS[system].star

  return (
    <group>
      {/* central star */}
      <pointLight position={[0, 0, 0]} intensity={900} distance={200} decay={2} color={star} />
      <mesh>
        <sphereGeometry args={[3.4, 32, 32]} />
        <meshBasicMaterial color={star} />
      </mesh>
      <mesh>
        <sphereGeometry args={[6.5, 24, 24]} />
        <meshBasicMaterial color={star} transparent opacity={0.12} />
      </mesh>

      {layout.planetNodes.map((p) => (
        <OrbitRing key={`o-${p.id}`} radius={p.orbit} />
      ))}

      {layout.locNodes.map((n) => (
        <LocationPoint
          key={n.loc.id}
          node={n}
          selected={n.loc.name === selected}
          here={n.loc.name === currentLocation}
          onSelect={() => onSelectLoc(n.loc.name)}
          onHover={onHoverLoc}
        />
      ))}

      {layout.planetNodes.map((p) => (
        <Planet
          key={p.id}
          node={p}
          onSelect={() => onSelectPlanet(p.id)}
          onHover={(h) => onHoverLoc(h ? null : null)}
        />
      ))}

      {/* important location labels */}
      {layout.locNodes
        .filter((n) => {
          const name = n.loc.name
          return (
            name === hovered ||
            name === selected ||
            name === currentLocation ||
            favorites.includes(name)
          )
        })
        .map((n) => (
          <Html
            key={`lbl-${n.loc.id}`}
            position={[n.pos[0], n.pos[1] + 0.8, n.pos[2]]}
            center
            wrapperClass="sm3d-wrap"
            className={`sm3d-loc-label ${n.loc.name === currentLocation ? 'here' : ''}`}
          >
            <span style={{ color: PLANET_COLOR[n.loc.planet] }}>
              {favorites.includes(n.loc.name) ? '★ ' : ''}
              {n.loc.name}
            </span>
          </Html>
        ))}

      {/* route overlay */}
      {routeOverlay && routeOverlay.pts.length > 1 && (
        <Line
          points={routeOverlay.pts.map((p) => p.pos)}
          color="#f0a830"
          lineWidth={2.5}
          dashed
          dashSize={1.4}
          gapSize={0.9}
          transparent
          opacity={0.85}
        />
      )}
      {routeOverlay?.pts.map((p, i) => (
        <Html
          key={`stop-${i}`}
          position={[p.pos[0], p.pos[1] + 0.1, p.pos[2]]}
          center
          wrapperClass="sm3d-wrap"
          className={`sm3d-stop ${p.kind} ${p.done ? 'done' : ''}`}
        >
          {p.kind === 'start' ? (
            '◈'
          ) : (
            <button
              className="sm3d-stop-btn"
              title={
                p.kind === 'pickup'
                  ? `${p.name} — click to mark ${p.done ? 'NOT collected' : 'collected ✓'}`
                  : `${p.name} — click to mark ${p.done ? 'NOT delivered' : 'delivered ✓'}`
              }
              onClick={(e) => {
                e.stopPropagation()
                onToggleStop(p.kind, p.name)
              }}
            >
              {p.done ? '✓' : p.n}
            </button>
          )}
        </Html>
      ))}
    </group>
  )
}

export default function StarMapView() {
  const currentLocation = useStore((s) => s.currentLocation)
  const setCurrentLocation = useStore((s) => s.setCurrentLocation)
  const favoriteLocations = useStore((s) => s.favoriteLocations)
  const toggleFavoriteLocation = useStore((s) => s.toggleFavoriteLocation)
  const routeResult = useStore((s) => s.routeResult)
  // Mission tracking: collect (loaded ✓) on pickups, deliver (dropped) on deliveries — shared
  // with the Load Plan tab via the same store fields, so progress stays in sync across views.
  const ships = useStore((s) => s.ships)
  const selectedShipId = useStore((s) => s.selectedShipId)
  const missions = useStore((s) => s.missions)
  const maxBox = useStore((s) => s.maxBox)
  const groupMode = useStore((s) => s.groupMode)
  const containerSizes = useStore((s) => s.containerSizes)
  const loadedKeys = useStore((s) => s.loadedKeys)
  const setLoadedKey = useStore((s) => s.setLoadedKey)
  const setDropped = useStore((s) => s.setDropped)

  const startPlanet = currentLocation ? matchLocation(currentLocation)?.planet : undefined
  const [system, setSystem] = useState<SystemKey>(startPlanet ? systemOf(startPlanet) : 'stanton')
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  // Camera view presets (registered by CameraRig inside the Canvas).
  const controller = useRef<((v: ViewName) => void) | null>(null)
  const register = useCallback((fn: (v: ViewName) => void) => {
    controller.current = fn
  }, [])
  const PRESETS: { id: ViewName; label: string; key: string }[] = [
    { id: 'persp', label: 'Persp', key: '5' },
    { id: 'front', label: 'Front', key: '1' },
    { id: 'back', label: 'Back', key: '⌃1' },
    { id: 'left', label: 'Left', key: '⌃3' },
    { id: 'right', label: 'Right', key: '3' },
    { id: 'top', label: 'Top', key: '7' },
  ]

  // Number-pad style shortcuts for the view presets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
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

  // Fullscreen for the map canvas.
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

  const layout = useMemo(() => layoutSystem(system), [system])
  const selectedLoc = selected ? LOCATIONS.find((l) => l.name === selected) ?? null : null
  const isFav = selected ? favoriteLocations.includes(selected) : false
  const isHere = selected !== null && selected === currentLocation

  // Locations belonging to the selected planet (when a planet, not a station, is clicked).
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetId | null>(null)
  const planetLocs = selectedPlanet ? LOCATIONS.filter((l) => l.planet === selectedPlanet) : []

  // ----- Mission tracking (shared with the Load Plan tab) -----
  const ship = ships.find((sh) => sh.id === selectedShipId)
  const planMissions = useMemo(
    () => missions.filter((m) => m.scu > 0 && !m.done && !m.dropped),
    [missions],
  )
  // The packing plan tells us which container keys (missionId:boxIdx) belong to each pickup
  // station, so "collected ✓" toggles the very same loadedKeys the Plan tab uses.
  const aboard = useMemo(() => {
    if (!ship) return []
    return optimize(ship, planMissions, maxBox, groupMode, containerSizes).placed.filter(
      (p) => !p.delivered,
    )
  }, [ship, planMissions, maxBox, groupMode, containerSizes])

  // Each mission's cargo is attributed to ONE collection station (its earliest pickup in route
  // order for unresolved multi-pickup) — same rule as the Plan tab, so the two stay consistent.
  const collectStationsByMission = useMemo(() => {
    const order = new Map<string, number>()
    routeResult?.stops.filter((s) => s.kind === 'pickup').forEach((s, i) => order.set(s.destination, i))
    const map = new Map<string, string[]>()
    for (const m of missions) {
      const eff = effectivePickups(m)
      if (eff.length <= 1 || m.pickupChoice) {
        map.set(m.id, eff)
        continue
      }
      const earliest = [...eff]
        .filter((st) => order.has(st))
        .sort((a, b) => order.get(a)! - order.get(b)!)[0]
      map.set(m.id, [earliest ?? eff[0]])
    }
    return map
  }, [missions, routeResult])

  const loadedSet = useMemo(() => new Set(loadedKeys), [loadedKeys])
  const boxesAtStation = (station: string) =>
    aboard.filter((p) => (collectStationsByMission.get(p.missionId) ?? []).includes(station))
  const isCollected = (station: string) => {
    const boxes = boxesAtStation(station)
    return boxes.length > 0 && boxes.every((p) => loadedSet.has(p.key))
  }
  const toggleCollected = (station: string) => {
    const boxes = boxesAtStation(station)
    const value = !(boxes.length > 0 && boxes.every((p) => loadedSet.has(p.key)))
    boxes.forEach((p) => setLoadedKey(p.key, value))
  }

  // Delivery "done" = every active leg to that destination marked dropped (mission-level).
  const legsByDest = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const mi of missions) {
      if (mi.scu <= 0 || mi.done) continue
      const d = canonicalLocation(mi.destination)
      ;(m.get(d) ?? m.set(d, []).get(d)!).push(mi.id)
    }
    return m
  }, [missions])
  const droppedByDest = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const [d, ids] of legsByDest)
      m.set(d, ids.length > 0 && ids.every((id) => missions.find((mi) => mi.id === id)?.dropped))
    return m
  }, [legsByDest, missions])
  const toggleDelivered = (dest: string) => {
    const ids = legsByDest.get(dest) ?? []
    setDropped(ids, !droppedByDest.get(dest))
  }

  const isStopDone = (kind: 'start' | 'pickup' | 'dropoff', name: string) =>
    kind === 'pickup' ? isCollected(name) : kind === 'dropoff' ? !!droppedByDest.get(name) : false
  const onToggleStop = (kind: 'start' | 'pickup' | 'dropoff', name: string) => {
    if (kind === 'pickup') toggleCollected(name)
    else if (kind === 'dropoff') toggleDelivered(name)
  }

  // Route overlay points for THIS system (start + in-system stops, in order).
  const routeOverlay = useMemo(() => {
    if (!routeResult) return null
    const pts: {
      pos: Vec3
      n: number
      kind: 'start' | 'pickup' | 'dropoff'
      name: string
      done: boolean
    }[] = []
    let crossesOther = false
    if (currentLocation) {
      const loc = matchLocation(currentLocation)
      if (loc) {
        const p = layout.posById.get(loc.id)
        if (p && systemOf(loc.planet) === system)
          pts.push({ pos: p, n: 0, kind: 'start', name: currentLocation, done: false })
      }
    }
    routeResult.stops.forEach((s, i) => {
      const loc = matchLocation(s.destination)
      if (!loc) return
      if (systemOf(loc.planet) !== system) {
        crossesOther = true
        return
      }
      const p = layout.posById.get(loc.id)
      if (p)
        pts.push({ pos: p, n: i + 1, kind: s.kind, name: s.destination, done: isStopDone(s.kind, s.destination) })
    })
    return { pts, crossesOther }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeResult, system, layout, currentLocation, aboard, loadedSet, droppedByDest])

  const sys = SYSTEMS[system]
  const selectLoc = (name: string) => {
    setSelected(name)
    setSelectedPlanet(null)
  }

  return (
    <div className="view starmap">
      <div className="view-head">
        <div>
          <h1>STAR MAP</h1>
          <p className="view-sub">
            Stanton & Pyro hauling network in 3D — drag to orbit, scroll to zoom. Click a location to
            set it as your start; your optimized route is overlaid when computed.
          </p>
        </div>
        <div className="toggle-group">
          <span className="hud-label">System</span>
          {(Object.keys(SYSTEMS) as SystemKey[]).map((k) => (
            <button
              key={k}
              className={`toggle ${system === k ? 'on' : ''}`}
              onClick={() => {
                setSystem(k)
                setSelected(null)
                setSelectedPlanet(null)
              }}
            >
              {SYSTEMS[k].name}
            </button>
          ))}
        </div>
      </div>

      <div className="starmap-layout">
        <div className="starmap-canvas panel" ref={wrapRef}>
          <Canvas camera={{ position: [0, 44, 62], fov: 50 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
            <ambientLight intensity={0.5} />
            <Stars radius={140} depth={60} count={1800} factor={3} saturation={0} fade speed={0.4} />
            <SystemScene
              system={system}
              selected={selected}
              hovered={hovered}
              onSelectLoc={selectLoc}
              onSelectPlanet={setSelectedPlanet}
              onHoverLoc={setHovered}
              onToggleStop={onToggleStop}
              currentLocation={currentLocation}
              favorites={favoriteLocations}
              routeOverlay={routeOverlay}
            />
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.1}
              minDistance={10}
              maxDistance={160}
              maxPolarAngle={Math.PI * 0.92}
            />
            <CameraRig register={register} />
            <FlyKeys />
          </Canvas>

          <div className="view-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className="view-btn"
                onClick={() => controller.current?.(p.id)}
                title={`${p.label} (${p.key})`}
              >
                {p.label}
                <span className="view-key">{p.key}</span>
              </button>
            ))}
          </div>
          <div className="cargo3d-topright">
            <button className="fullscreen-btn" onClick={toggleFull} title="Toggle fullscreen">
              {isFull ? '✕' : '⛶'}
            </button>
          </div>
          <span className="holo-hint hud-label">
            Drag to orbit · scroll to zoom · WASD/QE to fly · click a body
          </span>
        </div>

        <aside className="starmap-side">
          <div className="panel side-panel">
            <h3 className="section-label">Location</h3>
            {selectedLoc ? (
              <div className="sm-loc-card">
                <div className="sm-loc-name">
                  <span
                    className="route-planet-badge"
                    style={{ background: PLANET_COLOR[selectedLoc.planet], color: '#000' }}
                  >
                    {PLANET_LABEL[selectedLoc.planet]}
                  </span>
                  {selectedLoc.name}
                </div>
                <div className="sm-loc-sub muted sm">{PLANET_NAME[selectedLoc.planet]}</div>
                <div className="sm-loc-actions">
                  <button
                    className={`btn btn--sm ${isHere ? 'btn--primary' : ''}`}
                    onClick={() => setCurrentLocation(isHere ? '' : selectedLoc.name)}
                  >
                    {isHere ? '✓ Your location' : 'Set as my location'}
                  </button>
                  <button
                    className={`icon-btn loc-fav-btn ${isFav ? 'on' : ''}`}
                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={() => toggleFavoriteLocation(selectedLoc.name)}
                  >
                    {isFav ? '★' : '☆'}
                  </button>
                </div>
              </div>
            ) : selectedPlanet ? (
              <div className="sm-loc-card">
                <div className="sm-loc-name">
                  <span
                    className="route-planet-badge"
                    style={{ background: PLANET_COLOR[selectedPlanet], color: '#000' }}
                  >
                    {PLANET_LABEL[selectedPlanet]}
                  </span>
                  {PLANET_NAME[selectedPlanet]}
                </div>
                <div className="sm-planet-locs">
                  {planetLocs.map((l) => (
                    <button key={l.id} className="sm-planet-loc" onClick={() => selectLoc(l.name)}>
                      {favoriteLocations.includes(l.name) ? '★ ' : ''}
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="muted sm">Click a planet or location in the map to inspect it.</p>
            )}
          </div>

          {routeOverlay && routeResult && (
            <div className="panel side-panel">
              <h3 className="section-label">Route</h3>
              <p className="muted sm">
                {routeResult.stops.length} stop{routeResult.stops.length === 1 ? '' : 's'} · ~
                {routeResult.totalMin} min total
              </p>
              <div className="sm-legend">
                <span className="sm-legend-item">
                  <span className="sm-dot start">◈</span> Start
                </span>
                <span className="sm-legend-item">
                  <span className="sm-dot pickup" /> Pickup
                </span>
                <span className="sm-legend-item">
                  <span className="sm-dot dropoff" /> Delivery
                </span>
              </div>
              <p className="muted sm sm-track-tip">
                Click a stop marker on the map to mark it collected ✓ / delivered ✓ (syncs with Load
                Plan).
              </p>
              {routeOverlay.crossesOther && (
                <p className="muted sm sm-cross">
                  ↔ Route also visits {system === 'stanton' ? 'Pyro' : 'Stanton'} — switch systems to
                  see those stops.
                </p>
              )}
            </div>
          )}

          <div className="panel side-panel">
            <h3 className="section-label">Planets</h3>
            <div className="sm-planet-legend">
              {sys.planets.map((p) => (
                <button
                  key={p}
                  className="sm-planet-chip"
                  onClick={() => {
                    setSelectedPlanet(p)
                    setSelected(null)
                  }}
                >
                  <span className="sm-dot" style={{ background: PLANET_COLOR[p] }} />
                  {PLANET_NAME[p]}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
