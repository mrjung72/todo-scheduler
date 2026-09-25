import { useCallback, useEffect, useState } from 'react'
import api, { fmtDT, STAT_LABEL, DAY_STAT_LABEL, GRADE_LABEL } from '../api'

const TABS = [
  { key: 'users', label: '사용자', adminOnly: true },
  { key: 'sites', label: '사이트', adminOnly: true },
  { key: 'tasks', label: '작업' },
  { key: 'calendar', label: '달력', adminOnly: true },
  { key: 'holidays', label: '작업자휴가' },
  { key: 'schedules', label: '작업스케줄' },
]

// 개발자(등급 1)도 접근 가능한 탭. 비관리자는 자기 작업만 수정 가능.
const isAdmin = () => JSON.parse(localStorage.getItem('user') || 'null')?.user_grade === 0
const myId = () => JSON.parse(localStorage.getItem('user') || 'null')?.userid

export default function Admin() {
  const admin = isAdmin()
  const visibleTabs = admin ? TABS : TABS.filter(t => !t.adminOnly)
  const [tab, setTab] = useState(admin ? 'users' : 'tasks')
  return (
    <div>
      <div className="tabs">
        {visibleTabs.map(t => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'sites' && <SitesTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'holidays' && <HolidaysTab />}
      {tab === 'schedules' && <SchedulesTab />}
    </div>
  )
}

/* ---------------- 공통 ---------------- */
function EditableCell({ value, onSave, type = 'text', options, disabled }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  if (disabled) {
    const label = options?.find(o => o.value === value)?.label
    return <span>{label ?? value ?? ''}</span>
  }
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
    user_tel: '', user_email: '', user_grade: 9, user_stat: 'Y', password: '' }
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
        <input type="password" placeholder="비밀번호(기본 1234)" value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })} />
        <button type="submit">추가</button>
      </form>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>이름</th><th>부서</th><th>직급</th><th>연락처</th>
          <th>이메일</th><th>등급</th><th>비밀번호</th><th>상태</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(u => (
            <tr key={u.userid}>
              <td>{u.userid}</td>
              <td className="c"><EditableCell value={u.user_name} onSave={v => save(u.userid, { user_name: v })} /></td>
              <td><EditableCell value={u.dept_name} onSave={v => save(u.userid, { dept_name: v })} /></td>
              <td><EditableCell value={u.job_title} onSave={v => save(u.userid, { job_title: v })} /></td>
              <td><EditableCell value={u.user_tel} onSave={v => save(u.userid, { user_tel: v })} /></td>
              <td><EditableCell value={u.user_email} onSave={v => save(u.userid, { user_email: v })} /></td>
              <td><EditableCell value={u.user_grade} onSave={v => save(u.userid, { user_grade: v })}
                options={Object.entries(GRADE_LABEL).map(([k, l]) => ({ value: +k, label: l }))} /></td>
              <td><button onClick={() => {
                const pw = window.prompt(`${u.user_name || u.userid} 새 비밀번호`)
                if (pw) save(u.userid, { password: pw })
              }}>변경</button></td>
              <td className="c"><EditableCell value={u.user_stat} onSave={v => save(u.userid, { user_stat: v })}
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
    ...users.filter(u => [0, 2].includes(u.user_grade))
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
              <td className="c"><EditableCell value={s.itos_userid} onSave={v => save(s.siteid, { itos_userid: v })}
                options={itosOptions} /></td>
              <td className="c"><EditableCell value={s.site_stat} onSave={v => save(s.siteid, { site_stat: v })}
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
  const [q, setQ] = useState('')
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

  const admin = isAdmin()
  const can = t => admin || t.work_userid === myId()
  const uopt = grades => [{ value: '', label: '-' },
    ...users.filter(u => !grades || grades.includes(u.user_grade))
      .map(u => ({ value: u.userid, label: u.user_name }))]
  const devOpt = admin ? uopt([1])
    : uopt([1]).filter(o => o.value === '' || o.value === myId())
  const sopt = [{ value: '', label: '-' },
    ...sites.map(s => ({ value: s.siteid, label: s.site_name }))]

  const filtered = (!q.trim() ? rows : rows.filter(t => {
    const kw = q.trim().toLowerCase()
    return [
      t.task_name, t.task_csrid, t.task_req_remark, t.site_name, t.siteid,
      t.req_userid, t.req_user_name, t.itos_userid, t.itos_user_name,
      t.work_userid, t.work_user_name, STAT_LABEL[t.task_stat],
    ].some(v => (v ?? '').toString().toLowerCase().includes(kw))
  })).filter(t => admin || t.work_userid === myId())  // 비관리자: 본인 작업만

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
        {admin && (
          <select value={form.work_userid}
            onChange={e => setForm({ ...form, work_userid: e.target.value })}>
            <option value="">작업자(개발자)</option>
            {devOpt.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button type="submit">추가</button>
      </form>
      <div className="toolbar">
        <input placeholder="검색 (작업명/사이트/담당자/작업자/상태/CSR)" value={q}
          onChange={e => setQ(e.target.value)} />
      </div>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>사이트</th><th>작업명</th><th>우선<br/>순위</th><th>예상 작업<br/>시간(H)</th><th>실제 작업<br/>시간(H)</th>
          <th>상태</th><th>CSR 번호</th><th>현업 담당자</th><th>IT업무 담당자</th><th>작업자</th><th>요청내용</th><th></th>
        </tr></thead>
        <tbody>
          {filtered.map(t => (
            <tr key={t.taskid}>
              <td className="r">{t.taskid}</td>
              <td><EditableCell value={t.siteid} disabled={!can(t)}
                onSave={v => save(t.taskid, { siteid: v })} options={sopt} /></td>
              <td><EditableCell value={t.task_name} disabled={!can(t)}
                onSave={v => save(t.taskid, { task_name: v })} /></td>
              <td className="r"><EditableCell type="number" value={t.priority} disabled={!can(t)}
                onSave={v => save(t.taskid, { priority: v })} /></td>
              <td className="r"><EditableCell type="number" value={t.work_hours_estimated} disabled={!can(t)}
                onSave={v => save(t.taskid, { work_hours_estimated: v })} /></td>
              <td className="r"><EditableCell type="number" value={t.work_hours_real} disabled={!can(t)}
                onSave={v => save(t.taskid, { work_hours_real: v })} /></td>
              <td className="c"><EditableCell value={t.task_stat} disabled={!can(t)}
                onSave={v => save(t.taskid, { task_stat: v })}
                options={Object.entries(STAT_LABEL).map(([k, l]) => ({ value: k, label: l }))} /></td>
              <td><EditableCell value={t.task_csrid} disabled={!can(t)}
                onSave={v => save(t.taskid, { task_csrid: v })} /></td>
              <td className="c"><EditableCell value={t.req_userid} disabled={!can(t)}
                onSave={v => save(t.taskid, { req_userid: v })}
                options={uopt([3, 9])} /></td>
              <td className="c"><EditableCell value={t.itos_userid} disabled={!can(t)}
                onSave={v => save(t.taskid, { itos_userid: v })}
                options={uopt([0, 2])} /></td>
              <td className="c"><EditableCell value={t.work_userid} disabled={!admin}
                onSave={v => save(t.taskid, { work_userid: v })}
                options={devOpt} /></td>
              <td><EditableCell value={t.task_req_remark} disabled={!can(t)}
                onSave={v => save(t.taskid, { task_req_remark: v })} /></td>
              <td>{['W', 'C'].includes(t.task_stat) && can(t) &&
                <button className="danger" onClick={() => del(t.taskid)}>삭제</button>}</td>
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
        <span className="hint">휴일(H)로 지정된 날은 스케줄 계산에서 제외됩니다.</span>
      </div>
      <table className="grid">
        <thead><tr><th>일자ID</th><th>일자</th><th>요일</th><th>상태</th><th>설명</th></tr></thead>
        <tbody>
          {rows.map(d => {
            const dt = new Date(`${d.dateid.slice(0, 4)}-${d.dateid.slice(4, 6)}-${d.dateid.slice(6, 8)}`)
            const wd = '일월화수목금토'[dt.getDay()]
            return (
              <tr key={d.dateid} className={d.date_stat === 'W' ? '' : 'dayoff'}>
                <td className="c">{d.dateid}</td>
                <td className="c">{d.date_name}</td>
                <td className="c">{wd}</td>
                <td className="c"><EditableCell value={d.date_stat} onSave={v => save(d.dateid, { date_stat: v })}
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

/* ---------------- 작업자휴가 ---------------- */
const HOL_CAT_LABEL = { A: '종일', P: '일부' }

function HolidaysTab() {
  const today = new Date()
  const [month, setMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [filterUser, setFilterUser] = useState('')
  const admin = isAdmin()
  const can = h => admin || h.work_userid === myId()
  const empty = { date: '', work_userid: admin ? '' : (myId() || ''),
    holiday_category: 'A', holiday_hours: 4, holiday_remark: '' }
  const [form, setForm] = useState(empty)

  const load = useCallback(() => {
    const params = {
      start: month.replace('-', '') + '01',
      end: month.replace('-', '') + '31',
    }
    const uid = admin ? filterUser : myId()   // 비관리자: 본인 휴가만 조회
    if (uid) params.work_userid = uid
    api.get('/user-holidays', { params }).then(r => setRows(r.data))
  }, [month, filterUser, admin])
  useEffect(() => {
    load()
    api.get('/users').then(r => setUsers(r.data))
  }, [load])

  const save = (h, patch) =>
    api.put(`/user-holidays/${h.dateid}/${h.work_userid}`, patch).then(load)

  const add = async e => {
    e.preventDefault()
    if (!form.date || !form.work_userid) return
    await api.post('/user-holidays', {
      dateid: form.date.replaceAll('-', ''),
      work_userid: form.work_userid,
      holiday_category: form.holiday_category,
      holiday_hours: form.holiday_category === 'P' ? +form.holiday_hours : 0,
      holiday_remark: form.holiday_remark,
    })
    setForm(empty); load()
  }
  const del = h => window.confirm(`${h.dateid} ${h.user_name || h.work_userid} 휴가 삭제?`) &&
    api.delete(`/user-holidays/${h.dateid}/${h.work_userid}`).then(load)

  const catOptions = Object.entries(HOL_CAT_LABEL).map(([k, l]) => ({ value: k, label: l }))
  const userOptions = [{ value: '', label: '작업자(전체)' },
    ...users.map(u => ({ value: u.userid, label: u.user_name }))]

  return (
    <div>
      <form className="newtask" onSubmit={add}>
        <input type="date" required value={form.date}
          onChange={e => setForm({ ...form, date: e.target.value })} />
        {admin && (
          <select required value={form.work_userid}
            onChange={e => setForm({ ...form, work_userid: e.target.value })}>
            <option value="">작업자 선택</option>
            {users.map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
          </select>
        )}
        <select value={form.holiday_category}
          onChange={e => setForm({ ...form, holiday_category: e.target.value })}>
          {catOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {form.holiday_category === 'P' && (
          <input type="number" className="num" min="1" max="8" step="0.5"
            title="휴가시간" value={form.holiday_hours}
            onChange={e => setForm({ ...form, holiday_hours: e.target.value })} />
        )}
        <input placeholder="설명 (예: 연차, 오후반차)" value={form.holiday_remark}
          onChange={e => setForm({ ...form, holiday_remark: e.target.value })} />
        <button type="submit">추가</button>
      </form>
      <div className="toolbar">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        {admin && (
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            {userOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <span className="hint">
          종일(A)은 해당일 근무 제외, 일부(P)는 휴가시간만큼 근무시간 차감(하루 뒤쪽부터).
          반영은 [작업목록]의 재적용 시 적용됩니다.
        </span>
      </div>
      <table className="grid">
        <thead><tr>
          <th>일자</th><th>작업자</th><th>구분</th><th>휴가시간</th><th>설명</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map(h => (
            <tr key={`${h.dateid}-${h.work_userid}`}>
              <td className="c">{h.dateid.slice(0,4)}-{h.dateid.slice(4,6)}-{h.dateid.slice(6,8)}</td>
              <td className="c">{h.user_name || h.work_userid}</td>
              <td className="c"><EditableCell value={h.holiday_category} disabled={!can(h)}
                onSave={v => save(h, { holiday_category: v })} options={catOptions} /></td>
              <td className="r"><EditableCell type="number" value={h.holiday_hours} disabled={!can(h)}
                onSave={v => save(h, { holiday_hours: v })} /></td>
              <td><EditableCell value={h.holiday_remark} disabled={!can(h)}
                onSave={v => save(h, { holiday_remark: v })} /></td>
              <td>{can(h) &&
                <button className="danger" onClick={() => del(h)}>삭제</button>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="6" className="empty">등록된 휴가가 없습니다</td></tr>}
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
  const [startForm, setStartForm] = useState(null)  // {workschid, start, fixed} 시작일시 팝업
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')
  const admin = isAdmin()
  const can = s => admin || s.work_userid === myId()
  const empty = { taskid: '', work_userid: admin ? '' : (myId() || ''),
    work_stat: 'W', work_remark: '' }
  const [form, setForm] = useState(empty)

  const load = useCallback(() => {
    api.get('/schedules').then(r => setRows(r.data))
    api.get('/tasks').then(r => setTasks(r.data))
  }, [])
  useEffect(() => {
    load()
    api.get('/users').then(r => setUsers(r.data))
  }, [load])

  const taskOf = id => tasks.find(t => t.taskid === id)

  const saveSched = (id, patch) => api.put(`/schedules/${id}`, patch).then(load)
  const saveTask = (taskid, patch) => api.put(`/tasks/${taskid}`, patch).then(load)

  const add = async e => {
    e.preventDefault()
    await api.post('/schedules', { ...form, taskid: +form.taskid })
    setForm(empty); load()
  }
  const del = id => window.confirm(`스케줄 #${id} 삭제?`) &&
    api.delete(`/schedules/${id}`).then(load)

  const recalc = async () => {
    const { data } = await api.post('/tasks/recalculate')
    setMsg(`재계산 완료: ${data.updated}건 반영` +
      (data.created ? ` (스케줄 신규 추가 ${data.created}건)` : ''))
    load()
  }

  const saveStart = async e => {
    e.preventDefault()
    if (!startForm?.start) return
    await api.patch(`/schedules/${startForm.workschid}/start`, {
      // 로컬 naive 시각 그대로 전송 (toISOString은 UTC로 밀림)
      start_datetime: startForm.start.length === 16 ? startForm.start + ':00' : startForm.start,
    })
    setStartForm(null)
    load()
  }
  const unfixStart = async () => {
    await api.patch(`/schedules/${startForm.workschid}/unfix`)
    setStartForm(null)
    load()
  }

  // 작업자는 개발자(등급 1)만 선택 가능. 단 기존 배정된 작업자가 개발자가 아니면
  // 값이 깨지지 않도록 해당 작업자만 선택지에 포함
  const devOpt = users.filter(u => u.user_grade === 1)
    .map(u => ({ value: u.userid, label: u.user_name }))
  const woptFor = cur =>
    [{ value: '', label: '-' }, ...devOpt,
      ...(cur && !devOpt.some(o => o.value === cur)
        ? [{ value: cur, label: userName(cur) || cur }] : [])]
  const uopt = [{ value: '', label: '-' }, ...devOpt]
  const topt = [{ value: '', label: '-' },
    ...tasks.map(t => ({ value: t.taskid, label: `#${t.taskid} ${t.task_name}` }))]
  const statOpt = Object.entries(STAT_LABEL).map(([k, l]) => ({ value: k, label: l }))

  const userName = id => users.find(u => u.userid === id)?.user_name ?? ''
  const filtered = (!q.trim() ? rows : rows.filter(s => {
    const t = taskOf(s.taskid)
    const kw = q.trim().toLowerCase()
    return [
      t?.task_name, t?.site_name, t?.siteid, s.work_userid, userName(s.work_userid),
      s.work_remark, STAT_LABEL[s.work_stat],
    ].some(v => (v ?? '').toString().toLowerCase().includes(kw))
  })).filter(s => admin || s.work_userid === myId())  // 비관리자: 본인 스케줄만

  return (
    <div>
      <div className="toolbar">
        {msg && <span className="msg">{msg}</span>}
        <button className="primary" style={{ marginLeft: 'auto' }}
          onClick={recalc}>재적용(재계산)</button>
      </div>
      <form className="newtask" onSubmit={add}>
        <select required value={form.taskid}
          onChange={e => setForm({ ...form, taskid: e.target.value })}>
          <option value="">작업 선택</option>
          {topt.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {admin && (
          <select value={form.work_userid}
            onChange={e => setForm({ ...form, work_userid: e.target.value })}>
            <option value="">작업자</option>
            {uopt.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <input placeholder="작업내용" value={form.work_remark}
          onChange={e => setForm({ ...form, work_remark: e.target.value })} />
        <button type="submit">추가</button>
      </form>
      <div className="toolbar">
        <input placeholder="검색 (작업명/사이트/작업자/내용/상태)" value={q}
          onChange={e => setQ(e.target.value)} />
      </div>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>사이트</th><th>우선<br/>순위</th><th>작업</th><th>예상 작업<br/>시간(Hour)</th><th>작업자</th>
          <th>상태</th><th>작업내용</th>
          <th>시작일시</th><th>종료일시<br/>(예상)</th><th>종료일시<br/>(실제)</th>
          <th></th>
        </tr></thead>
        <tbody>
          {filtered.map(s => {
            const t = taskOf(s.taskid)
            return (
              <tr key={s.workschid}>
                <td className="r">{s.workschid}</td>
                <td>{t?.site_name || t?.siteid || '-'}</td>
                <td className="r"><EditableCell type="number" value={t?.priority ?? ''} disabled={!can(s)}
                  onSave={v => t && saveTask(t.taskid, { priority: v })} /></td>
                <td><EditableCell value={s.taskid} disabled={!admin}
                  onSave={v => saveSched(s.workschid, { taskid: v })}
                  options={topt} /></td>
                <td className="r"><EditableCell type="number" value={t?.work_hours_estimated ?? ''} disabled={!can(s)}
                  onSave={v => t && saveTask(t.taskid, { work_hours_estimated: v })} /></td>
                <td className="c"><EditableCell value={s.work_userid} disabled={!admin}
                  onSave={v => saveSched(s.workschid, { work_userid: v })}
                  options={woptFor(s.work_userid)} /></td>
                <td className="c"><EditableCell value={s.work_stat} disabled={!can(s)}
                  onSave={v => saveSched(s.workschid, { work_stat: v })}
                  options={statOpt} /></td>
                <td><EditableCell value={s.work_remark} disabled={!can(s)}
                  onSave={v => saveSched(s.workschid, { work_remark: v })} /></td>
                <td className={`c${can(s) ? ' clickable' : ''}`}
                  title={can(s) ? '클릭하면 시작일시를 수정합니다' : undefined}
                  onClick={() => can(s) && setStartForm({
                    workschid: s.workschid,
                    start: s.start_datetime ? s.start_datetime.slice(0, 16) : '',
                    fixed: !!s.start_fixed,
                  })}>
                  {fmtDT(s.start_datetime) || '-'}
                  {s.start_fixed ? <span className="badge">고정</span> : null}
                </td>
                <td className="c">{fmtDT(s.end_datetime_estimated)}</td>
                <td className="c">{fmtDT(s.end_datetime_real)}</td>
                <td>{['W', 'C'].includes(s.work_stat) && can(s) &&
                  <button className="danger" onClick={() => del(s.workschid)}>삭제</button>}</td>
              </tr>
            )
          })}
          {filtered.length === 0 && <tr><td colSpan="12" className="empty">스케줄이 없습니다</td></tr>}
        </tbody>
      </table>
      <p className="hint">
        우선순위·예상시간·작업자 수정 후 [재적용]을 누르면 대기중(W) 작업의
        시작/종료일시가 작업자별 우선순위 순으로 재계산됩니다.
        시작일시 셀을 클릭하면 수동 설정(고정)할 수 있습니다.
      </p>
      {startForm && (
        <div className="popup" onClick={() => setStartForm(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>시작일시 설정</h3>
            <form className="holiday-form" onSubmit={saveStart}>
              <label>시작일시
                <input type="datetime-local" required value={startForm.start}
                  onChange={e => setStartForm({ ...startForm, start: e.target.value })} />
              </label>
              <div className="popup-btns">
                <button type="submit" className="primary">저장</button>
                {startForm.fixed &&
                  <button type="button" onClick={unfixStart}>고정 해제</button>}
                <button type="button" onClick={() => setStartForm(null)}>취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
