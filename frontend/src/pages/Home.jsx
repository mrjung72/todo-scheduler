import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, taskColor, loadFilter, saveFilter } from '../api'

/* 모바일 스타일 메인 화면: 작업 목록을 카드 리스트로 표시, 탭하면 상세 펼침 */
export default function Home() {
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  // 초기값 = 저장된 검색조건, 없으면 사용자 기본사이트
  const [savedF] = useState(() => loadFilter('home'))
  const [siteFilter, setSiteFilter] = useState(() =>
    savedF.site ?? JSON.parse(localStorage.getItem('user') || 'null')?.default_siteid ?? '')
  const [q, setQ] = useState(savedF.q || '')
  const [statFilter, setStatFilter] = useState(savedF.stat || '')
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (statFilter) params.task_stat = statFilter
    if (siteFilter) params.siteid = siteFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, statFilter, siteFilter])

  useEffect(() => { load().catch(() => {}) }, [load])
  useEffect(() => { api.get('/sites').then(r => setSites(r.data)) }, [])

  return (
    <div className="home-wrap">
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
        <button onClick={() => {
          saveFilter('home', { site: siteFilter, q, stat: statFilter })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
      </div>
      <div className="home-list">
        {tasks.map(t => {
          const open = openId === t.taskid
          return (
            <div key={t.taskid} className={`home-card${open ? ' open' : ''}`}
              style={{ borderLeft: `5px solid ${taskColor(t.taskid)}` }}
              onClick={() => setOpenId(open ? null : t.taskid)}>
              <div className="kb-title">
                {t.site_name && <span className="kb-site">{t.site_name}</span>}
                {t.task_csrid && <span className="csr">{t.task_csrid}</span>}
                {(t.req_user_name || t.req_userid) &&
                  <span className="kb-req">{t.req_user_name || t.req_userid}</span>}
                {t.task_name}
                <span className={`home-stat st-${t.task_stat}`}>
                  {STAT_LABEL[t.task_stat] || t.task_stat}
                </span>
              </div>
              <div className="kb-sub">
                {t.work_user_name || t.work_userid || '미배정'}
              </div>
              <div className="kb-meta">
                <span>우선순위 {t.priority}</span>
                <span>{t.work_hours_estimated}h</span>
                {t.start_datetime &&
                  <span>{fmtDT(t.start_datetime)}~{fmtDT(t.end_datetime_estimated)}</span>}
              </div>
              {open && (
                <div className="home-detail">
                  <div><span>사이트</span>{t.site_name || t.siteid || '-'}</div>
                  <div><span>현업담당자</span>{t.req_user_name || t.req_userid || '-'}</div>
                  <div><span>IT담당자</span>{t.itos_user_name || t.itos_userid || '-'}</div>
                  <div><span>작업자</span>{t.work_user_name || t.work_userid || '-'}</div>
                  <div><span>예상시간</span>{t.work_hours_estimated}h</div>
                  <div><span>시작</span>{fmtDT(t.start_datetime) || '-'}
                    {t.start_fixed ? ' (고정)' : ''}</div>
                  <div><span>종료(예상)</span>{fmtDT(t.end_datetime_estimated) || '-'}</div>
                  {t.task_req_remark && <div><span>요청내용</span>{t.task_req_remark}</div>}
                </div>
              )}
            </div>
          )
        })}
        {tasks.length === 0 && <div className="home-empty">작업이 없습니다</div>}
      </div>
    </div>
  )
}
