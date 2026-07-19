import { useState, type CSSProperties } from 'react'
import { useStore } from '@/store/useStore'
import HologramViewer from '@/components/hologram/HologramViewer'
import TechSpecsPanel from './TechSpecsPanel'
import ContainerSizesEditor from './ContainerSizesEditor'
import BayDesigner from './BayDesigner'
import type { Ship } from '@/types'

export default function ShipDetail() {
  const ship = useStore((s) => s.ships.find((sh) => sh.id === s.selectedShipId))
  const setView = useStore((s) => s.setView)
  const cloneShip = useStore((s) => s.cloneShip)
  const removeShip = useStore((s) => s.removeShip)
  const selectShip = useStore((s) => s.selectShip)
  const [editing, setEditing] = useState(false)
  const [designing, setDesigning] = useState(false)

  if (!ship) {
    return (
      <div className="view empty-state">
        <h2>No ship selected</h2>
        <p className="muted">Pick a ship from the Fleet to inspect its cargo hold.</p>
        <button className="btn btn--primary" onClick={() => setView('fleet')}>
          Go to Fleet
        </button>
      </div>
    )
  }

  const onClone = () => {
    const id = cloneShip(ship.id)
    selectShip(id)
    setEditing(true)
  }

  const onDelete = () => {
    if (confirm(`Delete ${ship.name}? This cannot be undone.`)) {
      removeShip(ship.id)
      setView('fleet')
    }
  }

  return (
    <div className="view ship-detail" style={{ '--accent': ship.accent ?? '#4db8e8' } as CSSProperties}>
      <div className="view-head">
        <div className="ship-title">
          <button className="back-link" onClick={() => setView('fleet')}>
            ‹ Fleet
          </button>
          <h1>{ship.name}</h1>
          <span className="ship-mfr">{ship.manufacturer}</span>
          {ship.builtin && <span className="tag">REFERENCE</span>}
        </div>
        <div className="ship-actions">
          {ship.builtin ? (
            <button className="btn" onClick={onClone}>
              Clone to Edit
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => setEditing((e) => !e)}>
                {editing ? 'Done' : 'Edit Ship'}
              </button>
              <button className="btn btn--danger" onClick={onDelete}>
                Delete
              </button>
            </>
          )}
          <button className="btn" onClick={() => setDesigning(true)}>
            ◧ 3D Bay Designer
          </button>
          <button className="btn btn--primary" onClick={() => setView('plan')}>
            Plan Load →
          </button>
        </div>
      </div>

      {designing && <BayDesigner ship={ship} onClose={() => setDesigning(false)} />}

      <div className="ship-layout">
        <TechSpecsPanel ship={ship} />
        <div className="holo-wrap panel">
          <HologramViewer
            modelUrl={ship.modelUrl}
            modelPath={ship.modelPath}
            accent={ship.accent}
            sizeM={ship.lengthM}
          />
          {!ship.modelUrl && !ship.modelPath && (
            <span className="holo-hint hud-label">
              Procedural hologram — load a .glb model below for the real hull
            </span>
          )}
        </div>
      </div>

      {editing && !ship.builtin && <ShipEditForm ship={ship} />}

      <section className="panel bd-cta">
        <div>
          <h3 className="section-label">Cargo Grid</h3>
          <p className="muted sm">
            The hold is edited in the fullscreen 3D Bay Designer now — add container areas, move /
            rotate bays, pick base surfaces and block unusable cells, all in one place.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setDesigning(true)}>
          ◧ Open Bay Designer
        </button>
      </section>

      <ContainerSizesEditor />
    </div>
  )
}

function ShipEditForm({ ship }: { ship: Ship }) {
  const updateShip = useStore((s) => s.updateShip)
  const set = (patch: Partial<Ship>) => updateShip(ship.id, patch)

  const setSpec = (i: number, key: 'label' | 'value', val: string) => {
    const specs = ship.specs.map((s, idx) => (idx === i ? { ...s, [key]: val } : s))
    set({ specs })
  }
  const addSpec = () => set({ specs: [...ship.specs, { label: 'Spec', value: '' }] })
  const removeSpec = (i: number) => set({ specs: ship.specs.filter((_, idx) => idx !== i) })

  return (
    <section className="panel edit-form">
      <h3 className="section-label">Edit Ship</h3>
      <div className="edit-grid">
        <Field label="Name">
          <input value={ship.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Manufacturer">
          <input value={ship.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />
        </Field>
        <Field label="Role">
          <input value={ship.role ?? ''} onChange={(e) => set({ role: e.target.value })} />
        </Field>
        <Field label="Cargo (SCU)">
          <input
            type="number"
            value={ship.cargoScu}
            onChange={(e) => set({ cargoScu: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Crew">
          <input
            type="number"
            value={ship.crew}
            onChange={(e) => set({ crew: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Door max SCU (0 = none)">
          <input
            type="number"
            value={ship.maxContainerScu ?? 0}
            onChange={(e) => set({ maxContainerScu: Number(e.target.value) || undefined })}
          />
        </Field>
        <Field label="Length (m)">
          <input
            type="number"
            value={ship.lengthM}
            onChange={(e) => set({ lengthM: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Width (m)">
          <input
            type="number"
            value={ship.beamM}
            onChange={(e) => set({ beamM: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Height (m)">
          <input
            type="number"
            value={ship.heightM}
            onChange={(e) => set({ heightM: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Speed (m/s)">
          <input
            type="number"
            value={ship.speedMs ?? 0}
            onChange={(e) => set({ speedMs: Number(e.target.value) || undefined })}
          />
        </Field>
        <Field label="Accent color">
          <input
            type="color"
            value={ship.accent ?? '#4db8e8'}
            onChange={(e) => set({ accent: e.target.value })}
          />
        </Field>
        <Field label="3D model (.glb)">
          <ModelPicker ship={ship} onSet={set} />
        </Field>
      </div>

      <div className="spec-editor">
        <div className="spec-editor-head">
          <span className="hud-label">Extra Spec Lines</span>
          <button className="btn btn--sm" onClick={addSpec}>
            + Add
          </button>
        </div>
        {ship.specs.map((s, i) => (
          <div className="spec-editor-row" key={i}>
            <input value={s.label} onChange={(e) => setSpec(i, 'label', e.target.value)} />
            <input value={s.value} onChange={(e) => setSpec(i, 'value', e.target.value)} />
            <button className="btn btn--sm btn--danger" onClick={() => removeSpec(i)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function ModelPicker({ ship, onSet }: { ship: Ship; onSet: (patch: Partial<Ship>) => void }) {
  const fileName = ship.modelPath?.split(/[\\/]/).pop()
  const pick = async () => {
    const b = typeof window !== 'undefined' ? window.hauler : undefined
    if (!b?.pickModel) {
      alert('Loading a .glb runs in the desktop app (HAULER OPS.exe).')
      return
    }
    const p = await b.pickModel()
    if (p) onSet({ modelPath: p })
  }
  return (
    <div className="model-picker">
      <button type="button" className="btn btn--sm" onClick={pick}>
        {ship.modelPath ? 'Change .glb…' : 'Load .glb…'}
      </button>
      {ship.modelPath && (
        <>
          <span className="model-name" title={ship.modelPath}>
            {fileName}
          </span>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => onSet({ modelPath: undefined })}
          >
            Clear
          </button>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="hud-label">{label}</span>
      {children}
    </label>
  )
}
