import { useCallback, useEffect, useState } from 'react'
import api, { STAT_LABEL, NEXT_STAT, taskColor, loadFilter, saveFilter } from '../api'
import TaskDetailPopup from '../TaskDetailPopup'

// 3열 배치: 좌 = 대기중(70%)+취소(30%), 중 = 작업중(70%)+작업보류(30%), 우 = 완료(100%)
const LAYOUT = [
  ['W', 'C'],
  ['P', 'D'],
  ['F'],
]

export default function Kanban() {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const [tasks, setTasks] = useState([])
  const [sites, setSites] = useState([])
  // 사이트 기본값 = 로그인 사용자의 기본사이트(default_siteid)
  const [savedF] = useState(() => loadFilter('kanban'))
  const [siteFilter, setSiteFilter] = useState(() =>
    savedF.site ?? me?.default_siteid ?? '')
  const [q, setQ] = useState(savedF.q || '')
  const [dropTarget, setDropTarget] = useState(null)  // 드롭 대상 영역의 상태값
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)   // 상세 팝업 대상 작업

  // 카드 이동 권한: 관리자(0) 전부, 개발자(1)는 본인 작업만
  const canMove = t => me && (me.user_grade === 0 ||
    (me.user_grade === 1 && t.work_userid === me.userid))

  const load = useCallback(async () => {
    const params = {}
    if (q) params.q = q
    if (siteFilter) params.siteid = siteFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, siteFilter])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => { api.get('/sites').then(r => setSites(r.data)) }, [])

  const onDrop = async (e, st) => {
    e.preventDefault()
    setDropTarget(null)
    const taskid = +e.dataTransfer.getData('text/taskid')
    const t = tasks.find(x => x.taskid === taskid)
    if (!t || t.task_stat === st || !canMove(t)) return
    // 허용 전이 외 이동은 서버와 동일 규칙으로 차단
    if (!(NEXT_STAT[t.task_stat] || []).includes(st)) {
      setErr(`${STAT_LABEL[t.task_stat]} 상태에서는 ${STAT_LABEL[st]}(으)로 변경할 수 없습니다`)
      return
    }
    try {
      await api.put(`/tasks/${taskid}`, { task_stat: st })  // 스케줄 work_stat도 동기화됨
      load()
    } catch (ex) {
      setErr(ex.response?.data?.detail || '상태 변경에 실패했습니다')
    }
  }

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
        <button onClick={() => {
          saveFilter('kanban', { site: siteFilter, q })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
        {err && <span className="err">{err}</span>}
      </div>

      <div className="kanban">
        {LAYOUT.map((stats, i) => (
          <div className="kb-col" key={i}>
            {stats.map(st => (
              <section
                className={`kb-area st-${st}` + (dropTarget === st ? ' drop-over' : '')}
                key={st}
                onDragOver={e => { e.preventDefault(); setDropTarget(st) }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null)
                }}
                onDrop={e => onDrop(e, st)}
              >
                <h4 className="kb-head">
                  {STAT_LABEL[st] || st}
                  <span className="kb-count">{byStat[st]?.length || 0}</span>
                </h4>
                <div className="kb-cards">
                  {(byStat[st] || []).map(t => (
                    <div className="kb-card" key={t.taskid}
                      draggable={canMove(t)}
                      onDragStart={e =>
                        e.dataTransfer.setData('text/taskid', String(t.taskid))}
                      style={{ borderLeft: `5px solid ${taskColor(t.taskid)}` }}>
                      <div className="kb-row1">
                        <span className="kb-no">#{t.taskid}</span>
                        {t.site_name && <span className="kb-site">{t.site_name}</span>}
                        {t.task_csrid && <span className="kb-csr">{t.task_csrid}</span>}
                      </div>
                      <div className="kb-title">
                        <span className="kb-req">{t.req_user_name || t.req_userid || '-'}</span>
                        {t.task_name}
                      </div>
                      <div className="kb-meta">
                        {(t.start_datetime || t.end_datetime_estimated) &&
                          <span>{(t.start_datetime || '').slice(0, 10)} ~ {(t.end_datetime_estimated || '').slice(0, 10)}</span>}
                      </div>
                      <button className="kb-detail" title="작업 상세"
                        onClick={e => { e.stopPropagation(); setSel(t) }}>상세</button>
                    </div>
                  ))}
                  {!byStat[st]?.length && <div className="kb-empty">없음</div>}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
      {sel && <TaskDetailPopup task={sel} onClose={() => setSel(null)} onChanged={load} />}
    </div>
  )
}
