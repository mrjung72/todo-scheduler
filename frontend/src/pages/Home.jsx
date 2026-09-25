import { useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, taskColor } from '../api'

/* 모바일 스타일 메인 화면: 작업 목록을 카드 리스트로 표시, 탭하면 상세 펼침 */
export default function Home() {
  const [tasks, setTasks] = useState([])
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    api.get('/tasks').then(r => setTasks(r.data)).catch(() => {})
  }, [])

  const kw = q.trim().toLowerCase()
  const filtered = !kw ? tasks : tasks.filter(t => [
    t.task_name, t.site_name, t.req_user_name, t.req_userid,
    t.itos_user_name, t.itos_userid, t.work_user_name, t.work_userid,
    STAT_LABEL[t.task_stat],
  ].some(v => (v ?? '').toString().toLowerCase().includes(kw)))

  return (
    <div className="home-wrap">
      <input className="home-search" placeholder="검색 (작업명/담당자/작업자/상태)"
        value={q} onChange={e => setQ(e.target.value)} />
      <div className="home-list">
        {filtered.map(t => {
          const open = openId === t.taskid
          return (
            <div key={t.taskid} className={`home-card${open ? ' open' : ''}`}
              onClick={() => setOpenId(open ? null : t.taskid)}>
              <div className="home-row">
                <span className="home-dot" style={{ background: taskColor(t.taskid) }} />
                <div className="home-main">
                  <div className="home-title">
                    <span className="home-pri">#{t.priority}</span>
                    {t.task_name}
                  </div>
                  <div className="home-sub">
                    {t.work_user_name || t.work_userid || '미배정'}
                    {' · '}{t.work_hours_estimated}h
                    {t.start_datetime && ` · ${fmtDT(t.start_datetime).slice(5)}`}
                  </div>
                </div>
                <span className={`home-stat st-${t.task_stat}`}>
                  {STAT_LABEL[t.task_stat] || t.task_stat}
                </span>
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
        {filtered.length === 0 && <div className="home-empty">작업이 없습니다</div>}
      </div>
    </div>
  )
}
