import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, TASK_TYPE_LABEL, taskColor,
  loadFilter, saveFilter } from '../api'

/* 모바일 스타일 메인 화면: 작업중(P) 먼저, 그 아래 대기중(W)을 우선순위순으로 표시 */
export default function Home() {
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  const [savedF] = useState(() => loadFilter('home'))
  const [siteFilter, setSiteFilter] = useState(savedF.site ?? '')
  const [q, setQ] = useState(savedF.q || '')
  const [cfg, setCfg] = useState(null)

  const load = useCallback(async () => {
    const params = { task_stat: 'W,P' }
    if (siteFilter) params.siteid = siteFilter
    if (q) params.q = q
    const { data } = await api.get('/tasks', { params })
    // 작업중(P) 먼저, 그 다음 대기중(W) — 각 그룹은 우선순위→작업번호순
    const rank = t => (t.task_stat === 'P' ? 0 : 1)
    setTasks([...data].sort((a, b) =>
      rank(a) - rank(b) || a.priority - b.priority || a.taskid - b.taskid))
  }, [siteFilter, q])

  useEffect(() => { load().catch(() => {}) }, [load])
  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data)).catch(() => {})
    api.get('/sites').then(r => setSites(r.data)).catch(() => {})
  }, [])

  return (
    <div className="home-wrap">
      <div className="toolbar">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <input
          placeholder="검색어 (작업명/CSR/담당자명 또는 ID)"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button onClick={() => {
          saveFilter('home', { site: siteFilter, q })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
      </div>
      <div className="home-list">
        {tasks.map(t => {
          return (
            <div key={t.taskid} className="home-card"
              style={{ borderLeft: `5px solid ${taskColor(t.taskid)}` }}>
              <div className="kb-row1">
                <span className="kb-no">#{t.taskid}</span>
                {t.site_name && <span className="kb-site">{t.site_name}</span>}
                {t.task_type &&
                  <span className="kb-type">{TASK_TYPE_LABEL[t.task_type] || t.task_type}</span>}
                {t.task_csrid && <span className="kb-csr">{t.task_csrid}</span>}
                <span className={`home-stat st-${t.task_stat}`}>
                  {STAT_LABEL[t.task_stat] || t.task_stat}
                </span>
              </div>
              <div className="kb-title">
                <span className="kb-name" title={t.task_name}>{t.task_name}</span>
                <span className="kb-req">{t.work_user_name || t.work_userid || '-'}</span>
                <span className="home-req-date">{t.work_hours_estimated}h
                  {(t.work_hours_estimated &&
                    (t.work_hours_day || cfg?.work_hours_per_day)) ?
                    ` (총 ${Math.ceil(t.work_hours_estimated / (t.work_hours_day || cfg.work_hours_per_day))}일)` : ''}
                </span>
                {t.task_start_date &&
                  <span className="home-req-date">{fmtDT(t.task_start_date)}</span>}
              </div>
              <div className="kb-meta">
                <span>{t.req_user_name || t.req_userid || '-'}</span>
                {t.req_date &&
                  <span>{(t.req_date || '').slice(0, 19).replace('T', ' ')}</span>}
              </div>
            </div>
          )
        })}
        {tasks.length === 0 && <div className="home-empty">작업이 없습니다</div>}
      </div>
    </div>
  )
}
