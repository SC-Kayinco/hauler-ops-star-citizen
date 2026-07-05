import { Suspense, useEffect, useRef, useState, Component, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Grid, OrbitControls, Edges, Center, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

interface Props {
  modelUrl?: string
  /** Absolute disk path to a .glb chosen via the file picker — read at runtime. */
  modelPath?: string
  accent?: string
  /** Approximate ship size in meters, used to scale the dummy/scene. */
  sizeM?: number
}

/** Catches GLTF load failures and falls back to the procedural dummy. */
class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function hologramMaterial(color: string, opacity = 0.32) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.5,
    transparent: true,
    opacity,
    metalness: 0.1,
    roughness: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

/** Loads a model from a disk path: reads it via the desktop bridge into a data URL,
 *  then renders it. Shows the dummy while reading or if the read fails. */
function GltfShipFromPath({ path, color }: { path: string; color: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const b = typeof window !== 'undefined' ? window.hauler : undefined
    if (b?.readModel) {
      b.readModel(path)
        .then((u) => alive && setUrl(u))
        .catch(() => alive && setUrl(null))
    }
    return () => {
      alive = false
    }
  }, [path])
  if (!url) return <DummyShip color={color} />
  return <GltfShip url={url} color={color} />
}

function GltfShip({ url, color }: { url: string; color: string }) {
  const { scene } = useGLTF(url)
  const cloned = scene.clone(true)
  const mat = hologramMaterial(color, 0.4)
  cloned.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      ;(o as THREE.Mesh).material = mat
    }
  })
  return (
    <Center>
      <primitive object={cloned} />
    </Center>
  )
}

/** A generic procedural hauler built from primitives — looks holographic with edges. */
function DummyShip({ color }: { color: string }) {
  const mat = hologramMaterial(color)
  const edgeColor = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.4)
  const Part = ({
    args,
    position,
    rotation,
  }: {
    args: [number, number, number]
    position: [number, number, number]
    rotation?: [number, number, number]
  }) => (
    <mesh material={mat} position={position} rotation={rotation}>
      <boxGeometry args={args} />
      <Edges threshold={15} color={edgeColor} />
    </mesh>
  )
  return (
    <group rotation={[0, Math.PI * 0.12, 0]}>
      {/* fuselage */}
      <Part args={[1.6, 1.1, 5]} position={[0, 0, 0]} />
      {/* cockpit */}
      <Part args={[1.1, 0.8, 1.4]} position={[0, 0.5, 2.2]} />
      {/* wings */}
      <Part args={[5.2, 0.18, 1.8]} position={[0, -0.1, -0.4]} />
      {/* engine nacelles */}
      <mesh material={mat} position={[1.5, -0.1, -1.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 2.4, 16]} />
        <Edges threshold={15} color={edgeColor} />
      </mesh>
      <mesh material={mat} position={[-1.5, -0.1, -1.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 2.4, 16]} />
        <Edges threshold={15} color={edgeColor} />
      </mesh>
      {/* tail fin */}
      <Part args={[0.15, 1.4, 1.6]} position={[0, 0.7, -2]} />
    </group>
  )
}

function Spin({ on, children }: { on: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (on && ref.current) ref.current.rotation.y += dt * 0.25
  })
  return <group ref={ref}>{children}</group>
}

export default function HologramViewer({ modelUrl, modelPath, accent = '#5cc8f5' }: Props) {
  const [spin, setSpin] = useState(true)
  const controls = useRef<any>(null)

  return (
    <div className="holo-viewer">
      <Canvas
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [6, 3.2, 8], fov: 42 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[8, 10, 8]} intensity={120} color={accent} />
        <pointLight position={[-8, -4, -8]} intensity={40} color="#2a6a90" />

        <Spin on={spin}>
          <Suspense fallback={<DummyShip color={accent} />}>
            {modelPath ? (
              <ModelBoundary fallback={<DummyShip color={accent} />}>
                <GltfShipFromPath path={modelPath} color={accent} />
              </ModelBoundary>
            ) : modelUrl ? (
              <ModelBoundary fallback={<DummyShip color={accent} />}>
                <GltfShip url={modelUrl} color={accent} />
              </ModelBoundary>
            ) : (
              <DummyShip color={accent} />
            )}
          </Suspense>
        </Spin>

        <Grid
          position={[0, -2.2, 0]}
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.6}
          cellColor={accent}
          sectionSize={5}
          sectionThickness={1.1}
          sectionColor={accent}
          fadeDistance={34}
          fadeStrength={1.4}
          infiniteGrid
        />

        <OrbitControls
          ref={controls}
          enablePan={false}
          minDistance={4}
          maxDistance={20}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>

      {/* HUD corner brackets */}
      <span className="holo-corner tl" />
      <span className="holo-corner tr" />
      <span className="holo-corner bl" />
      <span className="holo-corner br" />

      <div className="holo-controls">
        <span className="hud-label">CONTROLS</span>
        <button
          className={`holo-btn ${spin ? 'active' : ''}`}
          onClick={() => setSpin((s) => !s)}
          title="Toggle auto-rotate"
        >
          ⟳
        </button>
        <button
          className="holo-btn"
          onClick={() => controls.current?.reset()}
          title="Reset view"
        >
          ✛
        </button>
      </div>
    </div>
  )
}
