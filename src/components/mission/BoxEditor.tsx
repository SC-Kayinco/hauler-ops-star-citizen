import { useStore } from '@/store/useStore'

/**
 * Tally-style container editor: each SCU size is a button. Click to add one
 * (a count badge shows how many), right-click to remove one, ✕ to reset to
 * auto-split. The total is checked against the mission SCU.
 * `onChange(undefined)` means "back to auto". Sizes come from the editable list.
 */
export default function BoxEditor({
  boxes,
  scu,
  onChange,
}: {
  boxes: number[]
  scu: number
  onChange: (c: number[] | undefined) => void
}) {
  const SIZES = useStore((s) => s.containerSizes)
    .map((c) => c.scu)
    .sort((a, b) => a - b)
  const sum = boxes.reduce((a, b) => a + b, 0)

  const addOne = (s: number) => onChange([...boxes, s])
  const removeOne = (s: number) => {
    const i = boxes.lastIndexOf(s)
    if (i < 0) return
    const next = boxes.slice()
    next.splice(i, 1)
    onChange(next.length ? next : undefined)
  }

  return (
    <div className="box-editor">
      <div className="box-tally">
        {SIZES.map((s) => {
          const c = boxes.filter((b) => b === s).length
          return (
            <button
              key={s}
              className={`tally-btn ${c > 0 ? 'on' : ''}`}
              onClick={() => addOne(s)}
              onContextMenu={(e) => {
                e.preventDefault()
                removeOne(s)
              }}
              title="Click +1 · Right-click −1"
            >
              {s}
              {c > 0 && <span className="tally-count">{c}</span>}
            </button>
          )
        })}
        <button className="tally-reset" onClick={() => onChange(undefined)} title="Reset to auto">
          ✕
        </button>
      </div>
      <div className="box-tally-sum">
        <span className="hud-label">Total</span>
        <span className={`box-sum ${sum === scu ? 'ok' : 'warn'}`}>
          {sum}/{scu} SCU
        </span>
        <span className="muted sm">click a size to add · right-click to remove · ✕ resets to auto</span>
      </div>
    </div>
  )
}
