import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, taskColor } from '../api'

const SEARCH_FIELDS = [
  { value: 'all', label: '전체' },
  { value: 'task_name', label: '작업명' },
  { value: 'req_user', label: '현업담당자' },
  { value: 'itos_user', label: 'IT업무담당자' },
  { value: 'work_user', label: '작업자' },
]

export default function TaskList() {
  const [tasks, setTasks] = useState([])
  const [field, setField] = useState('all')
  const [q, setQ] = useState('')
  const [statFilter, setStatFilter] = useState('')
  const [cfg, setCfg] = useState(null)

  const load = useCallback(async () => {
    const params = {}
    if (q) { params.q = q; params.field = field }
    if (statFilter) params.task_stat = statFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, field, statFilter])

  useEffect(() => { load().catch(console.error) }, [load])
  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data))
  }, [])

  return (
    <div>
      <div className="toolbar">
        <select value={field} onChange={e => setField(e.target.value)}>
          {SEARCH_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
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
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>우선순위</th><th>작업명</th><th>사이트</th><th>예상(시)</th>
            <th>현업담당자</th><th>IT담당자</th><th>작업자</th>
            <th>시작일시</th><th>종료일시(예상)</th><th>상태</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.taskid} style={{ borderLeft: `6px solid ${taskColor(t.taskid)}` }}>
              <td>{t.priority}</td>
              <td>{t.task_name}</td>
              <td>{t.site_name || t.siteid}</td>
              <td>{t.work_hours_estimated}</td>
              <td>{t.req_user_name || t.req_userid}</td>
              <td>{t.itos_user_name || t.itos_userid}</td>
              <td>{t.work_user_name || t.work_userid || '-'}</td>
              <td>
                {fmtDT(t.start_datetime)}
                {t.start_fixed ? <span className="badge">고정</span> : null}
              </td>
              <td>{fmtDT(t.end_datetime_estimated)}</td>
              <td>{STAT_LABEL[t.task_stat] || t.task_stat}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan="10" className="empty">작업이 없습니다</td></tr>
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
