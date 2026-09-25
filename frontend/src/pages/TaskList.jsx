import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, taskColor } from '../api'

export default function TaskList() {
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  // 사이트 기본값 = 로그인 사용자의 기본사이트(default_siteid)
  const [siteFilter, setSiteFilter] = useState(() =>
    JSON.parse(localStorage.getItem('user') || 'null')?.default_siteid || '')
  const [q, setQ] = useState('')
  const [statFilter, setStatFilter] = useState('')
  const [cfg, setCfg] = useState(null)

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (statFilter) params.task_stat = statFilter
    if (siteFilter) params.siteid = siteFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, statFilter, siteFilter])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data))
    api.get('/sites').then(r => setSites(r.data))
  }, [])

  // 현재 조회 결과를 CSV(BOM 포함, 엑셀에서 바로 열림)로 다운로드
  const downloadCsv = () => {
    const esc = v => `"${String(v ?? '').replaceAll('"', '""')}"`
    const header = ['사이트', '우선순위', 'CSR번호', '작업명', '예상 작업시간(Hour)',
      '현업담당자', 'IT담당자', '작업자', '시작일시', '종료일시(예상)', '상태']
    const lines = tasks.map(t => [
      t.site_name || t.siteid || '', t.priority, t.task_csrid || '', t.task_name,
      t.work_hours_estimated, t.req_user_name || t.req_userid || '',
      t.itos_user_name || t.itos_userid || '',
      t.work_user_name || t.work_userid || '',
      fmtDT(t.start_datetime), fmtDT(t.end_datetime_estimated),
      STAT_LABEL[t.task_stat] || t.task_stat,
    ].map(esc).join(','))
    const csv = '\uFEFF' + [header.map(esc).join(','), ...lines].join('\r\n')
    const now = new Date()
    const p2 = n => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
      `_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
    const conds = [
      siteFilter &&
        (sites.find(s => s.siteid === siteFilter)?.site_name || siteFilter),
      q.trim(),
      statFilter && (STAT_LABEL[statFilter] || statFilter),
    ].filter(Boolean).join('_')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `작업목록${conds ? `_${conds}` : ''}_${stamp}.csv`
      .replace(/[\\/:*?"<>|]/g, '_')
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <div className="toolbar">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <input
          placeholder="검색어 (작업명/담당자명 또는 ID)"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <select value={statFilter} onChange={e => setStatFilter(e.target.value)}>
          <option value="">상태(전체)</option>
          {Object.entries(STAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load}>검색</button>
        <button className="excel" onClick={downloadCsv} disabled={!tasks.length}>엑셀 다운로드</button>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>사이트</th><th className="fit">우선<br/>순위</th><th className="csr-col">CSR번호</th><th>작업명</th><th className="fit">예상 작업<br/>시간(Hour)</th>
            <th>현업담당자</th><th>IT담당자</th><th>작업자</th>
            <th>시작일시</th><th>종료일시(예상)</th><th>상태</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.taskid} style={{ borderLeft: `6px solid ${taskColor(t.taskid)}` }}>
              <td className="c">{t.site_name || t.siteid}</td>
              <td className="r fit">{t.priority}</td>
              <td className="csr-col">{t.task_csrid || '-'}</td>
              <td>{t.task_name}</td>
              <td className="r fit">{t.work_hours_estimated}</td>
              <td className="c">{t.req_user_name || t.req_userid}</td>
              <td className="c">{t.itos_user_name || t.itos_userid}</td>
              <td className="c">{t.work_user_name || t.work_userid || '-'}</td>
              <td className="c">
                {fmtDT(t.start_datetime)}
                {t.start_fixed ? <span className="badge">고정</span> : null}
              </td>
              <td className="c">{fmtDT(t.end_datetime_estimated)}</td>
              <td className="c">{STAT_LABEL[t.task_stat] || t.task_stat}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan="11" className="empty">작업이 없습니다</td></tr>
          )}
        </tbody>
      </table>
      <p className="hint">
        우선순위 순 정렬. 작업 수정·삭제·일정 재적용은 [관리자 → 작업스케줄] 화면에서 합니다.
        {cfg
          ? ` (근무 ${cfg.segments.map(s => `${s.start}~${s.end}`).join(', ')} = 하루 ${cfg.work_hours_per_day}시간, 토·일·휴일·휴가 제외)`
          : ''}
      </p>
    </div>
  )
}
