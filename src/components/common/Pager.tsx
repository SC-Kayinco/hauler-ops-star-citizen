/** Compact pager: ⏮ ‹ page/total › ⏭. Renders nothing when there's only one page. */
export default function Pager({
  page,
  pages,
  onPage,
}: {
  page: number
  pages: number
  onPage: (p: number) => void
}) {
  if (pages <= 1) return null
  return (
    <div className="pager">
      <button className="pager-btn" onClick={() => onPage(0)} disabled={page === 0} title="First">
        ⏮
      </button>
      <button className="pager-btn" onClick={() => onPage(page - 1)} disabled={page === 0} title="Previous">
        ‹
      </button>
      <span className="pager-info">
        {page + 1} / {pages}
      </span>
      <button
        className="pager-btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        title="Next"
      >
        ›
      </button>
      <button
        className="pager-btn"
        onClick={() => onPage(pages - 1)}
        disabled={page >= pages - 1}
        title="Last"
      >
        ⏭
      </button>
    </div>
  )
}
