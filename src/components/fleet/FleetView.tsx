import { type CSSProperties } from 'react'
import { nanoid } from 'nanoid'
import { useStore } from '@/store/useStore'
import { makeBay } from '@/data/ships'
import type { Ship } from '@/types'

export default function FleetView() {
  const ships = useStore((s) => s.ships)
  const selectShip = useStore((s) => s.selectShip)
  const setView = useStore((s) => s.setView)
  const addShip = useStore((s) => s.addShip)
  const selectedShipId = useStore((s) => s.selectedShipId)

  const open = (id: string) => {
    selectShip(id)
    setView('ship')
  }

  const addCustom = () => {
    const id = nanoid(8)
    const ship: Ship = {
      id,
      name: 'New Ship',
      manufacturer: 'Custom',
      cargoScu: 32,
      sizeCategory: 'Medium',
      crew: 1,
      lengthM: 30,
      beamM: 20,
      heightM: 10,
      accent: '#4db8e8',
      specs: [],
      bays: [makeBay('main', 'Main Hold', 4, 4, 2, { doorEdge: 'back' })],
    }
    addShip(ship)
    open(id)
  }

  const owned = ships.filter((s) => !s.builtin)
  const reference = ships.filter((s) => s.builtin)

  return (
    <div className="view fleet">
      <div className="view-head">
        <div>
          <h1>FLEET</h1>
          <p className="view-sub">Your hangar and reference hulls. Pick a ship to inspect its hold.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn--primary" onClick={addCustom}>
            + Add Ship
          </button>
        </div>
      </div>

      <h3 className="section-label">Your Ships</h3>
      <div className="ship-grid">
        {owned.map((ship) => (
          <ShipCard key={ship.id} ship={ship} active={ship.id === selectedShipId} onOpen={open} />
        ))}
        {owned.length === 0 && <p className="muted">No owned ships. Clone a reference hull below.</p>}
      </div>

      <h3 className="section-label">Reference Hulls</h3>
      <p className="muted sm fleet-ref-note">
        Community-sourced reference values — cargo capacity, dimensions and bay grids are
        approximate and can drift between Star Citizen patches. Verify in-game and edit any ship,
        or clone one into your own fleet to make it fully yours.
      </p>
      <div className="ship-grid">
        {reference.map((ship) => (
          <ShipCard key={ship.id} ship={ship} active={ship.id === selectedShipId} onOpen={open} />
        ))}
      </div>
    </div>
  )
}

function ShipCard({
  ship,
  active,
  onOpen,
}: {
  ship: Ship
  active: boolean
  onOpen: (id: string) => void
}) {
  const accent = ship.accent ?? '#4db8e8'
  return (
    <button
      className={`ship-card ${active ? 'active' : ''}`}
      onClick={() => onOpen(ship.id)}
      style={{ '--accent': accent } as CSSProperties}
    >
      <div className="ship-card-bar" />
      <div className="ship-card-body">
        <div className="ship-card-top">
          <span className="ship-mfr">{ship.manufacturer}</span>
          {ship.builtin && <span className="tag">REF</span>}
        </div>
        <h4 className="ship-name">{ship.name}</h4>
        <span className="ship-role">{ship.role ?? '—'}</span>
        <div className="ship-stats">
          <Stat label="Cargo" value={`${ship.cargoScu} SCU`} big />
          <Stat label="Size" value={ship.sizeCategory} />
          <Stat label="Crew" value={String(ship.crew)} />
          {ship.maxContainerScu && <Stat label="Max box" value={`${ship.maxContainerScu} SCU`} />}
        </div>
      </div>
    </button>
  )
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`stat ${big ? 'stat--big' : ''}`}>
      <span className="hud-label">{label}</span>
      <span className="stat-val">{value}</span>
    </div>
  )
}
