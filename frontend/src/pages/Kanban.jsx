import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, taskColor } from '../api'

// 3열 배치: 좌 = 대기중(70%)+취소(30%), 중 = 작업중(70%)+작업보류(30%), 우 = 완료(100%)
const LAYOUT = [
  ['W', 'C'],
  ['P', 'D'],
  ['F'],
]

export default function Kanban() {
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  // 사이트 기본값 = 로그인 사용자의 기본사이트(default_siteid)
  const [siteFilter, setSiteFilter] = useState(() =>
    JSON.parse(localStorage.getItem('user') || 'null')?.default_siteid || '')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (siteFilter) params.siteid = siteFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, siteFilter])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => { api.get('/sites').then(r => setSites(r.data)) }, [])

  const byStat = {}
  for (const t of tasks) (byStat[t.task_stat] ??= []).push(t)

  return (
    <div className="kanban-wrap">
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
        <button onClick={load}>검색</button>
      </div>

      <div className="kanban">
        {LAYOUT.map((stats, i) => (
          <div className="kb-col" key={i}>
            {stats.map(st => (
              <section className={`kb-area st-${st}`} key={st}>
                <h4 className="kb-head">
                  {STAT_LABEL[st] || st}
                  <span className="kb-count">{byStat[st]?.length || 0}</span>
                </h4>
                <div className="kb-cards">
                  {(byStat[st] || []).map(t => (
                    <div className="kb-card" key={t.taskid}
                      style={{ borderLeft: `5px solid ${taskColor(t.taskid)}` }}>
                      <div className="kb-title">
                        {t.site_name && <span className="kb-site">{t.site_name}</span>}
                        {t.task_csrid && <span className="kb-csr">{t.task_csrid}</span>}
                        {t.task_name}
                      </div>
                      <div className="kb-sub">
                        {t.work_user_name || t.work_userid || '-'}
                      </div>
                      <div className="kb-meta">
                        <span>우선순위 {t.priority}</span>
                        <span>{t.work_hours_estimated}h</span>
                        {t.start_datetime &&
                          <span>{fmtDT(t.start_datetime)}~{fmtDT(t.end_datetime_estimated)}</span>}
                      </div>
                    </div>
                  ))}
                  {!byStat[st]?.length && <div className="kb-empty">없음</div>}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
