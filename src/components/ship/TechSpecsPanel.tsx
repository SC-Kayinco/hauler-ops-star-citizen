import type { Ship } from '@/types'

interface SpecItem {
  icon: string
  label: string
  value: string
}

export default function TechSpecsPanel({ ship }: { ship: Ship }) {
  const baySCU = ship.bays.reduce((s, b) => s + b.width * b.length * b.maxStackHeight, 0)

  const core: SpecItem[] = [
    { icon: '↔', label: 'Length', value: `${ship.lengthM} m` },
    { icon: '⤧', label: 'Width', value: `${ship.beamM} m` },
    { icon: '↕', label: 'Height', value: `${ship.heightM} m` },
    { icon: '⚑', label: 'Crew', value: String(ship.crew) },
    { icon: '⬢', label: 'Cargo', value: `${ship.cargoScu} SCU` },
    ...(ship.speedMs ? [{ icon: '➤', label: 'Speed', value: `${ship.speedMs} m/s` }] : []),
  ]

  return (
    <section className="panel panel--clip specs-panel">
      <div className="specs-head">
        <h2>TECHNICAL SPECS</h2>
        <p className="specs-note">
          Editable vehicle data. Adjust to match your in-game measurements.
        </p>
      </div>

      <div className="specs-grid">
        {core.map((s) => (
          <SpecBlock key={s.label} {...s} />
        ))}
      </div>

      {ship.specs.length > 0 && (
        <>
          <div className="specs-divider" />
          <div className="specs-list">
            {ship.specs.map((s, i) => (
              <div className="specs-row" key={i}>
                <span className="hud-label">{s.label}</span>
                <span className="specs-row-val">{s.value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="specs-divider" />
      <div className="specs-row">
        <span className="hud-label">Grid Volume</span>
        <span className="specs-row-val">{baySCU} cells</span>
      </div>
      <div className="specs-row">
        <span className="hud-label">Bays</span>
        <span className="specs-row-val">{ship.bays.length}</span>
      </div>
      {ship.maxContainerScu && (
        <div className="specs-row warn">
          <span className="hud-label">Door Limit</span>
          <span className="specs-row-val">{ship.maxContainerScu} SCU max</span>
        </div>
      )}
    </section>
  )
}

function SpecBlock({ icon, label, value }: SpecItem) {
  return (
    <div className="spec-block">
      <span className="spec-icon">{icon}</span>
      <span className="hud-label">{label}</span>
      <span className="spec-value">{value}</span>
    </div>
  )
}
