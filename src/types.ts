// ---------- Core domain types for the hauling planner ----------

/** Default cargo container sizes (SCU). The player can edit footprints / add sizes (e.g. 64). */
export const SCU_SIZES = [1, 2, 4, 8, 16, 24, 32] as const
/** A container's SCU amount. Kept as `number` so custom sizes (64, …) are allowed. */
export type ScuSize = number

/**
 * A container's footprint measured in 1-SCU grid cells.
 * w = width (X, across the bay), l = length (Z, toward the door),
 * h = stack height (Y). 1 SCU == 1x1x1.
 */
export interface Footprint {
  w: number
  l: number
  h: number
}

/** Which edge of a bay the loading ramp / door is on. Used for LIFO unload order. */
export type DoorEdge = 'front' | 'back' | 'left' | 'right'

/** How a bay is physically mounted — informational, helps model real ships. */
export type BayMount = 'floor' | 'wall' | 'external'

/**
 * The surface a bay's containers attach to. Cargo builds OUTWARD from this face
 * (the bay's stack/height axis points away from it), so e.g. a wing rack's
 * cargo extends sideways out of the hull instead of stacking vertically.
 * `bottom` = a normal floor hold (stacks up). Default when unset.
 */
export type BayBaseFace = 'bottom' | 'top' | 'left' | 'right' | 'front' | 'back'

/**
 * Which in-plane direction cargo fills/anchors from on the base surface. Mirrors the bay grid's
 * width (W) and/or length (L) axis so a rack can attach where it really does on the hull — e.g.
 * the Gatac Railen's wall racks hang from the CEILING down (flip the width/vertical axis).
 * 'default' = fill from the W/L origin corner; 'flipW'/'flipL'/'flipWL' mirror those axes.
 */
export type BayFill = 'default' | 'flipW' | 'flipL' | 'flipWL'

/** A single cargo bay / grid inside a ship. */
export interface CargoBay {
  id: string
  name: string
  /** Floor width in SCU cells (X). */
  width: number
  /** Floor length/depth in SCU cells (Z), measured away from the door. */
  length: number
  /** How many SCU you can stack vertically (Y). */
  maxStackHeight: number
  /** Which edge the ramp/door is on — items near it are unloaded first. */
  doorEdge: DoorEdge
  /** Cells that are unusable (pillars, equipment). Keys are "x,z". */
  blockedCells: string[]
  /** Largest container (SCU) that physically fits through this bay's door. */
  maxContainerScu?: number
  /** How this bay is mounted (floor grid, side wall rack, external rack). Informational. */
  mount?: BayMount
  /** For wall/external racks: which side of the hull it sits on in the 3D view. */
  side?: 'left' | 'right'
  /**
   * The surface containers attach to. Cargo builds outward from it (the height axis
   * points away from this face). Defaults to `bottom` (floor hold) when unset; older
   * wall/external bays fall back to their `side`. See `resolveBaseFace`.
   */
  baseFace?: BayBaseFace
  /** In-plane fill/anchor direction on the base surface (mirrors W/L axes). Defaults to 'default'. */
  fill?: BayFill
}

export type ShipSizeCategory = 'Small' | 'Medium' | 'Large' | 'Capital'

/** A label/value pair shown in the RSI-style technical specs panel. */
export interface SpecLine {
  label: string
  value: string
}

/** A ship the player owns / can use for hauling. Fully editable. */
export interface Ship {
  id: string
  name: string
  manufacturer: string
  /** Total advertised cargo capacity in SCU. */
  cargoScu: number
  sizeCategory: ShipSizeCategory
  crew: number
  lengthM: number
  beamM: number
  heightM: number
  speedMs?: number
  role?: string
  /**
   * Largest container (SCU) that fits through this ship's loading door,
   * regardless of internal grid volume (e.g. the Clipper's narrow rear ramp
   * caps practical loading at ~2 SCU). Applied across all bays.
   */
  maxContainerScu?: number
  /** Path to a .glb/.gltf under /public/models, or undefined to use the procedural hologram. */
  modelUrl?: string
  /** Absolute disk path to a .glb chosen via the desktop file picker (loaded at runtime). */
  modelPath?: string
  /** Accent color for the hologram & cards. */
  accent?: string
  /** Free-form extra spec lines for the technical panel. */
  specs: SpecLine[]
  /** The cargo bays / grids that make up this ship's hold. */
  bays: CargoBay[]
  /** True for the seeded reference ships (read-only suggestion until cloned). */
  builtin?: boolean
}

export type CommodityCategory =
  | 'Metal'
  | 'Mineral'
  | 'Medical'
  | 'Agricultural'
  | 'Food'
  | 'Waste'
  | 'Halogen'
  | 'Gas'
  | 'Fuel'
  | 'Vice'
  | 'Munitions'
  | 'Industrial'
  | 'Other'

export interface Commodity {
  name: string
  category: CommodityCategory
}

/**
 * A hauling mission the player accepted. Cargo is picked up at `origin`
 * and delivered to `destination`. Multiple missions are planned together.
 */
export interface Mission {
  id: string
  /** Optional short label, e.g. "Covalex #3". */
  title?: string
  /**
   * Groups the delivery legs of ONE imported contract. All legs of a contract share this id
   * so the Missions list shows them as a single card and they're delivered/removed together.
   * Manually-added missions have no contractId (they stand alone).
   */
  contractId?: string
  origin: string
  /**
   * ALL collection points when the contract picks up from several stations
   * (e.g. "collect Waste from CRU-L1 AND CRU-L4"). `origin` stays the primary;
   * the route optimizer visits every entry here before the deliveries.
   */
  pickups?: string[]
  /**
   * The player's answer to "where will you collect this?" for a multi-pickup mission:
   * - a station NAME → collect the whole leg there (the other listed stations are dropped
   *   from the route if no other leg needs them);
   * - `PICKUP_SPLIT` → split across stations; amounts live in `pickupSplit`;
   * - undefined → not chosen yet (route counts the leg ONCE at its earliest pickup, all
   *   stations stay on the route).
   */
  pickupChoice?: string
  /**
   * When `pickupChoice === PICKUP_SPLIT`: how much SCU you actually collect at each station,
   * keyed by station name. The game distributes the total and only reveals the split on
   * arrival, so the player fills this in. Stations not present default to 0.
   */
  pickupSplit?: Record<string, number>
  destination: string
  commodity: string
  /** Total SCU to move for this mission. */
  scu: number
  /**
   * The container size (SCU) this contract provides, e.g. Covalex hands you
   * 1-SCU crates, Red Wind up to 4-SCU. Used to auto-split the load into boxes.
   * Falls back to the global max-box setting when unset.
   */
  containerScu?: number
  /**
   * The EXACT containers you actually received (seen when pulling them from the
   * freight elevator). When set, this overrides auto-splitting — e.g. [4, 2].
   */
  containers?: number[]
  reward?: number
  /** Delivery sequence position (0 = first stop). Lower is delivered earlier. */
  routeIndex?: number
  done?: boolean
  /**
   * Run-time "I've dropped this stop's cargo" marker, toggled from the Plan route/delivery
   * lists. Unlike `done` it does NOT log earnings or move to History (a contract pays only
   * once ALL its stops are delivered) — it just removes this leg's cargo from the 3D hold so
   * delivered boxes stop cluttering the view. The stop stays shown (greyed) and is reversible.
   */
  dropped?: boolean
  /** Small JPEG preview of the source screenshot (carried over from a screenshot import). */
  thumb?: string
  /** Full-res capture path for the lightbox (imported missions only). */
  capturePath?: string
  /**
   * Signature of the source contract (see `contractSignature`) — stamped when this mission is
   * added from an import. Lets later edits to `pickupSplit`/`pickupChoice` be learned back into
   * the matching saved template, so a re-import of the same contract recalls them too.
   */
  templateSig?: string
}

/** One physical container in a load plan. */
export interface PlacedContainer {
  id: string
  /** Stable id across re-optimization (`missionId:boxIndex`) — used for manual-move overrides. */
  key: string
  missionId: string
  destination: string
  commodity: string
  scu: ScuSize
  footprint: Footprint
  /** Bottom-left-floor cell in the bay. */
  x: number
  z: number
  /** Stack layer (0 = floor). */
  y: number
  bayId: string
  /** Where this box is collected (its mission's primary pickup) — shown in the loading sequence. */
  origin?: string
  /** Every station this box may be collected at (origin + the mission's extra pickups). */
  pickupStations?: string[]
  /** Acquisition order along the pickup route (0 = already aboard at the start). Drives the
   *  floor-up, collect-as-you-go load order so the plan is physically buildable. */
  pickupRank?: number
  /** 0-based order in which this container should be UNLOADED. */
  unloadOrder: number
  /** 0-based order in which this container should be LOADED (reverse of unload). */
  loadOrder: number
  color: string
  /** True once its mission is marked delivered — removed from the hold, others stay put. */
  delivered: boolean
  /** Manually parked on the cargo-area floor (outside any bay). fx/fz = world ground position. */
  floored?: boolean
  fx?: number
  fz?: number
}

/** Result of running the optimizer. */
export interface LoadPlan {
  shipId: string
  placed: PlacedContainer[]
  /** Containers that did not fit. */
  unplaced: { missionId: string; commodity: string; scu: ScuSize; destination: string }[]
  totalScu: number
  usedScu: number
  /** Route order of destinations (first delivered -> last). */
  route: string[]
  warnings: string[]
}

/** A mission parsed from a screenshot by Claude vision, before the user confirms it. */
export interface ParsedMission {
  commodity: string
  scu: number
  containerScu?: number | null
  pickup: string
  /** Every collection point found for this objective (multi-pickup contracts). */
  pickups?: string[]
  dropoff: string
  reward?: number | null
  contractedBy?: string | null
}

/** One delivery leg within an imported contract (commodity + amount + drop-off). */
export interface ImportLeg {
  commodity: string
  scu: number
  containerScu?: number | null
  dropoff: string
  containers?: number[]
  /**
   * Where THIS leg's commodity is collected. Per-leg (not contract-wide) because one
   * contract can collect different commodities from different stations (e.g. Stims from
   * ArcCorp, Souvenirs from Vivere) — sharing the union across all legs would tell you to
   * pick every commodity up at every station. First entry is the primary origin; >1 means
   * this single commodity is split across stations.
   */
  pickups?: string[]
  /**
   * Recalled pickup-amount split (station → SCU) from a saved template. Not entered in the
   * import card itself; carried over when a re-imported contract matches a saved template so
   * the created mission gets its `pickupChoice`/`pickupSplit` pre-filled.
   */
  pickupSplit?: Record<string, number>
}

/**
 * A parsed CONTRACT awaiting review — one screenshot = one contract with one or more delivery
 * legs (e.g. Stims 4→A, Stims 5→B, Stims 3→C) sharing ONE pickup and ONE reward. Held in the
 * store so it survives navigating away. Transient — excluded from localStorage persistence.
 */
export interface ImportContract {
  _id: string
  pickup: string
  /** All collection points across the contract's legs (multi-pickup contracts). */
  pickups?: string[]
  /** The single contract reward (not per leg). */
  reward?: number | null
  contractedBy?: string | null
  /** Small JPEG preview of the source screenshot. */
  _thumb?: string
  /** Full-res capture path, re-read for the lightbox. */
  _capPath?: string
  _capName?: string
  /** User-toggled "I've reviewed/verified this contract" marker (green highlight). */
  checked?: boolean
  /** True when a saved template was auto-applied to this card on import (drives the recall badge). */
  _recalled?: boolean
  legs: ImportLeg[]
}

/** One delivery leg's saved layout within a {@link MissionTemplate}. */
export interface MissionTemplateLeg {
  commodity: string
  dropoff: string
  scu: number
  /** Container size the contract provides (drives auto-split). */
  containerScu?: number | null
  /** The exact box breakdown the player saw on arrival (e.g. [16,16] or [4,4,2]). */
  containers?: number[]
  /** Collection station(s) for this leg. */
  pickups?: string[]
  /** Learned pickup-amount split (station → SCU), filled in later from the Missions page. */
  pickupSplit?: Record<string, number>
}

/**
 * A reusable mission "memory": the box splits + pickup layout the player worked out for a
 * recurring contract, keyed by a content `signature` (who issued it + pickup station(s) +
 * the set of commodity/destination/SCU legs). When a later screenshot import produces the
 * same signature, the saved layout is recalled and applied automatically.
 */
export interface MissionTemplate {
  id: string
  /** Human label for the saved list, e.g. "Red Wind — 168 SCU → Chawla's Beach". */
  name: string
  /** Exact-match fingerprint (see `contractSignature`). */
  signature: string
  contractedBy?: string | null
  pickup?: string
  reward?: number | null
  legs: MissionTemplateLeg[]
  /** Epoch ms when saved / last updated. */
  savedAt: number
}

/**
 * One logged delivery — written when a mission is marked delivered (✓) and removed
 * when un-delivered (↺). Persisted SEPARATELY from missions (snapshots its own
 * commodity/destination/reward) so the earnings ledger survives clearing or removing
 * the mission cards — it's a permanent income record across hauling runs.
 */
export interface EarningEntry {
  id: string
  missionId: string
  /** aUEC earned for this delivery (0 if the mission had no reward set). */
  reward: number
  commodity: string
  destination: string
  /** Epoch ms when the mission was marked delivered. */
  ts: number
}

/** A profession/role tag shown on the profile, Discord-rank style (colored chip). */
export interface ProfileRole {
  label: string
  /** Hex color for the chip (e.g. Bounty Hunter = red). */
  color: string
}

/** The player's pilot profile — shown in the persistent sidebar across all tabs. */
export interface Profile {
  /** Character display name (e.g. "Vance Drift Kovac"). */
  handle: string
  /** In-game handle / callsign (e.g. "@deathburger"). */
  tag: string
  /** Free-form biography. */
  bio: string
  /** Avatar image as a (downscaled) data URL, or '' for the placeholder. */
  avatar: string
  /** Profession tags (Bounty Hunter, Hauler, …). */
  roles: ProfileRole[]
  /** Names of ships the player owns, shown under the bio. Hand-managed in the edit modal. */
  ownShips: string[]
  /** Whether the avatar uses the holographic mouse-follow 3D-tilt effect. */
  holoEffect: boolean
}

/** App navigation views. */
export type View = 'fleet' | 'ship' | 'missions' | 'plan' | 'earnings' | 'starmap' | 'settings'

/**
 * How containers are arranged in the hold:
 * - 'destination': each stop's cargo is one contiguous island (easiest unload, LIFO).
 * - 'commodity': each commodity type is its own island (e.g. all titanium together).
 */
export type GroupMode = 'destination' | 'commodity'

/**
 * How mission screenshots are read by OCR:
 * - 'auto': detect the screenshot's aspect ratio — crop the objectives column on ~16:9,
 *   fall back to whole-image OCR on other ratios (ultrawide / 16:10 / 32:9).
 * - 'crop': always crop the objectives column (best on 16:9).
 * - 'full': always read the whole screenshot (most compatible, slightly less precise).
 */
export type OcrMode = 'auto' | 'crop' | 'full'
