import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useStore } from '@/store/useStore'
import type { ProfileRole } from '@/types'

/**
 * SC-themed profession presets, Discord-rank style. Bounty Hunter is red (as requested);
 * the rest carry on-theme accents. Typing a custom role that matches one of these by name
 * inherits its color, so "bounty hunter" typed by hand still comes out red.
 */
const ROLE_PRESETS: ProfileRole[] = [
  { label: 'Bounty Hunter', color: '#ff5d6c' },
  { label: 'Hauler', color: '#4db8e8' },
  { label: 'Trader', color: '#f0a830' },
  { label: 'Miner', color: '#e0a64c' },
  { label: 'Mercenary', color: '#ff8c42' },
  { label: 'Explorer', color: '#60a5fa' },
  { label: 'Medic', color: '#4ce0a0' },
  { label: 'Salvager', color: '#7fe3ff' },
  { label: 'Pirate', color: '#a78bfa' },
  { label: 'Smuggler', color: '#b06ae0' },
]
/** Colors cycled for custom roles that don't match a preset. */
const CUSTOM_PALETTE = ['#4db8e8', '#f0a830', '#4ce0a0', '#a78bfa', '#ff8c42', '#7fe3ff']

/** Read an image file, downscale it (keeps aspect) and return a compact JPEG data URL so
 *  it fits comfortably in localStorage rather than storing the multi-MB original. */
function downscaleImage(file: File, max = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no 2d context'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Avatar with an optional holographic, mouse-follow 3D-tilt effect (like a foil trading card). */
function HoloCard({
  enabled,
  onClick,
  children,
}: {
  enabled: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})

  const onMove = (e: React.MouseEvent) => {
    if (!enabled || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    setStyle({
      transform: `perspective(700px) rotateX(${(0.5 - py) * 16}deg) rotateY(${(px - 0.5) * 16}deg) scale(1.03)`,
      '--mx': `${px * 100}%`,
      '--my': `${py * 100}%`,
    } as CSSProperties)
  }

  return (
    <div
      ref={ref}
      className={`holo-card ${enabled ? 'on' : ''}`}
      style={style}
      onMouseMove={onMove}
      onMouseLeave={() => setStyle({})}
      onClick={onClick}
    >
      {children}
      {enabled && <span className="holo-sheen" />}
    </div>
  )
}

/** aUEC with thousands separators (full number, not the compact nav form). */
const fmtFull = (n: number) => `${Math.round(n).toLocaleString('en-US')} aUEC`

/**
 * Persistent pilot profile, pinned to the left of every tab. Read-only display here; the
 * pencil opens a modal where everything is edited (photo, name, handle, bio, professions,
 * holographic effect). Wallet total and completed-haul count are derived from the earnings
 * ledger and update as deliveries are logged.
 */
export default function ProfileSidebar() {
  const profile = useStore((s) => s.profile)
  const earnings = useStore((s) => s.earnings)
  const [editing, setEditing] = useState(false)

  const wallet = earnings.reduce((a, e) => a + (e.reward || 0), 0)
  const hauls = earnings.length

  return (
    <aside className="app-sidebar">
      <div className="profile-card panel">
        <div className="profile-card-head">
          <span className="hud-label">Pilot Profile</span>
          <button
            className="icon-btn profile-edit-btn"
            title="Edit profile"
            onClick={() => setEditing(true)}
          >
            ✎
          </button>
        </div>

        <HoloCard enabled={profile.holoEffect} onClick={() => setEditing(true)}>
          <div className="profile-avatar">
            {profile.avatar ? (
              <img src={profile.avatar} alt="Profile" />
            ) : (
              <>
                <img src="default-avatar.svg" alt="Default pilot avatar" />
                <span className="profile-avatar-hint hud-label">＋ Add photo</span>
              </>
            )}
          </div>
        </HoloCard>

        <div className="profile-name profile-name--view">{profile.handle || 'Unnamed Pilot'}</div>
        {profile.tag && <div className="profile-tag">{profile.tag}</div>}

        {profile.roles.length > 0 && (
          <div className="profile-roles">
            {profile.roles.map((r) => (
              <span
                key={r.label}
                className="role-tag"
                style={{ borderColor: r.color + 'aa', color: r.color, background: r.color + '1f' }}
              >
                <span className="role-dot" style={{ background: r.color }} />
                {r.label}
              </span>
            ))}
          </div>
        )}

        <div className="profile-stats">
          <div className="profile-stat">
            <span className="hud-label">Wallet</span>
            <span className="profile-stat-val good">{fmtFull(wallet)}</span>
          </div>
          <div className="profile-stat">
            <span className="hud-label">Hauls Done</span>
            <span className="profile-stat-val">{hauls}</span>
          </div>
        </div>

        {profile.bio && (
          <div className="profile-bio-block">
            <span className="hud-label">Bio</span>
            <p className="profile-bio-view">{profile.bio}</p>
          </div>
        )}

        <div className="profile-ships">
          <span className="hud-label">Own Ships</span>
          {(profile.ownShips ?? []).length === 0 ? (
            <span className="muted sm">None added yet</span>
          ) : (
            <div className="profile-ship-list">
              {(profile.ownShips ?? []).map((name) => (
                <span key={name} className="profile-ship">
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && <ProfileEditModal onClose={() => setEditing(false)} />}
    </aside>
  )
}

/** Modal where the whole profile is edited; changes save live to the store. */
function ProfileEditModal({ onClose }: { onClose: () => void }) {
  const profile = useStore((s) => s.profile)
  const setProfile = useStore((s) => s.setProfile)
  const ships = useStore((s) => s.ships)
  const fileRef = useRef<HTMLInputElement>(null)
  const [custom, setCustom] = useState('')
  const [shipInput, setShipInput] = useState('')

  const ownShips = profile.ownShips ?? []
  const addShip = (name: string) => {
    const n = name.trim()
    if (!n || ownShips.some((s) => s.toLowerCase() === n.toLowerCase())) {
      setShipInput('')
      return
    }
    setProfile({ ownShips: [...ownShips, n] })
    setShipInput('')
  }
  const removeShip = (name: string) =>
    setProfile({ ownShips: ownShips.filter((s) => s !== name) })
  // Fleet ship names not already added — offered in the datalist for quick picking.
  const shipSuggestions = [...new Set(ships.map((s) => s.name))].filter(
    (n) => !ownShips.some((o) => o.toLowerCase() === n.toLowerCase()),
  )

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setProfile({ avatar: await downscaleImage(file) })
    } catch {
      /* ignore unreadable images */
    } finally {
      e.target.value = ''
    }
  }

  const hasRole = (label: string) =>
    profile.roles.some((r) => r.label.toLowerCase() === label.toLowerCase())
  const addRole = (role: ProfileRole) => {
    if (hasRole(role.label)) return
    setProfile({ roles: [...profile.roles, role] })
  }
  const removeRole = (label: string) =>
    setProfile({ roles: profile.roles.filter((r) => r.label !== label) })
  const addCustom = () => {
    const label = custom.trim()
    if (!label || hasRole(label)) {
      setCustom('')
      return
    }
    const preset = ROLE_PRESETS.find((p) => p.label.toLowerCase() === label.toLowerCase())
    const color = preset?.color ?? CUSTOM_PALETTE[profile.roles.length % CUSTOM_PALETTE.length]
    addRole({ label, color })
    setCustom('')
  }

  return (
    <div className="profile-modal" onClick={onClose}>
      <div className="profile-modal-card panel" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-head">
          <h3 className="section-label">Edit Profile</h3>
          <button className="icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="profile-modal-photo">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
          <button
            className="profile-avatar profile-avatar--edit"
            onClick={() => fileRef.current?.click()}
            title={profile.avatar ? 'Change photo' : 'Add a photo'}
          >
            {profile.avatar ? (
              <img src={profile.avatar} alt="Profile" />
            ) : (
              <span className="profile-avatar-ph">
                <span className="profile-avatar-plus">＋</span>
              </span>
            )}
          </button>
          <div className="profile-photo-actions">
            <button className="btn btn--sm" onClick={() => fileRef.current?.click()}>
              {profile.avatar ? 'Change photo' : 'Add photo'}
            </button>
            {profile.avatar && (
              <button className="btn btn--sm btn--danger" onClick={() => setProfile({ avatar: '' })}>
                Remove
              </button>
            )}
          </div>
        </div>

        <label className="field">
          <span className="hud-label">Display name</span>
          <input
            value={profile.handle}
            placeholder="Character name"
            onChange={(e) => setProfile({ handle: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="hud-label">In-game handle</span>
          <input
            value={profile.tag}
            placeholder="@deathburger"
            onChange={(e) => setProfile({ tag: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="hud-label">Bio</span>
          <textarea
            className="profile-bio-edit"
            value={profile.bio}
            placeholder="Write your pilot bio…"
            onChange={(e) => setProfile({ bio: e.target.value })}
          />
        </label>

        <div className="field">
          <span className="hud-label">Professions</span>
          {profile.roles.length > 0 && (
            <div className="profile-roles">
              {profile.roles.map((r) => (
                <span
                  key={r.label}
                  className="role-tag"
                  style={{ borderColor: r.color + 'aa', color: r.color, background: r.color + '1f' }}
                >
                  <span className="role-dot" style={{ background: r.color }} />
                  {r.label}
                  <button className="role-remove" title="Remove" onClick={() => removeRole(r.label)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="role-presets">
            {ROLE_PRESETS.filter((p) => !hasRole(p.label)).map((p) => (
              <button
                key={p.label}
                className="role-chip"
                style={{ borderColor: p.color + '88', color: p.color }}
                onClick={() => addRole(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="role-custom">
            <input
              value={custom}
              placeholder="Custom profession…"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCustom()
              }}
            />
            <button className="btn btn--sm" onClick={addCustom}>
              Add
            </button>
          </div>
        </div>

        <div className="field">
          <span className="hud-label">Own ships</span>
          {ownShips.length > 0 && (
            <div className="profile-ship-list">
              {ownShips.map((name) => (
                <span key={name} className="profile-ship profile-ship--edit">
                  {name}
                  <button className="role-remove" title="Remove" onClick={() => removeShip(name)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="role-custom">
            <input
              list="profile-ship-options"
              value={shipInput}
              placeholder="Ship name…"
              onChange={(e) => setShipInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addShip(shipInput)
              }}
            />
            <datalist id="profile-ship-options">
              {shipSuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button className="btn btn--sm" onClick={() => addShip(shipInput)}>
              Add
            </button>
          </div>
        </div>

        <label className="profile-toggle">
          <input
            type="checkbox"
            checked={profile.holoEffect}
            onChange={(e) => setProfile({ holoEffect: e.target.checked })}
          />
          <span>Holographic photo effect (3D tilt on hover)</span>
        </label>

        <button className="btn btn--primary profile-modal-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
