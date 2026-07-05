import type { ImportContract, Mission, MissionTemplate, MissionTemplateLeg } from '@/types'
import { canonicalLocation } from '@/data/locations'

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()
const canonLoc = (s?: string | null) => canonicalLocation((s ?? '').trim()).toLowerCase()

/**
 * Identity of one delivery leg: commodity + canonical destination. SCU is deliberately EXCLUDED
 * — OCR frequently misreads the amount (e.g. the "0/40" progress fraction read as "740"), which
 * must not change the leg's identity or break the recall. The box split / pickup split / SCU are
 * all LEARNED data that recall writes back, not part of the key.
 */
export function legKey(leg: { commodity?: string; dropoff?: string }): string {
  return `${norm(leg.commodity)}@${canonLoc(leg.dropoff)}`
}

/**
 * A recurring contract's fingerprint: who issued it, its pickup station(s), and the set of
 * delivery legs (commodity / destination / SCU). The same fingerprint = the same repeatable
 * mission. Reward is excluded (it can OCR-vary slightly and doesn't define the mission);
 * locations & commodities are canonicalized/normalized so OCR variants still match.
 */
export function contractSignature(c: {
  contractedBy?: string | null
  pickup?: string
  legs: { commodity?: string; dropoff?: string; scu?: number; pickups?: string[] }[]
}): string {
  const who = norm(c.contractedBy)
  const pickups = [
    ...new Set(
      [c.pickup, ...c.legs.flatMap((l) => l.pickups ?? [])]
        .filter((p): p is string => !!p)
        .map((p) => canonLoc(p)),
    ),
  ].sort()
  const legs = c.legs.map(legKey).sort()
  return JSON.stringify({ who, pickups, legs })
}

/** Build a saveable template payload (id + savedAt are assigned by the store). */
export function buildTemplate(c: ImportContract): Omit<MissionTemplate, 'id' | 'savedAt'> {
  const total = c.legs.reduce((s, l) => s + (Number(l.scu) || 0), 0)
  const dests = [...new Set(c.legs.map((l) => l.dropoff).filter(Boolean))]
  const where = dests.length === 0 ? '' : ` → ${dests.length === 1 ? dests[0] : `${dests.length} drops`}`
  return {
    name: `${c.contractedBy?.trim() || 'Contract'} — ${total} SCU${where}`,
    signature: contractSignature(c),
    contractedBy: c.contractedBy ?? null,
    pickup: c.pickup,
    reward: c.reward ?? null,
    legs: c.legs.map<MissionTemplateLeg>((l) => ({
      commodity: l.commodity,
      dropoff: l.dropoff,
      scu: Number(l.scu) || 0,
      containerScu: l.containerScu ?? null,
      containers: l.containers && l.containers.length ? [...l.containers] : undefined,
      pickups: l.pickups && l.pickups.length ? [...l.pickups] : undefined,
      pickupSplit: l.pickupSplit && Object.keys(l.pickupSplit).length ? { ...l.pickupSplit } : undefined,
    })),
  }
}

/** A contract group's pickup stations for a single mission leg (its pickups, else its origin). */
const legPickups = (m: Mission) => (m.pickups && m.pickups.length ? m.pickups : m.origin ? [m.origin] : [])

/** The same signature an import produces, computed from a group of added mission legs — so a
 *  template saved here matches a future re-import of the same contract. */
export function contractSignatureFromMissions(legs: Mission[]): string {
  const head = legs[0]
  return contractSignature({
    contractedBy: head?.title ?? null,
    pickup: head?.origin,
    legs: legs.map((m) => ({ commodity: m.commodity, dropoff: m.destination, scu: m.scu, pickups: legPickups(m) })),
  })
}

/** Build a saveable template payload from added mission legs (captures box splits AND the
 *  pickup-amount split, both finalized on the Missions page). */
export function buildTemplateFromMissions(legs: Mission[]): Omit<MissionTemplate, 'id' | 'savedAt'> {
  const head = legs[0]
  const total = legs.reduce((s, m) => s + (Number(m.scu) || 0), 0)
  const dests = [...new Set(legs.map((m) => m.destination).filter(Boolean))]
  const where = dests.length === 0 ? '' : ` → ${dests.length === 1 ? dests[0] : `${dests.length} drops`}`
  return {
    name: `${head?.title?.trim() || 'Contract'} — ${total} SCU${where}`,
    signature: contractSignatureFromMissions(legs),
    contractedBy: head?.title ?? null,
    pickup: head?.origin,
    reward: legs.reduce((s, m) => s + (m.reward ?? 0), 0) || null,
    legs: legs.map<MissionTemplateLeg>((m) => ({
      commodity: m.commodity,
      dropoff: m.destination,
      scu: Number(m.scu) || 0,
      containerScu: m.containerScu ?? null,
      containers: m.containers && m.containers.length ? [...m.containers] : undefined,
      pickups: m.pickups && m.pickups.length ? [...m.pickups] : undefined,
      pickupSplit: m.pickupSplit && Object.keys(m.pickupSplit).length ? { ...m.pickupSplit } : undefined,
    })),
  }
}

const sameArr = (a?: number[], b?: number[]) => {
  if (!a?.length && !b?.length) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
const sameSplit = (a?: Record<string, number>, b?: Record<string, number>) => {
  const ak = a ? Object.keys(a) : []
  const bk = b ? Object.keys(b) : []
  if (ak.length !== bk.length) return false
  return ak.every((k) => (a![k] ?? 0) === (b?.[k] ?? 0))
}

/** Whether a contract is unsaved, saved-and-current ('synced'), or saved-but-edited ('dirty'). */
export type TemplateStatus = 'unsaved' | 'synced' | 'dirty'
export function templateStatus(
  payload: Pick<MissionTemplate, 'signature' | 'legs'>,
  templates: MissionTemplate[],
): TemplateStatus {
  const t = templates.find((x) => x.signature === payload.signature)
  if (!t) return 'unsaved'
  if (t.legs.length !== payload.legs.length) return 'dirty'
  const byKey = new Map(t.legs.map((l) => [legKey(l), l]))
  for (const leg of payload.legs) {
    const s = byKey.get(legKey(leg))
    if (
      !s ||
      (Number(leg.scu) || 0) !== (Number(s.scu) || 0) ||
      !sameArr(leg.containers, s.containers) ||
      !sameSplit(leg.pickupSplit, s.pickupSplit) ||
      (leg.containerScu ?? null) !== (s.containerScu ?? null)
    )
      return 'dirty'
  }
  return 'synced'
}

/** Insert or overwrite (by signature) a template payload into the list. */
export function upsertTemplate(
  list: MissionTemplate[],
  payload: Omit<MissionTemplate, 'id' | 'savedAt'>,
  makeId: () => string,
  now: number,
): MissionTemplate[] {
  const existing = list.find((t) => t.signature === payload.signature)
  const tpl: MissionTemplate = { ...payload, id: existing?.id ?? makeId(), savedAt: now }
  return existing ? list.map((t) => (t.id === existing.id ? tpl : t)) : [tpl, ...list]
}

/**
 * If a saved template matches this freshly-imported contract (exact signature), return a copy
 * of the contract with each leg's saved box split / box size / pickups / pickup-split filled
 * in and `_recalled` set. Otherwise return the contract unchanged.
 */
export function applyTemplate(c: ImportContract, templates: MissionTemplate[]): ImportContract {
  const sig = contractSignature(c)
  const t = templates.find((tpl) => tpl.signature === sig)
  if (!t) return c
  const byKey = new Map(t.legs.map((l) => [legKey(l), l]))
  return {
    ...c,
    _recalled: true,
    legs: c.legs.map((leg) => {
      const saved = byKey.get(legKey(leg))
      if (!saved) return leg
      return {
        ...leg,
        // Trust the saved amount over OCR (corrects the 0/40→"740" misread on a known mission).
        scu: saved.scu || leg.scu,
        containers: saved.containers && saved.containers.length ? [...saved.containers] : leg.containers,
        containerScu: saved.containerScu ?? leg.containerScu,
        pickups: saved.pickups && saved.pickups.length ? [...saved.pickups] : leg.pickups,
        pickupSplit:
          saved.pickupSplit && Object.keys(saved.pickupSplit).length ? { ...saved.pickupSplit } : leg.pickupSplit,
      }
    }),
  }
}
