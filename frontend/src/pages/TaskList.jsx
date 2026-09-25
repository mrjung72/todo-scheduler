import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, colorOf } from '../api'

const SEARCH_FIELDS = [
  { value: 'all', label: '전체' },
  { value: 'task_name', label: '작업명' },
  { value: 'req_user', label: '현업담당자' },
  { value: 'itos_user', label: 'IT업무담당자' },
  { value: 'work_user', label: '작업자' },
]

const emptyForm = {
  task_name: '',
  siteid: '',
  priority: 0,
  work_hours_estimated: 8,
  req_userid: '',
  itos_userid: '',
  work_userid: '',
  task_stat: 'W',
}

export default function TaskList() {
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [sites, setSites] = useState([])
  const [field, setField] = useState('all')
  const [q, setQ] = useState('')
  const [statFilter, setStatFilter] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editStart, setEditStart] = useState({}) // workschid -> datetime-local value
  const [msg, setMsg] = useState('')
  const [cfg, setCfg] = useState(null)

  const load = useCallback(async () => {
    const params = {}
    if (q) { params.q = q; params.field = field }
    if (statFilter) params.task_stat = statFilter
    const { data } = await api.get('/tasks', { params })
    setTasks(data)
  }, [q, field, statFilter])

  useEffect(() => { load().catch(e => setMsg(e.message)) }, [load])
  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data))
    api.get('/sites').then(r => setSites(r.data))
    api.get('/config').then(r => setCfg(r.data))
  }, [])

  const updateTask = async (taskid, patch) => {
    await api.put(`/tasks/${taskid}`, patch)
    await load()
  }

  const recalc = async () => {
    const { data } = await api.post('/tasks/recalculate')
    setMsg(`재계산 완료: ${data.updated}건 갱신`)
    await load()
  }

  const createTask = async (e) => {
    e.preventDefault()
    await api.post('/tasks', form)
    setForm(emptyForm)
    await load()
  }

  const setStart = async (workschid) => {
    const v = editStart[workschid]
    if (!v) return
    await api.patch(`/schedules/${workschid}/start`, {
      start_datetime: new Date(v).toISOString(),
    })
    setEditStart(s => ({ ...s, [workschid]: '' }))
    await load()
  }

  const unfix = async (workschid) => {
    await api.patch(`/schedules/${workschid}/unfix`)
    await load()
  }

  const removeTask = async (taskid) => {
    if (!window.confirm(`작업 #${taskid} 를 삭제할까요?`)) return
    await api.delete(`/tasks/${taskid}`)
    await load()
  }

  const userOptions = (gradeFilter) =>
    users.filter(u => gradeFilter === undefined || gradeFilter.includes(u.user_grade))

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
        <button className="primary" onClick={recalc}>재적용(재계산)</button>
        {msg && <span className="msg">{msg}</span>}
      </div>

      <form className="newtask" onSubmit={createTask}>
        <input required placeholder="작업명" value={form.task_name}
          onChange={e => setForm({ ...form, task_name: e.target.value })} />
        <select value={form.siteid} onChange={e => setForm({ ...form, siteid: e.target.value })}>
          <option value="">사이트</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <input type="number" className="num" title="우선순위" placeholder="우선순위"
          value={form.priority} onChange={e => setForm({ ...form, priority: +e.target.value })} />
        <input type="number" className="num" title="예상작업시간" placeholder="시간" step="0.5"
          value={form.work_hours_estimated}
          onChange={e => setForm({ ...form, work_hours_estimated: +e.target.value })} />
        <select value={form.req_userid} onChange={e => setForm({ ...form, req_userid: e.target.value })}>
          <option value="">현업담당자</option>
          {userOptions([2, 3]).map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <select value={form.itos_userid} onChange={e => setForm({ ...form, itos_userid: e.target.value })}>
          <option value="">IT담당자</option>
          {userOptions([0, 1]).map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <select value={form.work_userid} onChange={e => setForm({ ...form, work_userid: e.target.value })}>
          <option value="">작업자</option>
          {userOptions([0]).map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <button type="submit">추가</button>
      </form>

      <table className="grid">
        <thead>
          <tr>
            <th>우선순위</th><th>작업명</th><th>사이트</th><th>예상(시)</th>
            <th>현업담당자</th><th>IT담당자</th><th>작업자</th>
            <th>시작일시</th><th>종료일시(예상)</th><th>상태</th><th>시작일시 설정</th><th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.taskid} style={{ borderLeft: `6px solid ${colorOf(t.siteid)}` }}>
              <td>
                <input type="number" className="num" value={t.priority ?? 0}
                  onChange={e => updateTask(t.taskid, { priority: +e.target.value })} />
              </td>
              <td>{t.task_name}</td>
              <td>{t.site_name || t.siteid}</td>
              <td>
                <input type="number" className="num" step="0.5" value={t.work_hours_estimated ?? 0}
                  onChange={e => updateTask(t.taskid, { work_hours_estimated: +e.target.value })} />
              </td>
              <td>{t.req_user_name || t.req_userid}</td>
              <td>{t.itos_user_name || t.itos_userid}</td>
              <td>{t.work_user_name || t.work_userid || '-'}</td>
              <td>
                {fmtDT(t.start_datetime)}
                {t.start_fixed ? <span className="badge">고정</span> : null}
              </td>
              <td>{fmtDT(t.end_datetime_estimated)}</td>
              <td>
                <select value={t.task_stat || 'W'}
                  onChange={e => updateTask(t.taskid, { task_stat: e.target.value })}>
                  {Object.entries(STAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td>
                {t.workschid ? (
                  <span className="startset">
                    <input type="datetime-local"
                      value={editStart[t.workschid] ?? ''}
                      onChange={e => setEditStart(s => ({ ...s, [t.workschid]: e.target.value }))} />
                    <button onClick={() => setStart(t.workschid)}>설정</button>
                    {t.start_fixed ? <button onClick={() => unfix(t.workschid)}>해제</button> : null}
                  </span>
                ) : '-'}
              </td>
              <td><button className="danger" onClick={() => removeTask(t.taskid)}>삭제</button></td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan="12" className="empty">작업이 없습니다</td></tr>
          )}
        </tbody>
      </table>
      <p className="hint">
        우선순위/예상시간 변경 후 [재적용]을 누르면 작업자별로 우선순위 순서대로
        시작/종료일시가 재계산됩니다.
        {cfg
          ? ` (근무 ${cfg.segments.map(s => `${s.start}~${s.end}`).join(', ')} = 하루 ${cfg.work_hours_per_day}시간, 토·일·휴일·휴가 제외)`
          : ''}
      </p>
    </div>
  )
}
