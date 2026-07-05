import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { DEFAULT_CONTAINER_SIZES } from '@/data/containers'

const clampInt = (v: string | number) => Math.max(1, Math.round(Number(v) || 1))

/**
 * Global editor for cargo container sizes (footprints). The player tweaks W×L×H per SCU size
 * and can add new sizes (e.g. 64) as they encounter them in-game. Used by the planner, the 3D
 * hold, and auto-split (via the store's `containerSizes`).
 */
export default function ContainerSizesEditor() {
  const sizes = useStore((s) => s.containerSizes)
  const setSizes = useStore((s) => s.setContainerSizes)
  const [open, setOpen] = useState(false)

  const update = (i: number, patch: Partial<{ scu: number; w: number; l: number; h: number }>) =>
    setSizes(sizes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const remove = (i: number) => setSizes(sizes.filter((_, idx) => idx !== i))
  const add = () => {
    const maxScu = sizes.reduce((m, s) => Math.max(m, s.scu), 0)
    setSizes([...sizes, { scu: maxScu ? maxScu * 2 : 1, w: 2, l: 8, h: 2 }])
  }
  const reset = () => {
    if (window.confirm('Reset all container sizes to the defaults?')) setSizes(DEFAULT_CONTAINER_SIZES)
  }

  return (
    <section className="grid-editor csize-editor">
      <div className="grid-editor-head">
        <div>
          <h3 className="section-label">Container Sizes</h3>
          <p className="muted sm">
            Edit each cargo box's footprint — Width × Length × Height in SCU cells (1 cell = 1 SCU).
            Add a size (e.g. <strong>64</strong>) as you meet it in-game. Used by the planner, the 3D
            hold, and auto-split.
          </p>
        </div>
        <button className="btn btn--sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Edit'}
        </button>
      </div>

      {open && (
        <div className="csize-list">
          <div className="csize-row csize-head">
            <span>SCU</span>
            <span>Width</span>
            <span>Length</span>
            <span>Height ↑</span>
            <span>= cells</span>
            <span />
          </div>
          {sizes.map((s, i) => (
            <div className="csize-row" key={i}>
              <input type="number" min={1} value={s.scu} onChange={(e) => update(i, { scu: clampInt(e.target.value) })} />
              <input type="number" min={1} value={s.w} onChange={(e) => update(i, { w: clampInt(e.target.value) })} />
              <input type="number" min={1} value={s.l} onChange={(e) => update(i, { l: clampInt(e.target.value) })} />
              <input type="number" min={1} value={s.h} onChange={(e) => update(i, { h: clampInt(e.target.value) })} />
              <span className={`csize-vol ${s.w * s.l * s.h === s.scu ? 'ok' : 'warn'}`}>
                {s.w * s.l * s.h}
              </span>
              <button className="btn btn--sm btn--danger" onClick={() => remove(i)} title="Remove size">
                ✕
              </button>
            </div>
          ))}
          <div className="csize-actions">
            <button className="btn btn--sm" onClick={add}>
              + Add Size
            </button>
            <button className="btn btn--sm" onClick={reset}>
              Reset to defaults
            </button>
          </div>
          <p className="muted sm">
            Footprint cells should total the SCU (e.g. 32 = 2×8×2). A mismatch (amber) is allowed but
            the 3D box volume won't match its SCU label.
          </p>
        </div>
      )}
    </section>
  )
}
