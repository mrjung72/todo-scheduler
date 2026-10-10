/* 업로드 진행 상태바 — pct가 null이면 렌더링하지 않음 */
export default function ProgressBar({ pct }) {
  if (pct == null) return null
  return (
    <div className="upbar">
      <div className="upbar-fill" style={{ width: `${pct}%` }} />
      <span className="upbar-text">{pct}%</span>
    </div>
  )
}
