import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, DAY_STAT_LABEL, GRADE_LABEL } from '../api'

const TABS = [
  { key: 'users', label: '사용자' },
  { key: 'sites', label: '사이트' },
  { key: 'tasks', label: '작업' },
  { key: 'calendar', label: '달력' },
  { key: 'schedules', label: '작업스케줄' },
]

export default function Admin() {
  const [tab, setTab] = useState('users')
  return (
    <div>
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'sites' && <SitesTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'schedules' && <SchedulesTab />}
    </div>
  )
}

/* ---------------- 공통 ---------------- */
function EditableCell({ value, onSave, type = 'text', options }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  if (options) {
    return (
      <select value={v} onChange={e => { setV(e.target.value); onSave(e.target.value) }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  return (
    <input type={type} value={v} onChange={e => setV(e.target.value)}
      onBlur={() => v !== (value ?? '') && onSave(type === 'number' ? +v : v)}
      onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
  )
}

/* ---------------- 사용자 ---------------- */
function UsersTab() {
  const empty = { userid: '', user_name: '', dept_name: '', job_title: '',
    user_tel: '', user_email: '', user_grade: 3, user_stat: 'Y' }
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(empty)
  const load = useCallback(() => api.get('/users').then(r => setRows(r.data)), [])
  useEffect(() => { load() }, [load])

  const save = (id, patch) => api.put(`/users/${id}`, patch).then(load)
  const add = async e => {
    e.preventDefault()
    await api.post('/users', form)
    setForm(empty); load()
  }
  const del = id => window.confirm(`사용자 ${id} 삭제?`) &&
    api.delete(`/users/${id}`).then(load)

  return (
    <div>
      <form className="newtask" onSubmit={add}>
        <input required placeholder="사용자ID" value={form.userid}
          onChange={e => setForm({ ...form, userid: e.target.value })} />
        <input required placeholder="사용자명" value={form.user_name}
          onChange={e => setForm({ ...form, user_name: e.target.value })} />
        <input placeholder="부서" value={form.dept_name}
          onChange={e => setForm({ ...form, dept_name: e.target.value })} />
        <input placeholder="직급" value={form.job_title}
          onChange={e => setForm({ ...form, job_title: e.target.value })} />
        <select value={form.user_grade}
          onChange={e => setForm({ ...form, user_grade: +e.target.value })}>
          {Object.entries(GRADE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="submit">추가</button>
      </form>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>이름</th><th>부서</th><th>직급</th><th>연락처</th>
          <th>이메일</th><th>등급</th><th>상태</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(u => (
            <tr key={u.userid}>
              <td>{u.userid}</td>
              <td><EditableCell value={u.user_name} onSave={v => save(u.userid, { user_name: v })} /></td>
              <td><EditableCell value={u.dept_name} onSave={v => save(u.userid, { dept_name: v })} /></td>
              <td><EditableCell value={u.job_title} onSave={v => save(u.userid, { job_title: v })} /></td>
              <td><EditableCell value={u.user_tel} onSave={v => save(u.userid, { user_tel: v })} /></td>
              <td><EditableCell value={u.user_email} onSave={v => save(u.userid, { user_email: v })} /></td>
              <td><EditableCell value={u.user_grade} onSave={v => save(u.userid, { user_grade: v })}
                options={Object.entries(GRADE_LABEL).map(([k, l]) => ({ value: +k, label: l }))} /></td>
              <td><EditableCell value={u.user_stat} onSave={v => save(u.userid, { user_stat: v })}
                options={[{ value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }]} /></td>
              <td><button className="danger" onClick={() => del(u.userid)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- 사이트 ---------------- */
function SitesTab() {
  const empty = { siteid: '', site_name: '', site_stat: 'Y', site_remark: '', itos_userid: '' }
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(empty)
  const load = useCallback(() => api.get('/sites').then(r => setRows(r.data)), [])
  useEffect(() => { load(); api.get('/users').then(r => setUsers(r.data)) }, [load])

  const save = (id, patch) => api.put(`/sites/${id}`, patch).then(load)
  const add = async e => {
    e.preventDefault()
    await api.post('/sites', form)
    setForm(empty); load()
  }
  const del = id => window.confirm(`사이트 ${id} 삭제?`) &&
    api.delete(`/sites/${id}`).then(load)

  const itosOptions = [{ value: '', label: '-' },
    ...users.filter(u => [0, 1].includes(u.user_grade))
      .map(u => ({ value: u.userid, label: u.user_name }))]

  return (
    <div>
      <form className="newtask" onSubmit={add}>
        <input required placeholder="사이트ID" value={form.siteid}
          onChange={e => setForm({ ...form, siteid: e.target.value })} />
        <input required placeholder="사이트명" value={form.site_name}
          onChange={e => setForm({ ...form, site_name: e.target.value })} />
        <input placeholder="설명" value={form.site_remark}
          onChange={e => setForm({ ...form, site_remark: e.target.value })} />
        <select value={form.itos_userid}
          onChange={e => setForm({ ...form, itos_userid: e.target.value })}>
          <option value="">IT담당자</option>
          {itosOptions.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="submit">추가</button>
      </form>
      <table className="grid">
        <thead><tr>
          <th>사이트ID</th><th>사이트명</th><th>설명</th><th>IT담당자</th><th>상태</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.siteid}>
              <td>{s.siteid}</td>
              <td><EditableCell value={s.site_name} onSave={v => save(s.siteid, { site_name: v })} /></td>
              <td><EditableCell value={s.site_remark} onSave={v => save(s.siteid, { site_remark: v })} /></td>
              <td><EditableCell value={s.itos_userid} onSave={v => save(s.siteid, { itos_userid: v })}
                options={itosOptions} /></td>
              <td><EditableCell value={s.site_stat} onSave={v => save(s.siteid, { site_stat: v })}
                options={[{ value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }]} /></td>
              <td><button className="danger" onClick={() => del(s.siteid)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- 작업 ---------------- */
function TasksTab() {
  const empty = { task_name: '', siteid: '', priority: 0, work_hours_estimated: 8,
    task_stat: 'W', task_csrid: '', task_req_remark: '', req_userid: '',
    itos_userid: '', work_userid: '' }
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [sites, setSites] = useState([])
  const [form, setForm] = useState(empty)
  const load = useCallback(() => api.get('/tasks').then(r => setRows(r.data)), [])
  useEffect(() => {
    load()
    api.get('/users').then(r => setUsers(r.data))
    api.get('/sites').then(r => setSites(r.data))
  }, [load])

  const save = (id, patch) => api.put(`/tasks/${id}`, patch).then(load)
  const add = async e => {
    e.preventDefault()
    await api.post('/tasks', form)
    setForm(empty); load()
  }
  const del = id => window.confirm(`작업 #${id} 삭제?`) &&
    api.delete(`/tasks/${id}`).then(load)

  const uopt = grades => [{ value: '', label: '-' },
    ...users.filter(u => !grades || grades.includes(u.user_grade))
      .map(u => ({ value: u.userid, label: u.user_name }))]
  const sopt = [{ value: '', label: '-' },
    ...sites.map(s => ({ value: s.siteid, label: s.site_name }))]

  return (
    <div>
      <form className="newtask" onSubmit={add}>
        <input required placeholder="작업명" value={form.task_name}
          onChange={e => setForm({ ...form, task_name: e.target.value })} />
        <select value={form.siteid} onChange={e => setForm({ ...form, siteid: e.target.value })}>
          {sopt.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="number" className="num" placeholder="우선순위" value={form.priority}
          onChange={e => setForm({ ...form, priority: +e.target.value })} />
        <input type="number" className="num" step="0.5" placeholder="예상시간"
          value={form.work_hours_estimated}
          onChange={e => setForm({ ...form, work_hours_estimated: +e.target.value })} />
        <button type="submit">추가</button>
      </form>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>작업명</th><th>사이트</th><th>우선순위</th><th>예상(h)</th><th>실제(h)</th>
          <th>상태</th><th>CSR</th><th>현업</th><th>IT</th><th>요청내용</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(t => (
            <tr key={t.taskid}>
              <td>{t.taskid}</td>
              <td><EditableCell value={t.task_name} onSave={v => save(t.taskid, { task_name: v })} /></td>
              <td><EditableCell value={t.siteid} onSave={v => save(t.taskid, { siteid: v })} options={sopt} /></td>
              <td><EditableCell type="number" value={t.priority} onSave={v => save(t.taskid, { priority: v })} /></td>
              <td><EditableCell type="number" value={t.work_hours_estimated}
                onSave={v => save(t.taskid, { work_hours_estimated: v })} /></td>
              <td><EditableCell type="number" value={t.work_hours_real}
                onSave={v => save(t.taskid, { work_hours_real: v })} /></td>
              <td><EditableCell value={t.task_stat} onSave={v => save(t.taskid, { task_stat: v })}
                options={Object.entries(STAT_LABEL).map(([k, l]) => ({ value: k, label: l }))} /></td>
              <td><EditableCell value={t.task_csrid} onSave={v => save(t.taskid, { task_csrid: v })} /></td>
              <td><EditableCell value={t.req_userid} onSave={v => save(t.taskid, { req_userid: v })}
                options={uopt([2, 3])} /></td>
              <td><EditableCell value={t.itos_userid} onSave={v => save(t.taskid, { itos_userid: v })}
                options={uopt([0, 1])} /></td>
              <td><EditableCell value={t.task_req_remark}
                onSave={v => save(t.taskid, { task_req_remark: v })} /></td>
              <td><button className="danger" onClick={() => del(t.taskid)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- 달력 ---------------- */
function CalendarTab() {
  const today = new Date()
  const [month, setMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState([])
  const [year, setYear] = useState(today.getFullYear())

  const load = useCallback(() => {
    const start = month.replace('-', '') + '01'
    const end = month.replace('-', '') + '31'
    api.get('/calendar', { params: { start, end } }).then(r => setRows(r.data))
  }, [month])
  useEffect(() => { load() }, [load])

  const save = (dateid, patch) => api.put(`/calendar/${dateid}`, patch).then(load)
  const generate = () =>
    api.post(`/calendar/generate?year=${year}`).then(r => {
      alert(`${r.data.created}일 생성`); load()
    })

  return (
    <div>
      <div className="toolbar">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <input type="number" className="num" value={year}
          onChange={e => setYear(+e.target.value)} style={{ width: 90 }} />
        <button onClick={generate}>해당 연도 달력 생성</button>
        <span className="hint">휴일(H)/휴가(V)로 지정된 날은 스케줄 계산에서 제외됩니다.</span>
      </div>
      <table className="grid">
        <thead><tr><th>일자ID</th><th>일자</th><th>요일</th><th>상태</th><th>설명</th></tr></thead>
        <tbody>
          {rows.map(d => {
            const dt = new Date(`${d.dateid.slice(0, 4)}-${d.dateid.slice(4, 6)}-${d.dateid.slice(6, 8)}`)
            const wd = '일월화수목금토'[dt.getDay()]
            return (
              <tr key={d.dateid} className={d.date_stat === 'W' ? '' : 'dayoff'}>
                <td>{d.dateid}</td>
                <td>{d.date_name}</td>
                <td>{wd}</td>
                <td><EditableCell value={d.date_stat} onSave={v => save(d.dateid, { date_stat: v })}
                  options={Object.entries(DAY_STAT_LABEL).map(([k, l]) => ({ value: k, label: l }))} /></td>
                <td><EditableCell value={d.holiday_remark}
                  onSave={v => save(d.dateid, { holiday_remark: v })} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- 작업스케줄 ---------------- */
function SchedulesTab() {
  const [rows, setRows] = useState([])
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const empty = { taskid: '', work_userid: '', work_stat: 'W', work_remark: '' }
  const [form, setForm] = useState(empty)

  const load = useCallback(() => api.get('/schedules').then(r => setRows(r.data)), [])
  useEffect(() => {
    load()
    api.get('/tasks').then(r => setTasks(r.data))
    api.get('/users').then(r => setUsers(r.data))
  }, [load])

  const save = (id, patch) => api.put(`/schedules/${id}`, patch).then(load)
  const add = async e => {
    e.preventDefault()
    await api.post('/schedules', { ...form, taskid: +form.taskid })
    setForm(empty); load()
  }
  const del = id => window.confirm(`스케줄 #${id} 삭제?`) &&
    api.delete(`/schedules/${id}`).then(load)

  const taskName = id => tasks.find(t => t.taskid === id)?.task_name ?? id
  const uopt = [{ value: '', label: '-' },
    ...users.map(u => ({ value: u.userid, label: u.user_name }))]
  const topt = [{ value: '', label: '-' },
    ...tasks.map(t => ({ value: t.taskid, label: `#${t.taskid} ${t.task_name}` }))]

  return (
    <div>
      <form className="newtask" onSubmit={add}>
        <select required value={form.taskid}
          onChange={e => setForm({ ...form, taskid: e.target.value })}>
          <option value="">작업 선택</option>
          {topt.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={form.work_userid}
          onChange={e => setForm({ ...form, work_userid: e.target.value })}>
          <option value="">작업자</option>
          {uopt.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input placeholder="작업내용" value={form.work_remark}
          onChange={e => setForm({ ...form, work_remark: e.target.value })} />
        <button type="submit">추가</button>
      </form>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>작업</th><th>작업자</th><th>상태</th><th>작업내용</th>
          <th>시작일시</th><th>종료(예상)</th><th>종료(실제)</th><th>시작고정</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.workschid}>
              <td>{s.workschid}</td>
              <td><EditableCell value={s.taskid} onSave={v => save(s.workschid, { taskid: v })}
                options={topt} /></td>
              <td><EditableCell value={s.work_userid} onSave={v => save(s.workschid, { work_userid: v })}
                options={uopt} /></td>
              <td><EditableCell value={s.work_stat} onSave={v => save(s.workschid, { work_stat: v })}
                options={Object.entries(STAT_LABEL).map(([k, l]) => ({ value: k, label: l }))} /></td>
              <td><EditableCell value={s.work_remark}
                onSave={v => save(s.workschid, { work_remark: v })} /></td>
              <td>{fmtDT(s.start_datetime)}</td>
              <td>{fmtDT(s.end_datetime_estimated)}</td>
              <td>{fmtDT(s.end_datetime_real)}</td>
              <td>{s.start_fixed ? '고정' : '자동'}</td>
              <td><button className="danger" onClick={() => del(s.workschid)}>삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        시작일시 수동 설정은 [작업목록] 화면의 "시작일시 설정" 컬럼에서 합니다.
      </p>
    </div>
  )
}
