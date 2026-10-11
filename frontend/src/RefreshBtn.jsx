import { useState } from 'react'

// 데이터 새로고침 버튼: 클릭하면 아이콘 회전 + '갱신 중…' 표시
// 즉시 끝나도 체감되도록 최소 표시 시간(0.5초)을 둔다.
export default function RefreshBtn({ onClick }) {
  const [busy, setBusy] = useState(false)
  const click = async () => {
    if (busy) return
    setBusy(true)
    const t0 = Date.now()
    try { await onClick?.() } catch {}
    const wait = Math.max(0, 500 - (Date.now() - t0))
    setTimeout(() => setBusy(false), wait)
  }
  return (
    <button type="button" className={`refresh-btn${busy ? ' busy' : ''}`}
      onClick={click} disabled={busy}>
      <span className="rf-ico">⟳</span> {busy ? '갱신 중…' : '새로고침'}
    </button>
  )
}
