import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type {
  EarningEntry,
  GroupMode,
  ImportContract,
  Mission,
  MissionTemplate,
  OcrMode,
  Profile,
  Ship,
  View,
} from '@/types'
import type { OptimizedRoute } from '@/lib/routeOptimizer'
import { SEED_SHIPS } from '@/data/ships'
import { canonicalLocation } from '@/data/locations'
import { type ContainerSize, DEFAULT_CONTAINER_SIZES } from '@/data/containers'
import {
  buildTemplate,
  buildTemplateFromMissions,
  contractSignature,
  legKey,
  upsertTemplate,
} from '@/lib/templates'

interface AppState {
  ships: Ship[]
  missions: Mission[]
  /** Permanent ledger of delivered missions — drives the Earnings tab. */
  earnings: EarningEntry[]
  /** Parsed screenshot contracts awaiting review (transient — not persisted to disk). */
  pendingImports: ImportContract[]
  /**
   * Saved "mission memories" — box splits + pickup layout for recurring contracts, keyed by a
   * content signature. A re-imported contract with a matching signature recalls its layout.
   */
  missionTemplates: MissionTemplate[]
  /** Editable cargo container sizes (footprints) — global, used by the optimizer/3D/split. */
  containerSizes: ContainerSize[]
  /**
   * Persisted "loaded ✓" checklist — stable container keys (`missionId:boxIdx`) the player
   * marked as physically loaded. Survives app/game crashes mid-loading; pruned automatically
   * when a mission is delivered or removed.
   */
  loadedKeys: string[]
  /** Manual container placements per ship: shipId → containerKey → bay cell or floor-parked pos. */
  manualLayout: Record<
    string,
    Record<
      string,
      { bayId: string; x: number; y: number; z: number } | { floored: true; fx: number; fz: number }
    >
  >

  /** Where the player is right now — route start point. Empty = auto (most common pickup). */
  currentLocation: string
  /** Pinned locations shown first in the location picker. */
  favoriteLocations: string[]
  /**
   * Last computed optimized route (from "✦ Optimize Route"). Persisted so the route panel
   * survives tab switches AND app restarts — the player optimizes once and it stays shown.
   * Null = not optimized yet. Cleared when missions are cleared/reset.
   */
  routeResult: OptimizedRoute | null

  /** The player's pilot profile (avatar, name, bio, profession tags). Shown in the sidebar. */
  profile: Profile

  view: View
  selectedShipId: string | null
  /** Cap on the largest container size the optimizer will create. */
  maxBox: number
  /** How containers are grouped into islands in the hold. */
  groupMode: GroupMode
  /** How mission screenshots are OCR-read (aspect auto-detect, forced crop, or full image). */
  ocrMode: OcrMode

  // navigation
  setView: (v: View) => void
  selectShip: (id: string | null) => void

  // ships
  addShip: (ship: Ship) => void
  updateShip: (id: string, patch: Partial<Ship>) => void
  removeShip: (id: string) => void
  cloneShip: (id: string) => string

  // missions
  addMission: (m: Omit<Mission, 'id'>) => string
  updateMission: (id: string, patch: Partial<Mission>) => void
  /** Toggle a mission's delivered flag AND log/unlog its earnings entry. */
  markDelivered: (id: string, done: boolean) => void
  /** Deliver/undeliver an ENTIRE contract (all its legs) at once, logging ONE earnings entry. */
  markContractDelivered: (contractId: string, done: boolean) => void
  removeMission: (id: string) => void
  /** Toggle the run-time "dropped" (cargo delivered to this stop, removed from hold) flag on
   *  several missions at once. Does NOT log earnings — purely declutters the hold. */
  setDropped: (ids: string[], dropped: boolean) => void
  /** Remove every leg of a contract. */
  removeContract: (contractId: string) => void
  clearMissions: () => void
  reorderRoute: (orderedDestinations: string[]) => void

  // earnings
  clearEarnings: () => void
  /** Correct a logged delivery's payout (e.g. partial delivery paid less than the contract). */
  updateEarning: (id: string, reward: number) => void

  // loaded ✓ checklist (persisted, keyed by stable container key)
  setLoadedKey: (key: string, value: boolean) => void
  clearLoadedKeys: () => void

  // screenshot-import review (transient; survives tab switches, not app restarts)
  addPendingImports: (cards: ImportContract[]) => void
  updatePendingImport: (id: string, patch: Partial<ImportContract>) => void
  removePendingImport: (id: string) => void
  clearPendingImports: () => void

  // mission templates (saved layouts for recurring contracts)
  /** Save/overwrite a template from a reviewed import contract (upserts by signature). */
  saveTemplate: (contract: ImportContract) => void
  /** Save/overwrite a template from added mission legs (the Missions-page card). */
  saveMissionTemplate: (legs: Mission[]) => void
  deleteTemplate: (id: string) => void

  // container sizes (global)
  setContainerSizes: (sizes: ContainerSize[]) => void

  // manual 3D cargo layout (per ship)
  moveContainer: (
    shipId: string,
    key: string,
    pos: { bayId: string; x: number; y: number; z: number } | { floored: true; fx: number; fz: number },
  ) => void
  clearShipLayout: (shipId: string) => void

  // location
  setCurrentLocation: (loc: string) => void
  toggleFavoriteLocation: (loc: string) => void

  // route (persisted optimized-route display)
  setRouteResult: (r: OptimizedRoute | null) => void

  // profile
  setProfile: (patch: Partial<Profile>) => void

  // settings / data
  setMaxBox: (n: number) => void
  setGroupMode: (m: GroupMode) => void
  setOcrMode: (m: OcrMode) => void
  resetAll: () => void
}

const EMPTY_PROFILE: Profile = {
  handle: '',
  tag: '',
  // Flavor default bio shipped with the app — a sample pilot persona new users can rewrite.
  bio: "Grew up on Lorville's cargo docks and earned his first aUEC running unregistered freight. These days he hauls the deadliest routes between Stanton and Pyro — the cargo ship pirates mistake for an easy target becomes the last stop for anyone who chases it. His word is his bond, his hold is always full, and his deliveries never fail.",
  avatar: '',
  roles: [],
  ownShips: [],
  holoEffect: true,
}

/** Separate localStorage mirror of the pilot profile, so it survives a store reset /
 *  version migration / partial corruption that would otherwise wipe it. (For a FULL
 *  localStorage wipe, the file Backup is the recovery path — this covers the common case.) */
const PROFILE_BACKUP_KEY = 'hauler-profile-backup'
// Bio is excluded on purpose: it now ships with a default flavor value, so it's not a signal
// that the pilot has actually filled in their identity (handle/tag/avatar/roles/ships).
const isEmptyProfile = (p?: Profile) =>
  !p ||
  (!p.handle && !p.tag && !p.avatar && !p.roles?.length && !p.ownShips?.length)
const mirrorProfile = (p: Profile) => {
  try {
    if (!isEmptyProfile(p)) localStorage.setItem(PROFILE_BACKUP_KEY, JSON.stringify(p))
  } catch {
    /* ignore quota / unavailable */
  }
}

/** Drop loaded-✓ keys belonging to the given missions (key format `missionId:boxIdx`). */
const pruneLoaded = (keys: string[], missionIds: string[]) =>
  keys.filter((k) => !missionIds.some((id) => k.startsWith(`${id}:`)))

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ships: SEED_SHIPS,
      missions: [],
      earnings: [],
      pendingImports: [],
      missionTemplates: [],
      containerSizes: DEFAULT_CONTAINER_SIZES,
      loadedKeys: [],
      manualLayout: {},
      currentLocation: '',
      favoriteLocations: ['Seraphim Station'],
      routeResult: null,
      profile: EMPTY_PROFILE,
      view: 'fleet',
      selectedShipId: 'gatac-railen',
      maxBox: 32,
      groupMode: 'destination',
      ocrMode: 'auto',

      setView: (v) => set({ view: v }),
      selectShip: (id) => set({ selectedShipId: id }),

      addShip: (ship) => set((s) => ({ ships: [...s.ships, ship] })),
      updateShip: (id, patch) =>
        set((s) => ({
          ships: s.ships.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)),
        })),
      removeShip: (id) =>
        set((s) => ({
          ships: s.ships.filter((sh) => sh.id !== id),
          selectedShipId: s.selectedShipId === id ? null : s.selectedShipId,
        })),
      cloneShip: (id) => {
        const src = get().ships.find((sh) => sh.id === id)
        const newId = nanoid(8)
        if (src) {
          const copy: Ship = {
            ...structuredClone(src),
            id: newId,
            name: `${src.name} (Copy)`,
            builtin: false,
          }
          set((s) => ({ ships: [...s.ships, copy] }))
        }
        return newId
      },

      addMission: (m) => {
        const id = nanoid(8)
        set((s) => ({ missions: [...s.missions, { ...m, id }] }))
        return id
      },
      updateMission: (id, patch) =>
        set((s) => {
          const missions = s.missions.map((m) => (m.id === id ? { ...m, ...patch } : m))
          // Learn pickup-split edits back into the saved template (if this mission came from
          // one) so a future re-import recalls the amounts, not just the box split.
          let missionTemplates = s.missionTemplates
          if ('pickupSplit' in patch || 'pickupChoice' in patch) {
            const m = missions.find((mm) => mm.id === id)
            if (m?.templateSig) {
              const k = legKey({ commodity: m.commodity, dropoff: m.destination })
              missionTemplates = s.missionTemplates.map((t) =>
                t.signature !== m.templateSig
                  ? t
                  : {
                      ...t,
                      savedAt: Date.now(),
                      legs: t.legs.map((leg) =>
                        legKey(leg) === k ? { ...leg, pickupSplit: m.pickupSplit } : leg,
                      ),
                    },
              )
            }
          }
          return { missions, missionTemplates }
        }),
      markDelivered: (id, done) =>
        set((s) => {
          const m = s.missions.find((mm) => mm.id === id)
          if (!m) return {}
          const missions = s.missions.map((mm) => (mm.id === id ? { ...mm, done } : mm))
          let earnings = s.earnings
          if (done) {
            // Log the delivery the moment it's marked ✓ (skip if already logged).
            if (!earnings.some((e) => e.missionId === id)) {
              earnings = [
                ...earnings,
                {
                  id: nanoid(8),
                  missionId: id,
                  reward: m.reward ?? 0,
                  commodity: m.commodity,
                  destination: m.destination,
                  ts: Date.now(),
                },
              ]
            }
          } else {
            // Un-delivering (↺) removes the logged entry.
            earnings = earnings.filter((e) => e.missionId !== id)
          }
          // Delivered cargo is off the ship — its loaded ✓ marks are done with.
          const loadedKeys = done ? pruneLoaded(s.loadedKeys, [id]) : s.loadedKeys
          return { missions, earnings, loadedKeys }
        }),
      markContractDelivered: (contractId, done) =>
        set((s) => {
          const legs = s.missions.filter((m) => m.contractId === contractId)
          if (!legs.length) return {}
          const missions = s.missions.map((m) => (m.contractId === contractId ? { ...m, done } : m))
          let earnings = s.earnings
          if (done) {
            // One contract = one ledger entry: sum the legs' rewards (the reward sits on the
            // first leg, so this equals the single contract reward), keyed by contractId.
            if (!earnings.some((e) => e.missionId === contractId)) {
              const reward = legs.reduce((sum, m) => sum + (m.reward ?? 0), 0)
              const commodities = [...new Set(legs.map((m) => m.commodity))]
              earnings = [
                ...earnings,
                {
                  id: nanoid(8),
                  missionId: contractId,
                  reward,
                  commodity: commodities.length === 1 ? commodities[0] : 'Mixed',
                  destination: legs.length > 1 ? `${legs.length} stops` : legs[0]?.destination || 'Delivered',
                  ts: Date.now(),
                },
              ]
            }
          } else {
            earnings = earnings.filter((e) => e.missionId !== contractId)
          }
          const loadedKeys = done ? pruneLoaded(s.loadedKeys, legs.map((m) => m.id)) : s.loadedKeys
          return { missions, earnings, loadedKeys }
        }),
      removeMission: (id) =>
        set((s) => ({
          missions: s.missions.filter((m) => m.id !== id),
          loadedKeys: pruneLoaded(s.loadedKeys, [id]),
        })),
      setDropped: (ids, dropped) =>
        set((s) => ({
          missions: s.missions.map((m) => (ids.includes(m.id) ? { ...m, dropped } : m)),
        })),
      removeContract: (contractId) =>
        set((s) => ({
          missions: s.missions.filter((m) => m.contractId !== contractId),
          loadedKeys: pruneLoaded(
            s.loadedKeys,
            s.missions.filter((m) => m.contractId === contractId).map((m) => m.id),
          ),
        })),
      clearMissions: () => set({ missions: [], loadedKeys: [], routeResult: null }),
      clearEarnings: () => set({ earnings: [] }),
      updateEarning: (id, reward) =>
        set((s) => ({
          earnings: s.earnings.map((e) => (e.id === id ? { ...e, reward } : e)),
        })),

      setLoadedKey: (key, value) =>
        set((s) => {
          const has = s.loadedKeys.includes(key)
          if (value === has) return {}
          return {
            loadedKeys: value ? [...s.loadedKeys, key] : s.loadedKeys.filter((k) => k !== key),
          }
        }),
      clearLoadedKeys: () => set({ loadedKeys: [] }),

      addPendingImports: (cards) =>
        set((s) => ({ pendingImports: [...cards, ...s.pendingImports] })),
      updatePendingImport: (id, patch) =>
        set((s) => ({
          pendingImports: s.pendingImports.map((c) => (c._id === id ? { ...c, ...patch } : c)),
        })),
      removePendingImport: (id) =>
        set((s) => ({ pendingImports: s.pendingImports.filter((c) => c._id !== id) })),
      clearPendingImports: () => set({ pendingImports: [] }),

      saveTemplate: (contract) =>
        set((s) => ({
          missionTemplates: upsertTemplate(s.missionTemplates, buildTemplate(contract), () => nanoid(8), Date.now()),
        })),
      saveMissionTemplate: (legs) =>
        set((s) => ({
          missionTemplates: upsertTemplate(
            s.missionTemplates,
            buildTemplateFromMissions(legs),
            () => nanoid(8),
            Date.now(),
          ),
        })),
      deleteTemplate: (id) =>
        set((s) => ({ missionTemplates: s.missionTemplates.filter((t) => t.id !== id) })),

      setContainerSizes: (sizes) => set({ containerSizes: sizes }),

      moveContainer: (shipId, key, pos) =>
        set((s) => ({
          manualLayout: {
            ...s.manualLayout,
            [shipId]: { ...s.manualLayout[shipId], [key]: pos },
          },
        })),
      clearShipLayout: (shipId) =>
        set((s) => {
          const next = { ...s.manualLayout }
          delete next[shipId]
          return { manualLayout: next }
        }),
      reorderRoute: (orderedDestinations) =>
        set((s) => ({
          missions: s.missions.map((m) => ({
            ...m,
            // orderedDestinations are canonical (from buildRoute / the optimized route), so
            // match each mission by its canonical destination too.
            routeIndex: orderedDestinations.indexOf(canonicalLocation(m.destination)),
          })),
        })),

      setRouteResult: (r) => set({ routeResult: r }),

      setCurrentLocation: (loc) => set({ currentLocation: loc }),
      toggleFavoriteLocation: (loc) =>
        set((s) => ({
          favoriteLocations: s.favoriteLocations.includes(loc)
            ? s.favoriteLocations.filter((f) => f !== loc)
            : [...s.favoriteLocations, loc],
        })),

      setProfile: (patch) =>
        set((s) => {
          const profile = { ...s.profile, ...patch }
          mirrorProfile(profile)
          return { profile }
        }),

      setMaxBox: (n) => set({ maxBox: n }),
      setGroupMode: (m) => set({ groupMode: m }),
      setOcrMode: (m) => set({ ocrMode: m }),
      resetAll: () =>
        set({ ships: SEED_SHIPS, missions: [], selectedShipId: 'gatac-railen', routeResult: null }),
    }),
    {
      name: 'sc-hauling-planner',
      version: 13,
      // Parsed import cards are session-only review state — keep them out of disk
      // storage (they carry base64 thumbnails and shouldn't reappear stale on restart).
      partialize: (state) => {
        const persisted = { ...state }
        delete (persisted as { pendingImports?: unknown }).pendingImports
        return persisted
      },
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as
          | {
              ships?: Ship[]
              missions?: Mission[]
              earnings?: EarningEntry[]
              manualLayout?: AppState['manualLayout']
              containerSizes?: ContainerSize[]
              profile?: Profile
              missionTemplates?: MissionTemplate[]
            }
          | undefined
        if (!state) return persisted as AppState
        // v10: saved mission templates added — make sure the array exists on older states.
        if (!Array.isArray(state.missionTemplates)) state.missionTemplates = []
        // v11: legKey dropped SCU, so stored template signatures are stale — recompute them
        // from each template's own fields (keeps existing saved layouts matching new imports).
        if (version < 11) {
          state.missionTemplates = state.missionTemplates.map((t) => ({
            ...t,
            signature: contractSignature({ contractedBy: t.contractedBy, pickup: t.pickup, legs: t.legs }),
          }))
        }
        // v7: pilot profile added. v8: + tag/holoEffect. v9: + ownShips. Merge so older
        // profiles get defaults for any fields they're missing.
        state.profile =
          state.profile && typeof state.profile === 'object'
            ? { ...EMPTY_PROFILE, ...state.profile }
            : EMPTY_PROFILE
        if (!state.manualLayout || typeof state.manualLayout !== 'object') state.manualLayout = {}
        if (!Array.isArray(state.containerSizes) || state.containerSizes.length === 0)
          state.containerSizes = DEFAULT_CONTAINER_SIZES
        // Merge any new seed ships (e.g. the Argo MOTH) into the user's saved fleet
        // without wiping their own ships, edits, or missions (idempotent).
        if (Array.isArray(state.ships)) {
          const ids = new Set(state.ships.map((s) => s.id))
          for (const seed of SEED_SHIPS) {
            if (!ids.has(seed.id)) state.ships.push(seed)
          }
        }
        // v13: Drake Clipper dropped (not a hauler); Gatac Railen promoted from a reference
        // hull to an owned ship; the MOTH's right rack was mistakenly anchored to the left
        // wall. Patch persisted fleets so existing installs match the corrected seed.
        if (version < 13 && Array.isArray(state.ships)) {
          state.ships = state.ships.filter((s) => s.id !== 'drake-clipper')
          const railen = state.ships.find((s) => s.id === 'gatac-railen')
          if (railen) railen.builtin = false
          const moth = state.ships.find((s) => s.id === 'argo-moth')
          const rightRack = moth?.bays?.find((b) => b.id === 'right')
          if (rightRack && !rightRack.baseFace && rightRack.side !== 'right') rightRack.side = 'right'
          const leftRack = moth?.bays?.find((b) => b.id === 'left')
          if (leftRack && !leftRack.baseFace && !leftRack.side) leftRack.side = 'left'
        }
        // If the selected ship no longer exists (e.g. Clipper removed), fall back sanely.
        {
          const s = state as { ships?: Ship[]; selectedShipId?: string }
          if (Array.isArray(s.ships) && s.ships.length && !s.ships.some((sh) => sh.id === s.selectedShipId)) {
            s.selectedShipId = s.ships[0].id
          }
        }
        if (!Array.isArray(state.earnings)) state.earnings = []
        // v4: seed the earnings ledger from missions already marked delivered, so the
        // Earnings tab reflects past work. We have no real delivery time for these, so
        // they're stamped "now" — a one-time backfill (gated on the old version).
        if (version < 4 && state.earnings.length === 0 && Array.isArray(state.missions)) {
          const now = Date.now()
          state.earnings = state.missions
            .filter((m) => m.done)
            .map((m) => ({
              id: nanoid(8),
              missionId: m.id,
              reward: m.reward ?? 0,
              commodity: m.commodity,
              destination: m.destination,
              ts: now,
            }))
        }
        return state as AppState
      },
      // Profile safety net: on load, if the store's profile is empty but the side mirror
      // has one, restore it; otherwise keep the mirror fresh. Guards against the profile
      // being wiped by a store reset while localStorage itself is intact.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (isEmptyProfile(state.profile)) {
          try {
            const raw = localStorage.getItem(PROFILE_BACKUP_KEY)
            if (raw) {
              const saved = JSON.parse(raw)
              if (saved && typeof saved === 'object') {
                state.profile = { ...EMPTY_PROFILE, ...saved }
              }
            }
          } catch {
            /* ignore */
          }
        } else {
          mirrorProfile(state.profile)
        }
      },
    },
  ),
)
