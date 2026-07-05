import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { COMMODITIES, commodityColor } from '@/data/commodities'
import { splitIntoContainers } from '@/data/containers'
import { buildRoute } from '@/lib/optimizer'
import { allPickupStations, PICKUP_SPLIT } from '@/lib/pickups'
import { buildTemplateFromMissions, templateStatus, type TemplateStatus } from '@/lib/templates'
import { canonicalLocation } from '@/data/locations'
import SaveIcon from '@/components/common/SaveIcon'
import ImportPanel from './ImportPanel'
import BoxEditor from './BoxEditor'
import Pager from '@/components/common/Pager'
import Lightbox from '@/components/common/Lightbox'
import type { Mission } from '@/types'

const PER_PAGE = 10

const EXAMPLE: Omit<Mission, 'id'>[] = [
  { origin: 'CRU-L1', destination: 'Port Olisar', commodity: 'Cobalt', scu: 20, reward: 42000 },
  { origin: 'CRU-L1', destination: 'Port Olisar', commodity: 'Titanium', scu: 12, reward: 26000 },
  { origin: 'CRU-L1', destination: 'Area18', commodity: 'Iron', scu: 16, reward: 31000 },
  { origin: 'CRU-L1', destination: 'Area18', commodity: 'Stims', scu: 8, reward: 19000 },
  { origin: 'CRU-L1', destination: 'Lorville', commodity: 'Aluminum', scu: 24, reward: 38000 },
  { origin: 'CRU-L1', destination: 'Lorville', commodity: 'Cobalt', scu: 10, reward: 22000 },
  { origin: 'CRU-L1', destination: 'New Babbage', commodity: 'Titanium', scu: 18, reward: 33000 },
  { origin: 'CRU-L1', destination: 'New Babbage', commodity: 'Medical Supplies', scu: 6, reward: 28000 },
  { origin: 'CRU-L1', destination: 'Grim HEX', commodity: 'Iron', scu: 14, reward: 24000 },
  { origin: 'CRU-L1', destination: 'Grim HEX', commodity: 'Quartz', scu: 4, reward: 12000 },
]

/** A render unit in the missions list: one standalone mission, or a multi-leg contract. */
type RowGroup =
  | { kind: 'single'; mission: Mission }
  | { kind: 'contract'; contractId: string; legs: Mission[] }

/** Collapse missions sharing a contractId into one contract group, preserving order. */
function groupRows(list: Mission[]): RowGroup[] {
  const out: RowGroup[] = []
  const indexOf = new Map<string, number>()
  for (const m of list) {
    if (m.contractId) {
      const at = indexOf.get(m.contractId)
      if (at == null) {
        indexOf.set(m.contractId, out.length)
        out.push({ kind: 'contract', contractId: m.contractId, legs: [m] })
      } else {
        ;(out[at] as Extract<RowGroup, { kind: 'contract' }>).legs.push(m)
      }
    } else {
      out.push({ kind: 'single', mission: m })
    }
  }
  return out
}

export default function MissionsView() {
  const missions = useStore((s) => s.missions)
  const addMission = useStore((s) => s.addMission)
  const removeMission = useStore((s) => s.removeMission)
  const removeContract = useStore((s) => s.removeContract)
  const updateMission = useStore((s) => s.updateMission)
  const markDelivered = useStore((s) => s.markDelivered)
  const markContractDelivered = useStore((s) => s.markContractDelivered)
  const saveMissionTemplate = useStore((s) => s.saveMissionTemplate)
  const missionTemplates = useStore((s) => s.missionTemplates)
  const clearMissions = useStore((s) => s.clearMissions)
  const reorderRoute = useStore((s) => s.reorderRoute)
  const setView = useStore((s) => s.setView)
  const earnings = useStore((s) => s.earnings)
  const ships = useStore((s) => s.ships)
  const selectedShipId = useStore((s) => s.selectedShipId)

  // Add a mission and briefly flash it in (used by the form and the importer).
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [histPage, setHistPage] = useState(0)

  // Open the source screenshot for an imported mission — re-read full-res via the desktop
  // bridge, fall back to the stored thumbnail.
  const openImage = async (m: Mission) => {
    const b = window.hauler
    if (m.capturePath && b) {
      try {
        const full = await b.readImage(m.capturePath)
        if (full) {
          setLightbox(full)
          return
        }
      } catch {
        /* fall through to thumb */
      }
    }
    if (m.thumb) setLightbox(m.thumb)
  }
  const addWithFlash = (m: Omit<Mission, 'id'>) => {
    const id = addMission(m)
    setRecentIds((prev) => new Set(prev).add(id))
    setTimeout(
      () =>
        setRecentIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        }),
      1500,
    )
    return id
  }

  const active = missions.filter((m) => !m.done)
  const done = missions.filter((m) => m.done)
  // Most-recently-delivered first. A contract logs one ledger entry keyed by its contractId;
  // standalone missions key by their own id — both resolve to the same delivery timestamp.
  const deliveredTs = (m: Mission) => earnings.find((e) => e.missionId === (m.contractId ?? m.id))?.ts ?? 0
  const sortedHistory = [...done].sort((a, b) => deliveredTs(b) - deliveredTs(a))
  const route = buildRoute(active)
  const totalScu = active.reduce((s, m) => s + m.scu, 0)
  const totalReward = active.reduce((s, m) => s + (m.reward ?? 0), 0)

  // Group a list into contract cards (legs sharing a contractId) + standalone rows, preserving order.
  const activeGroups = groupRows(active)
  const historyGroups = groupRows(sortedHistory)

  // Active shows in full (the player wants the whole plan visible); History paginates by GROUP
  // so a contract's legs never get split across a page boundary.
  const histPageCount = Math.max(1, Math.ceil(historyGroups.length / PER_PAGE))
  const safeHistPage = Math.min(histPage, histPageCount - 1)
  const shownHistoryGroups = historyGroups.slice(safeHistPage * PER_PAGE, safeHistPage * PER_PAGE + PER_PAGE)

  // Live cargo-room readout for the currently selected ship, so the player can
  // decide whether the next contract still fits before accepting it.
  const selectedShip = ships.find((s) => s.id === selectedShipId)
  const shipCap = selectedShip?.cargoScu ?? 0
  const remainingScu = shipCap - totalScu
  const usedPct = shipCap > 0 ? Math.min(100, (totalScu / shipCap) * 100) : 0
  const overCap = remainingScu < 0

  const renderRow = (m: Mission) => (
    <MissionRow
      key={m.id}
      mission={m}
      isNew={recentIds.has(m.id)}
      onRemove={() => removeMission(m.id)}
      onToggleDone={() => markDelivered(m.id, !m.done)}
      onSetContainers={(c) => updateMission(m.id, { containers: c })}
      onUpdate={(patch) => updateMission(m.id, patch)}
      onOpenImage={() => openImage(m)}
    />
  )

  // Add a delivery leg to an existing contract, sharing the contract's pickup/contractor fields.
  const addContractLeg = (g: Extract<RowGroup, { kind: 'contract' }>) => {
    const head = g.legs[0]
    addWithFlash({
      contractId: g.contractId,
      title: head?.title,
      origin: head?.origin ?? 'Origin',
      pickups: head?.pickups,
      destination: 'Destination',
      commodity: 'Cargo',
      scu: 0,
    })
  }

  // Remove one leg. If it's the last one, drop the whole contract. The contract reward lives on
  // the first leg, so if a reward-carrying leg is removed, hand its reward to a surviving leg
  // (keeps the contract's total payout intact).
  const removeContractLeg = (contractId: string, legId: string) => {
    const legs = missions.filter((m) => m.contractId === contractId)
    if (legs.length <= 1) {
      removeContract(contractId)
      return
    }
    const removed = legs.find((m) => m.id === legId)
    const survivor = legs.find((m) => m.id !== legId)
    if (removed?.reward && survivor) {
      updateMission(survivor.id, { reward: (survivor.reward ?? 0) + removed.reward })
    }
    removeMission(legId)
  }

  // A grouped contract renders as one card (header + stacked legs); a standalone mission as a row.
  const renderGroup = (g: RowGroup) =>
    g.kind === 'single' ? (
      renderRow(g.mission)
    ) : (
      <ContractMissionCard
        key={g.contractId}
        legs={g.legs}
        isNew={g.legs.some((m) => recentIds.has(m.id))}
        onToggleDone={() => markContractDelivered(g.contractId, !g.legs.every((m) => m.done))}
        onRemove={() => removeContract(g.contractId)}
        onSetContainers={(id, c) => updateMission(id, { containers: c })}
        onUpdate={(id, patch) => updateMission(id, patch)}
        onOpenImage={openImage}
        onAddLeg={() => addContractLeg(g)}
        onRemoveLeg={(id) => removeContractLeg(g.contractId, id)}
        onSaveTemplate={() => saveMissionTemplate(g.legs)}
        templateState={templateStatus(buildTemplateFromMissions(g.legs), missionTemplates)}
      />
    )

  const loadExample = () => EXAMPLE.forEach((m) => addMission(m))

  const moveDest = (dest: string, dir: -1 | 1) => {
    const idx = route.indexOf(dest)
    const next = idx + dir
    if (next < 0 || next >= route.length) return
    const reordered = [...route]
    ;[reordered[idx], reordered[next]] = [reordered[next], reordered[idx]]
    reorderRoute(reordered)
  }

  return (
    <div className="view missions">
      <div className="view-head">
        <div>
          <h1>MISSIONS</h1>
          <p className="view-sub">
            Enter the hauling contracts you accepted (plan ~10 at a time). Group destinations into a
            delivery route, then build the load plan.
          </p>
        </div>
        <div className="row-actions">
          {missions.length === 0 && (
            <button className="btn" onClick={loadExample}>
              Load Example Set
            </button>
          )}
          {missions.length > 0 && (
            <button className="btn btn--danger" onClick={() => clearMissions()}>
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="missions-layout">
        <div className="missions-main">
          <ImportPanel onAdd={addWithFlash} />
          <AddMissionForm onAdd={addWithFlash} lastOrigin={missions[missions.length - 1]?.origin} />

          {selectedShip ? (
            <div className="cap-meter panel">
              <div className="cap-meter-head">
                <span className="hud-label">Cargo room · {selectedShip.name}</span>
                <span className="cap-meter-nums">
                  <strong>{totalScu}</strong> / {shipCap} SCU used ·{' '}
                  <span className={`cap-free ${overCap ? 'over' : ''}`}>
                    {overCap ? `${-remainingScu} SCU over capacity` : `${remainingScu} SCU free`}
                  </span>
                </span>
              </div>
              <div className="cap-bar">
                <div
                  className={`cap-bar-fill ${overCap ? 'over' : ''}`}
                  style={{ width: `${overCap ? 100 : usedPct}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="muted sm">Select a ship in the Fleet tab to see remaining cargo room here.</p>
          )}

          <div className="mission-summary">
            <span>
              <strong>{active.length}</strong> active
            </span>
            <span>
              <strong>{totalScu}</strong> SCU total
            </span>
            <span>
              <strong>{route.length}</strong> destinations
            </span>
            <span className="summary-reward">
              <strong>{totalReward.toLocaleString()}</strong> aUEC
            </span>
          </div>

          <div className="mission-list">
            {active.length === 0 && (
              <p className="muted">No active missions. Add one above or load the example set.</p>
            )}
            {activeGroups.map(renderGroup)}
          </div>

          {done.length > 0 && (
            <div className="history-section">
              <div className="history-head">
                <h3 className="section-label">History · Delivered</h3>
                <span className="muted sm">{done.length} delivered — tap ↺ to restore</span>
              </div>
              <div className="mission-list history-list">{shownHistoryGroups.map(renderGroup)}</div>
              <Pager page={safeHistPage} pages={histPageCount} onPage={setHistPage} />
            </div>
          )}
        </div>

        <aside className="route-panel panel">
          <h3 className="section-label">Delivery Route</h3>
          <p className="muted sm">
            Order the stops as you'll fly them. The planner loads later stops deep and earlier stops
            near the door (LIFO).
          </p>
          {route.length === 0 && <p className="muted">Add missions to build a route.</p>}
          <ol className="route-list">
            {route.map((dest, i) => (
              <li key={dest} className="route-item">
                <span className="route-num">{i + 1}</span>
                <span className="route-dest">{dest}</span>
                <span className="route-scu">
                  {missions
                    .filter((m) => !m.done && canonicalLocation(m.destination) === dest)
                    .reduce((s, m) => s + m.scu, 0)}{' '}
                  SCU
                </span>
                <span className="route-move">
                  <button onClick={() => moveDest(dest, -1)} disabled={i === 0}>
                    ▲
                  </button>
                  <button onClick={() => moveDest(dest, 1)} disabled={i === route.length - 1}>
                    ▼
                  </button>
                </span>
              </li>
            ))}
          </ol>
          {route.length > 0 && (
            <button className="btn btn--primary full" onClick={() => setView('plan')}>
              Build Load Plan →
            </button>
          )}
        </aside>
      </div>

      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function AddMissionForm({
  onAdd,
  lastOrigin,
}: {
  onAdd: (m: Omit<Mission, 'id'>) => void
  lastOrigin?: string
}) {
  const [origin, setOrigin] = useState(lastOrigin ?? '')
  const [destination, setDestination] = useState('')
  const [commodity, setCommodity] = useState('')
  const [scu, setScu] = useState('')
  const [box, setBox] = useState('')
  const [reward, setReward] = useState('')

  const containerSizes = useStore((s) => s.containerSizes)
  const scuNum = Number(scu) || 0
  const boxSize = Number(box) || 32
  const preview = scuNum > 0 ? splitIntoContainers(scuNum, boxSize, containerSizes) : []

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!destination || !commodity || scuNum <= 0) return
    onAdd({
      origin: origin || 'Origin',
      destination,
      commodity,
      scu: scuNum,
      containerScu: Number(box) || undefined,
      reward: Number(reward) || undefined,
    })
    setDestination('')
    setCommodity('')
    setScu('')
    setBox('')
    setReward('')
  }

  return (
    <form className="panel add-mission" onSubmit={submit}>
      <datalist id="commodities">
        {COMMODITIES.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      <div className="add-mission-fields">
        <label className="field">
          <span className="hud-label">Pickup</span>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Station A" />
        </label>
        <label className="field">
          <span className="hud-label">Destination *</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Deliver to..."
          />
        </label>
        <label className="field">
          <span className="hud-label">Commodity *</span>
          <input
            list="commodities"
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            placeholder="Cobalt..."
          />
        </label>
        <label className="field field--sm">
          <span className="hud-label">SCU *</span>
          <input
            type="number"
            value={scu}
            onChange={(e) => setScu(e.target.value)}
            placeholder="20"
            min={1}
          />
        </label>
        <label
          className="field field--sm"
          title="The container size the contract provides (e.g. “4 SCU or smaller” → 4). Sets how the SCU splits into boxes. Leave 'auto' to use the global max box size."
        >
          <span className="hud-label">Box SCU ⓘ</span>
          <input
            type="number"
            value={box}
            onChange={(e) => setBox(e.target.value)}
            placeholder="auto"
            min={1}
            max={32}
          />
        </label>
        <label className="field field--sm">
          <span className="hud-label">Reward</span>
          <input
            type="number"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            placeholder="aUEC"
          />
        </label>
        <button className="btn btn--primary" type="submit">
          + Add
        </button>
      </div>
      {preview.length > 0 && (
        <div className="split-preview">
          <span className="hud-label">Auto-split:</span>
          {preview.map((s, i) => (
            <span className="box-chip" key={i}>
              {s}
            </span>
          ))}
          <span className="muted sm">({preview.length} containers)</span>
        </div>
      )}
    </form>
  )
}

function MissionRow({
  mission,
  isNew,
  grouped,
  onRemove,
  onToggleDone,
  onSetContainers,
  onUpdate,
  onOpenImage,
}: {
  mission: Mission
  isNew?: boolean
  /** True when rendered inside a contract card — deliver/remove/reward/thumb live on the card. */
  grouped?: boolean
  onRemove?: () => void
  onToggleDone?: () => void
  onSetContainers: (c: number[] | undefined) => void
  onUpdate: (patch: Partial<Mission>) => void
  onOpenImage: () => void
}) {
  const [editFields, setEditFields] = useState(false)
  const containerSizes = useStore((s) => s.containerSizes)
  const color = commodityColor(mission.commodity)
  const custom = !!(mission.containers && mission.containers.length)
  const boxes = custom
    ? mission.containers!
    : splitIntoContainers(mission.scu, mission.containerScu ?? 32, containerSizes)

  return (
    <div className="mission-item">
      <div className={`mission-row ${mission.done ? 'done' : ''} ${isNew ? 'mission-row--new' : ''} ${grouped ? 'grouped' : ''}`}>
        {!grouped && mission.thumb && (
          <button
            className="ss-thumb-btn row"
            onClick={onOpenImage}
            title="Click to enlarge the source screenshot"
          >
            <img className="ss-thumb" src={mission.thumb} alt="source screenshot" />
          </button>
        )}
        <span className="commodity-dot" style={{ background: color }} />
        <div className="mission-info">
          <span className="mission-commodity">
            {mission.commodity} <span className="mission-scu">{mission.scu} SCU</span>
          </span>
          <span className="mission-route">
            {mission.origin} → <strong>{mission.destination}</strong>
          </span>
          <PickupChoice mission={mission} onUpdate={onUpdate} />
          <div className="mission-boxes">
            {boxes.map((b, i) => (
              <span className="box-chip sm" key={i}>
                {b}
              </span>
            ))}
            <button
              className={`boxes-edit ${custom ? 'custom' : ''}`}
              onClick={() => setEditFields((e) => !e)}
              title="Edit this mission & its containers"
            >
              📦 {custom ? 'boxes' : 'boxes (auto)'}
            </button>
          </div>
        </div>
        {!grouped && mission.reward != null && (
          <span className="mission-reward">{mission.reward.toLocaleString()} aUEC</span>
        )}
        <div className="mission-row-actions">
          <button
            className={`icon-btn ${editFields ? 'on' : ''}`}
            onClick={() => setEditFields((e) => !e)}
            title="Edit mission"
          >
            ✎
          </button>
          {!grouped && (
            <>
              <button className="icon-btn" onClick={onToggleDone} title="Toggle delivered">
                {mission.done ? '↺' : '✓'}
              </button>
              <button className="icon-btn danger" onClick={onRemove} title="Remove">
                ✕
              </button>
            </>
          )}
        </div>
      </div>
      {editFields && (
        <MissionEditForm mission={mission} onUpdate={onUpdate} onSetContainers={onSetContainers} />
      )}
    </div>
  )
}

/**
 * "Where will you collect this?" — for a mission whose commodity is listed at several stations,
 * a dropdown to pin it to ONE station (the others drop off the route) or to split it across them
 * (per-station SCU inputs). Renders nothing for single-pickup missions.
 */
function PickupChoice({
  mission,
  onUpdate,
}: {
  mission: Mission
  onUpdate: (patch: Partial<Mission>) => void
}) {
  const stations = allPickupStations(mission)
  if (stations.length <= 1) return null
  const setSplit = (station: string, value: number) =>
    onUpdate({ pickupSplit: { ...(mission.pickupSplit ?? {}), [station]: value } })
  return (
    <div className="pickup-choice">
      <span className="hud-label">Collect from</span>
      <select
        className="pickup-choice-select"
        value={mission.pickupChoice ?? ''}
        onChange={(e) => onUpdate({ pickupChoice: e.target.value || undefined })}
        title="This commodity is offered at several stations — pick where you'll actually collect it. Pinning one drops the others from the route."
      >
        <option value="">All listed (not chosen)</option>
        {stations.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option value={PICKUP_SPLIT}>Split between them…</option>
      </select>
      {mission.pickupChoice === PICKUP_SPLIT && (
        <span className="pickup-split-inline">
          {stations.map((s) => (
            <label key={s} className="field field--sm" title={`SCU collected at ${s}`}>
              <span className="hud-label">{s}</span>
              <input
                type="number"
                min={0}
                placeholder="?"
                value={mission.pickupSplit?.[s] ?? ''}
                onChange={(e) => setSplit(s, Number(e.target.value) || 0)}
              />
            </label>
          ))}
        </span>
      )}
    </div>
  )
}

/** One imported contract shown as a single card: header (contractor + pickup + one reward) and
 *  its delivery legs stacked below. Delivered/removed as a whole (the player completes the whole
 *  contract before it pays out). */
function ContractMissionCard({
  legs,
  isNew,
  onToggleDone,
  onRemove,
  onSetContainers,
  onUpdate,
  onOpenImage,
  onAddLeg,
  onRemoveLeg,
  onSaveTemplate,
  templateState,
}: {
  legs: Mission[]
  isNew?: boolean
  onToggleDone: () => void
  onRemove: () => void
  onSetContainers: (id: string, c: number[] | undefined) => void
  onUpdate: (id: string, patch: Partial<Mission>) => void
  onOpenImage: (m: Mission) => void
  onAddLeg: () => void
  onRemoveLeg: (id: string) => void
  onSaveTemplate: () => void
  /** Save state for this contract: unsaved / synced (saved & current) / dirty (edited since save). */
  templateState: TemplateStatus
}) {
  // "Edit whole contract" mode — one panel for all legs + shared fields, instead of
  // per-leg ✎. The per-leg ✎ stays available when this is off.
  const [editAll, setEditAll] = useState(false)
  const head = legs[0]
  const allDone = legs.every((m) => m.done)
  const reward = legs.reduce((s, m) => s + (m.reward ?? 0), 0)
  const totalScu = legs.reduce((s, m) => s + m.scu, 0)
  const thumb = legs.find((m) => m.thumb)?.thumb
  const thumbMission = legs.find((m) => m.thumb) ?? head

  return (
    <div
      className={`contract-card mission-contract ${allDone ? 'delivered' : ''} ${isNew ? 'mission-row--new' : ''}`}
    >
      <div className="contract-top">
        {thumb && (
          <button
            className="ss-thumb-btn"
            onClick={() => onOpenImage(thumbMission)}
            title="Click to enlarge the source screenshot"
          >
            <img className="ss-thumb" src={thumb} alt="source screenshot" />
            <span className="ss-thumb-zoom">⛶</span>
          </button>
        )}
        <div className="contract-headline">
          <span className="contract-title-text">{head?.title || 'Contract'}</span>
          <div className="contract-meta">
            <span className="hud-label">from {head?.origin || 'Origin'}</span>
            {reward > 0 && <span className="contract-reward">{reward.toLocaleString()} aUEC</span>}
            <span className="contract-total hud-label">
              {legs.length} drop{legs.length === 1 ? '' : 's'} · {totalScu} SCU
            </span>
          </div>
          <label
            className="field field--wide contract-pickups"
            title="All collection points — separate with |. Visited as PICKUP stops by the route optimizer. Applies to every leg."
          >
            <span className="hud-label">Pickup Points ⓘ</span>
            <input
              value={(head?.pickups ?? []).join(' | ')}
              placeholder="single point — or: CRU-L1 … | CRU-L5 …"
              onChange={(e) => {
                const pickups = e.target.value
                  .split('|')
                  .map((s) => s.trim())
                  .filter(Boolean)
                legs.forEach((leg) => onUpdate(leg.id, { pickups: pickups.length ? pickups : undefined }))
              }}
            />
          </label>
        </div>
        <div className="mission-row-actions">
          <button
            className={`icon-btn ${editAll ? 'on' : ''}`}
            onClick={() => setEditAll((e) => !e)}
            title="Edit the whole contract (all deliveries at once)"
          >
            ✎
          </button>
          <button
            className={`icon-btn ${templateState === 'synced' ? 'saved' : templateState === 'dirty' ? 'dirty' : ''}`}
            onClick={onSaveTemplate}
            title={
              templateState === 'synced'
                ? 'Saved — a future import of this contract auto-fills its box splits & pickups.'
                : templateState === 'dirty'
                  ? 'Changed since you saved — click to update the saved layout with your current edits.'
                  : 'Save this contract’s box splits & pickup layout so a future import fills them in automatically'
            }
          >
            <SaveIcon />
          </button>
          <button
            className="icon-btn"
            onClick={onToggleDone}
            title={allDone ? 'Restore contract (undo delivery)' : 'Mark the WHOLE contract delivered'}
          >
            {allDone ? '↺' : '✓'}
          </button>
          <button className="icon-btn danger" onClick={onRemove} title="Remove the whole contract">
            ✕
          </button>
        </div>
      </div>

      {editAll ? (
        <ContractEditForm
          legs={legs}
          onUpdate={onUpdate}
          onSetContainers={onSetContainers}
          onAddLeg={onAddLeg}
          onRemoveLeg={onRemoveLeg}
        />
      ) : (
        <div className="contract-legs">
          {legs.map((leg) => (
            <MissionRow
              key={leg.id}
              mission={leg}
              grouped
              onSetContainers={(c) => onSetContainers(leg.id, c)}
              onUpdate={(patch) => onUpdate(leg.id, patch)}
              onOpenImage={() => onOpenImage(leg)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Single panel to edit an ENTIRE contract: shared fields (contractor, pickup, pickup points,
 * whole-contract reward) at the top, then every delivery leg (commodity / destination / SCU /
 * containers) stacked below with add/remove. Shared fields write to every leg; the reward sits
 * on the first leg (the contract's single payout).
 */
function ContractEditForm({
  legs,
  onUpdate,
  onSetContainers,
  onAddLeg,
  onRemoveLeg,
}: {
  legs: Mission[]
  onUpdate: (id: string, patch: Partial<Mission>) => void
  onSetContainers: (id: string, c: number[] | undefined) => void
  onAddLeg: () => void
  onRemoveLeg: (id: string) => void
}) {
  const head = legs[0]
  const setAll = (patch: Partial<Mission>) => legs.forEach((l) => onUpdate(l.id, patch))

  return (
    <div className="mission-edit panel contract-edit">
      <div className="contract-edit-shared">
        <span className="hud-label section">Whole contract</span>
        <div className="mission-edit-fields">
          <label className="field">
            <span className="hud-label">Contractor</span>
            <input
              value={head?.title ?? ''}
              placeholder="Contractor / title"
              onChange={(e) => setAll({ title: e.target.value || undefined })}
            />
          </label>
          <label className="field">
            <span className="hud-label">Pickup</span>
            <input value={head?.origin ?? ''} onChange={(e) => setAll({ origin: e.target.value })} />
          </label>
          <label
            className="field field--wide"
            title="All collection points — separate with |. Visited as PICKUP stops by the route optimizer. Applies to every delivery."
          >
            <span className="hud-label">Pickup Points ⓘ</span>
            <input
              value={(head?.pickups ?? []).join(' | ')}
              placeholder="single point — or: CRU-L1 … | CRU-L5 …"
              onChange={(e) => {
                const pickups = e.target.value
                  .split('|')
                  .map((s) => s.trim())
                  .filter(Boolean)
                setAll({ pickups: pickups.length ? pickups : undefined })
              }}
            />
          </label>
          <label className="field field--sm">
            <span className="hud-label">Reward</span>
            <input
              type="number"
              value={head?.reward ?? ''}
              placeholder="aUEC"
              onChange={(e) =>
                head && onUpdate(head.id, { reward: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </label>
        </div>
      </div>

      <div className="contract-edit-legs">
        {legs.map((leg, i) => (
          <div className="contract-edit-leg" key={leg.id}>
            <div className="contract-edit-leg-head">
              <span className="hud-label">Delivery {i + 1}</span>
              <button
                className="icon-btn danger"
                onClick={() => onRemoveLeg(leg.id)}
                title="Remove this delivery"
              >
                ✕
              </button>
            </div>
            <div className="mission-edit-fields">
              <label className="field">
                <span className="hud-label">Commodity</span>
                <input
                  list="commodities"
                  value={leg.commodity}
                  onChange={(e) => onUpdate(leg.id, { commodity: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="hud-label">Destination</span>
                <input
                  value={leg.destination}
                  onChange={(e) => onUpdate(leg.id, { destination: e.target.value })}
                />
              </label>
              <label className="field field--sm">
                <span className="hud-label">SCU</span>
                <input
                  type="number"
                  value={leg.scu}
                  onChange={(e) => onUpdate(leg.id, { scu: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
            <BoxEditor
              boxes={leg.containers ?? []}
              scu={leg.scu}
              onChange={(c) => onSetContainers(leg.id, c)}
            />
          </div>
        ))}
        <button className="btn btn--sm leg-add" onClick={onAddLeg} title="Add another delivery to this contract">
          + Add delivery
        </button>
      </div>
      <p className="muted sm">
        Shared fields apply to every delivery; the reward is the whole-contract payout.
      </p>
    </div>
  )
}

function MissionEditForm({
  mission,
  onUpdate,
  onSetContainers,
}: {
  mission: Mission
  onUpdate: (patch: Partial<Mission>) => void
  onSetContainers: (c: number[] | undefined) => void
}) {
  return (
    <div className="mission-edit panel">
      <div className="mission-edit-fields">
        <label className="field">
          <span className="hud-label">Commodity</span>
          <input value={mission.commodity} onChange={(e) => onUpdate({ commodity: e.target.value })} />
        </label>
        <label className="field">
          <span className="hud-label">Pickup</span>
          <input value={mission.origin} onChange={(e) => onUpdate({ origin: e.target.value })} />
        </label>
        <label
          className="field"
          title="If cargo is collected from several stations, list them all — separate with |. Visited as PICKUP stops on the route."
        >
          <span className="hud-label">Pickup Points ⓘ</span>
          <input
            value={(mission.pickups ?? []).join(' | ')}
            placeholder="CRU-L1 … | CRU-L5 …"
            onChange={(e) => {
              const pickups = e.target.value
                .split('|')
                .map((s) => s.trim())
                .filter(Boolean)
              onUpdate({ pickups: pickups.length ? pickups : undefined })
            }}
          />
        </label>
        <label className="field">
          <span className="hud-label">Destination</span>
          <input value={mission.destination} onChange={(e) => onUpdate({ destination: e.target.value })} />
        </label>
        <label className="field field--sm">
          <span className="hud-label">SCU</span>
          <input
            type="number"
            value={mission.scu}
            onChange={(e) => onUpdate({ scu: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="field field--sm">
          <span className="hud-label">Reward</span>
          <input
            type="number"
            value={mission.reward ?? ''}
            placeholder="aUEC"
            onChange={(e) => onUpdate({ reward: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
      </div>
      <BoxEditor boxes={mission.containers ?? []} scu={mission.scu} onChange={onSetContainers} />
      <p className="muted sm">
        Tip: matching two stops' Destination text exactly merges them into one delivery stop.
      </p>
    </div>
  )
}

// BoxEditor moved to ./BoxEditor (shared with the screenshot importer).
