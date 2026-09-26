import { useCallback, useEffect, useRef, useState } from 'react'
import api, { fmtDT, STAT_LABEL, DAY_STAT_LABEL, GRADE_LABEL, NEXT_STAT,
  loadFilter, saveFilter } from '../api'
import TaskDetailPopup from '../TaskDetailPopup'

const TABS = [
  { key: 'users', label: '사용자', adminOnly: true },
  { key: 'sites', label: '사이트', adminOnly: true },
  { key: 'tasks', label: '작업' },
  { key: 'calendar', label: '달력', adminOnly: true },
  { key: 'holidays', label: '작업자휴가' },
  { key: 'schedules', label: '작업스케줄' },
  { key: 'schedhis', label: '스케줄이력' },
  { key: 'files', label: '첨부파일' },
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
      {tab === 'schedhis' && <SchedHisTab />}
      {tab === 'files' && <AttachFilesTab />}
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

/* ---------------- 엑셀 다운/업로드 공통 ---------------- */
const csvEsc = v => `"${(v ?? '').toString().replaceAll('"', '""')}"`

function downloadCsv(name, cols, rows) {
  const csv = '﻿' + [
    cols.map(c => csvEsc(c.label)).join(','),
    cols.map(c => csvEsc(c.field)).join(','),   // 테이블 컬럼명 라인
    ...rows.map(r => cols.map(c => csvEsc(c.get ? c.get(r) : r[c.field])).join(',')),
  ].join('\r\n')
  const now = new Date(), p2 = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `_${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${name}_${stamp}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 따옴표 이스케이프/셀 내 개행을 지원하는 CSV 파서
function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const rows = [[]]
  let cell = '', inQ = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQ = false
      else cell += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { rows[rows.length - 1].push(cell); cell = '' }
    else if (ch === '\n') { rows[rows.length - 1].push(cell); rows.push([]); cell = '' }
    else if (ch !== '\r') cell += ch
  }
  rows[rows.length - 1].push(cell)
  return rows
}

// cols: [{label, field, get?}] — 헤더 라벨로 업로드 파일의 컬럼을 매칭
function ExcelButtons({ name, cols, rows, onUpload, onDone }) {
  const fileRef = useRef(null)
  const [help, setHelp] = useState(false)
  const onFile = async e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!/\.csv$/i.test(f.name)) {
      alert('엑셀 파일(.xlsx)은 지원하지 않습니다.\n' +
        '엑셀에서 [다른 이름으로 저장] → "CSV UTF-8"로 저장한 뒤 업로드하세요.')
      return
    }
    // 헤더 행은 한글 라벨 또는 테이블 컬럼명(field) 둘 다 인식
    const matchRow = row => row.map(h =>
      cols.find(c => c.label === h.trim() || c.field === h.trim())?.field)
    // UTF-8로 먼저 읽고, 헤더가 하나도 안 맞으면 EUC-KR(엑셀 ANSI 저장)로 재시도
    const buf = await f.arrayBuffer()
    let table = parseCsv(new TextDecoder('utf-8').decode(buf))
    let hi = table.findIndex(r => matchRow(r).some(Boolean))
    if (hi < 0) {
      table = parseCsv(new TextDecoder('euc-kr').decode(buf))
      hi = table.findIndex(r => matchRow(r).some(Boolean))
    }
    if (hi < 0) {
      alert('헤더가 이 화면의 다운로드 형식과 다릅니다.\n엑셀 다운로드한 파일을 수정해 업로드하세요.')
      return
    }
    const map = matchRow(table[hi])
    const objs = table.slice(hi + 1)
      .filter(r => r.some(v => v.trim() !== ''))
      // 헤더 바로 아래의 컬럼명 라인은 데이터에서 제외
      .filter(r => !r.every((v, i) => !map[i] || v.trim() === map[i]))
      .map(r => Object.fromEntries(
        map.map((f, i) => [f, (r[i] ?? '').trim()]).filter(([f]) => f)))
    if (!objs.length) { alert('업로드할 데이터가 없습니다'); return }
    if (!window.confirm(`${objs.length}건 업로드 (키값 존재 시 수정, 없으면 신규등록). 계속?`)) return
    let ok = 0
    const fails = []
    for (const o of objs) {
      try { await onUpload(o); ok++ }
      catch (e) { fails.push(errMsg(e)) }
    }
    alert(`업로드 완료: 성공 ${ok}건` +
      (fails.length ? ` / 실패 ${fails.length}건\n실패 사유:\n` +
        [...new Set(fails)].slice(0, 5).join('\n') : ''))
    onDone?.()
  }
  return (
    <>
      <button className="excel" onClick={() => downloadCsv(name, cols, rows)}
        disabled={!rows.length}>엑셀 다운로드</button>
      {onUpload && (
        <>
          <button onClick={() => fileRef.current?.click()}>엑셀 업로드</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          <button className="link" onClick={() => setHelp(true)}>업로드시 주의사항</button>
        </>
      )}
      {help && (
        <div className="popup" onClick={() => setHelp(false)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>업로드시 주의사항</h3>
            <div className="popup-info">
              <p><b>파일 형식</b> CSV 파일만 업로드 가능 (.xlsx 불가)</p>
              <p><b>저장 방법</b> 엑셀에서 [다른 이름으로 저장] → "CSV UTF-8" 선택 권장
                (ANSI 저장도 자동 인식되지만 한글 깨짐 방지를 위해 UTF-8 권장)</p>
              <p><b>헤더</b> 엑셀 다운로드한 파일의 한글 라벨/컬럼명 행을 그대로 유지</p>
              <p><b>키값</b> ID 컬럼 값이 있으면 수정, 없으면 신규등록 처리</p>
              <p><b>ID 입력</b> 담당자·작업자·사이트는 "~ID" 컬럼에 ID값 입력
                ((참조) 컬럼은 무시됨)</p>
            </div>
            <div className="popup-btns">
              <button onClick={() => setHelp(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const revMap = m => Object.fromEntries(Object.entries(m).map(([k, l]) => [l, k]))
// API 오류 응답을 사용자 메시지로 변환
const errMsg = e => {
  const d = e.response?.data?.detail
  if (typeof d === 'string') return d
  return d ? JSON.stringify(d) : (e.message || '처리 중 오류가 발생했습니다')
}
// 'YYYY-MM-DD HH:mm' → ISO(초 포함). 형식이 맞지 않으면 null
const dtOf = v => {
  const s = (v || '').trim().replace(' ', 'T')
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) + ':00' : null
}

/* ---------------- 사용자 ---------------- */
function UsersTab() {
  const empty = { userid: '', user_name: '', dept_name: '', job_title: '',
    user_tel: '', user_email: '', user_grade: 9, user_stat: 'Y', password: '',
    default_siteid: '' }
  const [rows, setRows] = useState([])
  const [sites, setSites] = useState([])
  const [form, setForm] = useState(empty)
  const [q, setQ] = useState('')
  const [statF, setStatF] = useState('')
  const load = useCallback(() => api.get('/users').then(r => setRows(r.data)), [])
  useEffect(() => {
    load()
    api.get('/sites').then(r => setSites(r.data))
  }, [load])

  const save = (id, patch) => api.put(`/users/${id}`, patch).then(load).catch(e => alert(errMsg(e)))
  const add = async e => {
    e.preventDefault()
    try {
      await api.post('/users', form)
      setForm(empty); load()
    } catch (e) { alert(errMsg(e)) }
  }
  const revGrade = revMap(GRADE_LABEL)
  const cols = [
    { label: 'ID', field: 'userid' },
    { label: '이름', field: 'user_name' },
    { label: '부서', field: 'dept_name' },
    { label: '직급', field: 'job_title' },
    { label: '연락처', field: 'user_tel' },
    { label: '이메일', field: 'user_email' },
    { label: '등급', field: 'user_grade', get: u => GRADE_LABEL[u.user_grade] ?? u.user_grade },
    { label: '기본사이트ID', field: 'default_siteid' },
    { label: '상태', field: 'user_stat' },
  ]
  const upload = async o => {
    if (!o.userid) throw new Error('ID 없음')
    const body = {
      user_name: o.user_name,
      dept_name: o.dept_name || null,
      job_title: o.job_title || null,
      user_tel: o.user_tel || null,
      user_email: o.user_email || null,
      user_grade: o.user_grade === '' ? 9 : +(revGrade[o.user_grade] ?? o.user_grade),
      user_stat: o.user_stat || 'Y',
      default_siteid: o.default_siteid || null,
    }
    const r = rows.some(u => u.userid === o.userid)
      ? await api.put(`/users/${o.userid}`, body)
      : await api.post('/users', { ...body, userid: o.userid })
    return r
  }

  const shown = rows.filter(u =>
    (!statF || u.user_stat === statF) &&
    (!q || [u.userid, u.user_name, u.dept_name, u.job_title, u.user_tel, u.user_email]
      .some(v => (v || '').toLowerCase().includes(q.toLowerCase()))))

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
        <select value={form.default_siteid}
          onChange={e => setForm({ ...form, default_siteid: e.target.value })}>
          <option value="">기본사이트</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <button type="submit">추가</button>
      </form>
      <div className="toolbar">
        <input placeholder="검색 (ID/이름/부서/직급/연락처/이메일)" value={q}
          onChange={e => setQ(e.target.value)} />
        <select value={statF} onChange={e => setStatF(e.target.value)}>
          <option value="">전체 상태</option>
          <option value="Y">Y (활성)</option>
          <option value="A">A (승인대기)</option>
          <option value="R">R (승인불가)</option>
          <option value="N">N (비활성)</option>
        </select>
        <ExcelButtons name="사용자" cols={cols} rows={shown}
          onUpload={upload} onDone={load} />
      </div>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>이름</th><th>부서</th><th>직급</th><th>연락처</th>
          <th>이메일</th><th>등급</th><th>기본사이트</th><th>비밀번호</th><th>상태</th><th></th>
        </tr></thead>
        <tbody>
          {shown.map(u => (
            <tr key={u.userid}>
              <td>{u.userid}</td>
              <td className="c"><EditableCell value={u.user_name} onSave={v => save(u.userid, { user_name: v })} /></td>
              <td><EditableCell value={u.dept_name} onSave={v => save(u.userid, { dept_name: v })} /></td>
              <td><EditableCell value={u.job_title} onSave={v => save(u.userid, { job_title: v })} /></td>
              <td><EditableCell value={u.user_tel} onSave={v => save(u.userid, { user_tel: v })} /></td>
              <td><EditableCell value={u.user_email} onSave={v => save(u.userid, { user_email: v })} /></td>
              <td><EditableCell value={u.user_grade} onSave={v => save(u.userid, { user_grade: v })}
                options={Object.entries(GRADE_LABEL).map(([k, l]) => ({ value: +k, label: l }))} /></td>
              <td className="c"><EditableCell value={u.default_siteid}
                onSave={v => save(u.userid, { default_siteid: v || null })}
                options={[{ value: '', label: '-' },
                  ...sites.map(s => ({ value: s.siteid, label: s.site_name }))]} /></td>
              <td className="c">
                <button onClick={() => {
                  const pw = window.prompt(`${u.user_name || u.userid} 새 비밀번호`)
                  if (pw) save(u.userid, { password: pw })
                }}>변경</button>
                <button onClick={() =>
                  window.confirm(`${u.user_name || u.userid} 비밀번호를 초기값(1234)으로 초기화?`) &&
                  api.post(`/users/${u.userid}/password-reset`)
                    .then(() => alert('비밀번호가 초기화되었습니다 (1234)'))
                    .catch(e => alert(e.response?.data?.detail || '초기화 실패'))
                }>초기화</button>
              </td>
              <td className="c" title={u.reject_remark ? `승인불가 사유: ${u.reject_remark}` : ''}>
                <EditableCell value={u.user_stat} onSave={v => save(u.userid, { user_stat: v })}
                  options={[{ value: 'Y', label: 'Y' }, { value: 'A', label: '승인대기(A)' },
                            { value: 'R', label: '승인불가(R)' }, { value: 'N', label: 'N' }]} /></td>
              <td>
                {u.user_stat === 'A' && <>
                  <button onClick={() => save(u.userid, { user_stat: 'Y' })}>승인</button>
                  <button onClick={() => {
                    const r = window.prompt('승인불가 사유를 입력하세요 (빈칸 가능)')
                    if (r === null) return
                    save(u.userid, { user_stat: 'R', reject_remark: r || null })
                  }}>승인불가</button>
                </>}
              </td>
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

  const save = (id, patch) => api.put(`/sites/${id}`, patch).then(load).catch(e => alert(errMsg(e)))
  const add = async e => {
    e.preventDefault()
    try {
      await api.post('/sites', form)
      setForm(empty); load()
    } catch (e) { alert(errMsg(e)) }
  }
  const del = id => window.confirm(`사이트 ${id} 삭제?`) &&
    api.delete(`/sites/${id}`).then(load).catch(e => alert(errMsg(e)))

  const cols = [
    { label: '사이트ID', field: 'siteid' },
    { label: '사이트명', field: 'site_name' },
    { label: '설명', field: 'site_remark' },
    { label: 'IT담당자ID', field: 'itos_userid' },
    { label: '상태', field: 'site_stat' },
  ]
  const upload = async o => {
    if (!o.siteid) throw new Error('사이트ID 없음')
    const body = {
      site_name: o.site_name,
      site_remark: o.site_remark || null,
      itos_userid: o.itos_userid || null,
      site_stat: o.site_stat || 'Y',
    }
    return rows.some(s => s.siteid === o.siteid)
      ? api.put(`/sites/${o.siteid}`, body)
      : api.post('/sites', { ...body, siteid: o.siteid })
  }

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
      <div className="toolbar">
        <ExcelButtons name="사이트" cols={cols} rows={rows}
          onUpload={upload} onDone={load} />
      </div>
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
  const [savedF] = useState(() => loadFilter('admin-tasks'))
  const [q, setQ] = useState(savedF.q || '')
  const [siteF, setSiteF] = useState(savedF.site || '')
  const [statF, setStatF] = useState(savedF.stat || '')
  const [selTask, setSelTask] = useState(null)
  const load = useCallback(() => api.get('/tasks').then(r => setRows(r.data)), [])
  useEffect(() => {
    load()
    api.get('/users').then(r => setUsers(r.data))
    api.get('/sites').then(r => setSites(r.data))
  }, [load])

  const save = (id, patch) => api.put(`/tasks/${id}`, patch).then(load).catch(e => alert(errMsg(e)))
  const add = async e => {
    e.preventDefault()
    try {
      await api.post('/tasks', form)
      setForm(empty); load()
    } catch (e) { alert(errMsg(e)) }
  }
  const del = id => window.confirm(`작업 #${id} 삭제?`) &&
    api.delete(`/tasks/${id}`).then(load).catch(e => alert(errMsg(e)))

  const admin = isAdmin()
  const can = t => admin || t.work_userid === myId()
  const statOpt = Object.entries(STAT_LABEL).map(([k, l]) => ({ value: k, label: l }))
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
  })).filter(t =>
    (!siteF || t.siteid === siteF) && (!statF || t.task_stat === statF))
    .filter(t => admin || t.work_userid === myId())  // 비관리자: 본인 작업만

  const revStat = revMap(STAT_LABEL)
  const cols = [
    { label: 'ID', field: 'taskid' },
    { label: '사이트ID', field: 'siteid' },
    { label: '사이트(참조)', field: '_site_name', get: t => t.site_name || '' },
    { label: '작업명', field: 'task_name' },
    { label: '우선순위', field: 'priority' },
    { label: '예상 작업시간(H)', field: 'work_hours_estimated' },
    { label: '실제 작업시간(H)', field: 'work_hours_real' },
    { label: '상태', field: 'task_stat', get: t => STAT_LABEL[t.task_stat] ?? t.task_stat },
    { label: 'CSR 번호', field: 'task_csrid' },
    { label: '현업 담당자(참조)', field: '_req_name', get: t => t.req_user_name || '' },
    { label: '현업 담당자ID', field: 'req_userid' },
    { label: 'IT업무 담당자(참조)', field: '_itos_name', get: t => t.itos_user_name || '' },
    { label: 'IT업무 담당자ID', field: 'itos_userid' },
    { label: '작업자(참조)', field: '_work_name', get: t => t.work_user_name || '' },
    { label: '작업자ID', field: 'work_userid' },
    { label: '작업요청내용', field: 'task_req_remark' },
    { label: '작업시작일시', field: 'task_start_date', get: t => fmtDT(t.task_start_date) },
    { label: '작업종료일시', field: 'task_end_date', get: t => fmtDT(t.task_end_date) },
    { label: '생성일시', field: 'create_date', get: t => fmtDT(t.create_date) },
  ]
  const upload = async o => {
    const body = {
      task_name: o.task_name,
      siteid: o.siteid || null,
      priority: +o.priority || 0,
      work_hours_estimated: +o['work_hours_estimated'] || 0,
      work_hours_real: +o.work_hours_real || 0,
      task_stat: revStat[o.task_stat] ?? o.task_stat ?? 'W',
      task_csrid: o.task_csrid || null,
      task_req_remark: o.task_req_remark || null,
      task_start_date: dtOf(o.task_start_date),
      task_end_date: dtOf(o.task_end_date),
      req_userid: o.req_userid || null,
      itos_userid: o.itos_userid || null,
      work_userid: o.work_userid || null,
    }
    const id = +o.taskid
    return (Number.isInteger(id) && id > 0 && rows.some(t => t.taskid === id))
      ? api.put(`/tasks/${id}`, body)
      : api.post('/tasks', body)
  }

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
        <select value={siteF} onChange={e => setSiteF(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <select value={statF} onChange={e => setStatF(e.target.value)}>
          <option value="">상태(전체)</option>
          {statOpt.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input placeholder="검색 (작업명/사이트/담당자/작업자/상태/CSR)" value={q}
          onChange={e => setQ(e.target.value)} />
        <button onClick={() => {
          saveFilter('admin-tasks', { site: siteF, stat: statF, q })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
        <ExcelButtons name="작업" cols={cols} rows={filtered}
          onUpload={admin ? upload : null} onDone={load} />
      </div>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>사이트</th><th>작업명</th><th className="fit">우선<br/>순위</th><th className="fit">예상 작업<br/>시간(H)</th><th className="fit">실제 작업<br/>시간(H)</th>
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
              <td className="r fit"><EditableCell type="number" value={t.priority} disabled={!can(t)}
                onSave={v => save(t.taskid, { priority: v })} /></td>
              <td className="r fit"><EditableCell type="number" value={t.work_hours_estimated} disabled={!can(t)}
                onSave={v => save(t.taskid, { work_hours_estimated: v })} /></td>
              <td className="r fit"><EditableCell type="number" value={t.work_hours_real} disabled={!can(t)}
                onSave={v => save(t.taskid, { work_hours_real: v })} /></td>
              <td className="c"><EditableCell value={t.task_stat} disabled={!can(t)}
                onSave={v => save(t.taskid, { task_stat: v })}
                options={statOpt.filter(o => NEXT_STAT[t.task_stat]?.includes(o.value))} /></td>
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
              <td>
                <button onClick={() => setSelTask(t)}>상세</button>
                {['W', 'C', 'D'].includes(t.task_stat) && can(t) &&
                  <button className="danger" onClick={() => del(t.taskid)}>삭제</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selTask && <TaskDetailPopup task={selTask} onClose={() => setSelTask(null)} onChanged={load} />}
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

  const save = (dateid, patch) => api.put(`/calendar/${dateid}`, patch).then(load).catch(e => alert(errMsg(e)))
  const generate = () =>
    api.post(`/calendar/generate?year=${year}`).then(r => {
      alert(`${r.data.created}일 생성`); load()
    }).catch(e => alert(errMsg(e)))

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
  const [year, setYear] = useState(today.getFullYear())
  const [rows, setRows] = useState([])
  const [users, setUsers] = useState([])
  const [filterUser, setFilterUser] = useState('')
  const admin = isAdmin()
  const can = h => admin || h.work_userid === myId()
  const empty = { date: '', work_userid: admin ? '' : (myId() || ''),
    holiday_category: 'A', holiday_hours: 4, holiday_remark: '' }
  const [form, setForm] = useState(empty)

  const load = useCallback(() => {
    if (!(year >= 1000 && year <= 9999)) return
    const params = {
      start: `${year}0101`,
      end: `${year}1231`,
    }
    const uid = admin ? filterUser : myId()   // 비관리자: 본인 휴가만 조회
    if (uid) params.work_userid = uid
    api.get('/user-holidays', { params }).then(r => setRows(r.data))
  }, [year, filterUser, admin])
  useEffect(() => {
    load()
    api.get('/users').then(r => setUsers(r.data))
  }, [load])

  const save = (h, patch) =>
    api.put(`/user-holidays/${h.dateid}/${h.work_userid}`, patch).then(load).catch(e => alert(errMsg(e)))

  const add = async e => {
    e.preventDefault()
    if (!form.date || !form.work_userid) return
    try {
      await api.post('/user-holidays', {
        dateid: form.date.replaceAll('-', ''),
        work_userid: form.work_userid,
        holiday_category: form.holiday_category,
        holiday_hours: form.holiday_category === 'P' ? +form.holiday_hours : 0,
        holiday_remark: form.holiday_remark,
      })
      setForm(empty); load()
    } catch (e) { alert(errMsg(e)) }
  }
  const del = h => window.confirm(`${h.dateid} ${h.user_name || h.work_userid} 휴가 삭제?`) &&
    api.delete(`/user-holidays/${h.dateid}/${h.work_userid}`).then(load).catch(e => alert(errMsg(e)))

  const catOptions = Object.entries(HOL_CAT_LABEL).map(([k, l]) => ({ value: k, label: l }))
  const userOptions = [{ value: '', label: '작업자(전체)' },
    ...users.filter(u => u.user_grade === 1)
      .map(u => ({ value: u.userid, label: u.user_name }))]

  return (
    <div>
      <form className="newtask" onSubmit={add}>
        <input type="date" required value={form.date}
          onChange={e => setForm({ ...form, date: e.target.value })} />
        {admin && (
          <select required value={form.work_userid}
            onChange={e => setForm({ ...form, work_userid: e.target.value })}>
            <option value="">작업자 선택</option>
            {users.filter(u => u.user_grade === 1)
              .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
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
        <input type="number" className="num" value={year}
          onChange={e => setYear(+e.target.value)} style={{ width: 90 }} />
        <span className="hint">년</span>
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
  const [sites, setSites] = useState([])
  const [startForm, setStartForm] = useState(null)  // {workschid, start, fixed} 시작일시 팝업
  const [selTask, setSelTask] = useState(null)
  const [msg, setMsg] = useState('')
  const [savedF] = useState(() => loadFilter('admin-schedules'))
  const [q, setQ] = useState(savedF.q || '')
  const [siteF, setSiteF] = useState(savedF.site || '')
  const [statF, setStatF] = useState(savedF.stat || '')
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
    api.get('/sites').then(r => setSites(r.data))
  }, [load])

  const taskOf = id => tasks.find(t => t.taskid === id)

  const saveSched = (id, patch) => api.put(`/schedules/${id}`, patch).then(load).catch(e => alert(errMsg(e)))
  const saveTask = (taskid, patch) => api.put(`/tasks/${taskid}`, patch).then(load).catch(e => alert(errMsg(e)))

  const add = async e => {
    e.preventDefault()
    try {
      await api.post('/schedules', { ...form, taskid: +form.taskid })
      setForm(empty); load()
    } catch (e) { alert(errMsg(e)) }
  }
  const del = id => window.confirm(`스케줄 #${id} 삭제?`) &&
    api.delete(`/schedules/${id}`).then(load).catch(e => alert(errMsg(e)))

  const recalc = async () => {
    try {
      const { data } = await api.post('/tasks/recalculate')
      setMsg(`재계산 완료: ${data.updated}건 반영` +
        (data.created ? ` (스케줄 신규 추가 ${data.created}건)` : ''))
      load()
    } catch (e) { alert(errMsg(e)) }
  }

  const saveStart = async e => {
    e.preventDefault()
    if (!startForm?.start) return
    try {
      await api.patch(`/schedules/${startForm.workschid}/start`, {
        // 로컬 naive 시각 그대로 전송 (toISOString은 UTC로 밀림)
        start_datetime: startForm.start.length === 16 ? startForm.start + ':00' : startForm.start,
      })
      setStartForm(null)
      load()
    } catch (e) { alert(errMsg(e)) }
  }
  const unfixStart = async () => {
    try {
      await api.patch(`/schedules/${startForm.workschid}/unfix`)
      setStartForm(null)
      load()
    } catch (e) { alert(errMsg(e)) }
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
  })).filter(s =>
    (!siteF || taskOf(s.taskid)?.siteid === siteF) &&
    (!statF || s.work_stat === statF))
    .filter(s => admin || s.work_userid === myId())  // 비관리자: 본인 스케줄만

  const revStat = revMap(STAT_LABEL)
  const cols = [
    { label: 'ID', field: 'workschid' },
    { label: '작업ID', field: 'taskid' },
    { label: '작업명(참조)', field: '_task_name', get: s => taskOf(s.taskid)?.task_name || '' },
    { label: '작업자ID', field: 'work_userid' },
    { label: '작업자(참조)', field: '_work_name', get: s => userName(s.work_userid) || '' },
    { label: '상태', field: 'work_stat', get: s => STAT_LABEL[s.work_stat] ?? s.work_stat },
    { label: '작업내용', field: 'work_remark' },
    { label: '시작일시', field: 'start_datetime', get: s => fmtDT(s.start_datetime) },
    { label: '종료일시(예상)', field: 'end_datetime_estimated', get: s => fmtDT(s.end_datetime_estimated) },
    { label: '종료일시(실제)', field: 'end_datetime_real', get: s => fmtDT(s.end_datetime_real) },
    { label: '작업요청내용(참조)', field: '_req_remark',
      get: s => taskOf(s.taskid)?.task_req_remark || '' },
    { label: '작업시작일시(참조)', field: '_task_start',
      get: s => fmtDT(taskOf(s.taskid)?.task_start_date) },
    { label: '작업종료일시(참조)', field: '_task_end',
      get: s => fmtDT(taskOf(s.taskid)?.task_end_date) },
    { label: '생성일시', field: 'create_date', get: s => fmtDT(s.create_date) },
  ]
  const upload = async o => {
    const body = {
      work_userid: o.work_userid || null,
      work_stat: revStat[o.work_stat] ?? o.work_stat ?? 'W',
      work_remark: o.work_remark || null,
      start_datetime: dtOf(o.start_datetime),
      start_fixed: o.start_datetime ? 1 : 0,
      end_datetime_estimated: dtOf(o.end_datetime_estimated),
      end_datetime_real: dtOf(o.end_datetime_real),
    }
    const id = +o.workschid
    return (Number.isInteger(id) && id > 0 && rows.some(s => s.workschid === id))
      ? api.put(`/schedules/${id}`, body)
      : api.post('/schedules', { ...body, taskid: +o.taskid })
  }

  return (
    <div>
      <div className="toolbar">
        {msg && <span className="msg">{msg}</span>}
        <ExcelButtons name="작업스케줄" cols={cols} rows={filtered}
          onUpload={admin ? upload : null} onDone={load} />
        <button className="primary" onClick={recalc}>재적용(재계산)</button>
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
        <select value={siteF} onChange={e => setSiteF(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <select value={statF} onChange={e => setStatF(e.target.value)}>
          <option value="">상태(전체)</option>
          {statOpt.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input placeholder="검색 (작업명/사이트/작업자/내용/상태)" value={q}
          onChange={e => setQ(e.target.value)} />
        <button onClick={() => {
          saveFilter('admin-schedules', { site: siteF, stat: statF, q })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
      </div>
      <table className="grid">
        <thead><tr>
          <th>ID</th><th>사이트</th><th className="fit">우선<br/>순위</th><th>작업</th><th className="fit">예상 작업<br/>시간(Hour)</th><th>작업자</th>
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
                <td className="r fit"><EditableCell type="number" value={t?.priority ?? ''} disabled={!can(s)}
                  onSave={v => t && saveTask(t.taskid, { priority: v })} /></td>
                <td><EditableCell value={s.taskid} disabled={!admin}
                  onSave={v => saveSched(s.workschid, { taskid: v })}
                  options={topt} /></td>
                <td className="r fit"><EditableCell type="number" value={t?.work_hours_estimated ?? ''} disabled={!can(s)}
                  onSave={v => t && saveTask(t.taskid, { work_hours_estimated: v })} /></td>
                <td className="c"><EditableCell value={s.work_userid} disabled={!admin}
                  onSave={v => saveSched(s.workschid, { work_userid: v })}
                  options={woptFor(s.work_userid)} /></td>
                <td className="c"><EditableCell value={s.work_stat} disabled={!can(s)}
                  onSave={v => saveSched(s.workschid, { work_stat: v })}
                  options={statOpt.filter(o => NEXT_STAT[s.work_stat]?.includes(o.value))} /></td>
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
                <td>
                  {t && <button onClick={() => setSelTask(t)}>상세</button>}
                  {['W', 'C', 'D'].includes(s.work_stat) && can(s) &&
                    <button className="danger" onClick={() => del(s.workschid)}>삭제</button>}
                </td>
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
      {selTask && <TaskDetailPopup task={selTask} onClose={() => setSelTask(null)} onChanged={load} />}
    </div>
  )
}

/* ---------------- 작업스케줄 이력 ---------------- */
function SchedHisTab() {
  const admin = isAdmin()
  const [rows, setRows] = useState([])
  const [tasks, setTasks] = useState([])
  const [q, setQ] = useState('')
  const [selTask, setSelTask] = useState(null)
  const load = useCallback(async () => {
    const { data } = await api.get('/schedules/his')
    setRows(data)
  }, [])
  useEffect(() => { load().catch(e => alert(errMsg(e))) }, [load])
  useEffect(() => {
    api.get('/tasks').then(r => setTasks(r.data)).catch(console.error)
  }, [])
  const taskOf = id => tasks.find(t => t.taskid === id)
  const delHis = id => window.confirm(`이력 #${id} 삭제?`) &&
    api.delete(`/schedules/his/${id}`).then(load).catch(e => alert(errMsg(e)))
  const delAll = () => window.confirm(
    '모든 스케줄이력을 삭제하시겠습니까? 복구할 수 없습니다') &&
    api.delete('/schedules/his').then(load).catch(e => alert(errMsg(e)))

  const kw = q.trim().toLowerCase()
  const filtered = rows.filter(r => !kw ||
    [r.workschid, r.taskid, r.task_name, r.work_userid,
     STAT_LABEL[r.work_stat], r.remark]
      .some(v => (v ?? '').toString().toLowerCase().includes(kw)))

  const cols = [
    { label: '이력ID', field: 'workschhisid' },
    { label: '스케줄ID', field: 'workschid' },
    { label: '작업ID', field: 'taskid' },
    { label: '작업명(참조)', field: '_task_name', get: r => r.task_name || '' },
    { label: '작업자', field: 'work_userid' },
    { label: '변경상태', field: 'work_stat', get: r => STAT_LABEL[r.work_stat] ?? r.work_stat },
    { label: '작업기간(H)', field: 'work_hours' },
    { label: '비고', field: 'remark' },
    { label: '등록일시', field: 'create_date', get: r => fmtDT(r.create_date) },
  ]

  return (
    <div>
      <div className="toolbar">
        <input placeholder="검색 (스케줄ID/작업/작업자/상태/비고)" value={q}
          onChange={e => setQ(e.target.value)} />
        <ExcelButtons name="스케줄이력" cols={cols} rows={filtered} />
        {admin && rows.length > 0 &&
          <button className="danger" onClick={delAll}>전체삭제</button>}
      </div>
      <table className="grid">
        <thead><tr>
          <th>이력ID</th><th>스케줄ID</th><th>작업</th><th>작업자</th>
          <th>변경상태</th><th className="r">작업기간<br/>(Hour)</th><th>비고</th><th>등록일시</th>
          {admin && <th></th>}
        </tr></thead>
        <tbody>
          {filtered.map(r => (
            <tr key={r.workschhisid}>
              <td className="r">{r.workschhisid}</td>
              <td className="r">{r.workschid}</td>
              <td>{taskOf(r.taskid)
                ? <button className="link" onClick={() => setSelTask(taskOf(r.taskid))}>
                    {r.task_name || `작업#${r.taskid}`}</button>
                : (r.task_name || `작업#${r.taskid}` || '-')}</td>
              <td>{r.work_userid || '-'}</td>
              <td className="c">{STAT_LABEL[r.work_stat] ?? r.work_stat}</td>
              <td className="r">{r.work_hours || 0}</td>
              <td>{r.remark || ''}</td>
              <td className="c">{fmtDT(r.create_date)}</td>
              {admin &&
                <td><button className="danger"
                  onClick={() => delHis(r.workschhisid)}>삭제</button></td>}
            </tr>
          ))}
          {filtered.length === 0 &&
            <tr><td colSpan={admin ? 9 : 8} className="empty">이력이 없습니다</td></tr>}
        </tbody>
      </table>
      <p className="hint">
        작업상태 변경 시마다 자동 기록됩니다. 작업기간은 작업중(P) 구간이
        종료(보류/완료 등)될 때 해당 P 이력행에 기록됩니다.
      </p>
      {selTask && <TaskDetailPopup task={selTask} onClose={() => setSelTask(null)} onChanged={load} />}
    </div>
  )
}

/* ---------------- 첨부파일 ---------------- */
function AttachFilesTab() {
  const admin = isAdmin(), me = myId()
  const [rows, setRows] = useState([])
  const [tasks, setTasks] = useState([])
  const [scheds, setScheds] = useState([])
  const [q, setQ] = useState('')
  const [selTask, setSelTask] = useState(null)
  const [form, setForm] = useState({ taskid: '', workschid: '' })
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    const { data } = await api.get('/attach-files')
    setRows(data)
  }, [])
  useEffect(() => { load().catch(e => alert(errMsg(e))) }, [load])
  useEffect(() => {
    api.get('/tasks').then(r => setTasks(r.data)).catch(console.error)
    api.get('/schedules').then(r => setScheds(r.data)).catch(console.error)
  }, [])

  const taskOf = id => tasks.find(t => t.taskid === id)
  const canEdit = f => admin || (f.work_userid && f.work_userid === me)
  const kw = q.trim().toLowerCase()
  const filtered = rows.filter(f => !kw ||
    [f.file_name, f.task_name, f.task_filepath, f.taskid, f.workschid]
      .some(v => (v ?? '').toString().toLowerCase().includes(kw)))
  const taskScheds = scheds.filter(s => s.taskid === +form.taskid)

  const save = (fileid, patch) =>
    api.put(`/attach-files/${fileid}`, patch).then(load)
      .catch(e => alert(errMsg(e)))

  const upload = async e => {
    e.preventDefault()
    const f = fileRef.current?.files?.[0]
    if (!f) { alert('업로드할 파일을 선택하세요'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('taskid', form.taskid)
    if (form.workschid) fd.append('workschid', form.workschid)
    try {
      await api.post('/attach-files', fd)
      setForm({ ...form, workschid: '' })
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (ex) { alert(errMsg(ex)) }
  }

  const download = f =>
    api.get(`/attach-files/${f.fileid}/download`, { responseType: 'blob' })
      .then(r => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(r.data)
        a.download = f.file_name
        a.click()
        URL.revokeObjectURL(a.href)
      }).catch(e => alert(errMsg(e)))

  const del = f => {
    if (!confirm(`첨부파일 '${f.file_name}'을(를) 삭제할까요?`)) return
    api.delete(`/attach-files/${f.fileid}`).then(load)
      .catch(e => alert(errMsg(e)))
  }

  const cols = [
    { label: '파일ID', field: 'fileid' },
    { label: '파일명', field: 'file_name' },
    { label: '작업ID', field: 'taskid' },
    { label: '작업명(참조)', field: '_task_name', get: f => f.task_name || '' },
    { label: '스케줄ID', field: 'workschid' },
    { label: '첨부파일경로', field: 'task_filepath' },
    { label: '등록일시', field: 'create_date', get: f => fmtDT(f.create_date) },
  ]
  const uploadCsv = async o => {
    const body = {
      file_name: o.file_name,
      taskid: +o.taskid || null,
      workschid: +o.workschid || null,
      task_filepath: o.task_filepath || null,
    }
    const id = +o.fileid
    return (Number.isInteger(id) && id > 0 && rows.some(f => f.fileid === id))
      ? api.put(`/attach-files/${id}`, body)
      : api.post('/attach-files/meta', body)
  }

  return (
    <div>
      <div className="toolbar">
        <ExcelButtons name="첨부파일" cols={cols} rows={filtered}
          onUpload={admin ? uploadCsv : null} onDone={load} />
        <input placeholder="검색 (파일명/작업/경로)" value={q}
          onChange={e => setQ(e.target.value)} />
      </div>
      <form className="newtask" onSubmit={upload}>
        <select required value={form.taskid}
          onChange={e => setForm({ taskid: e.target.value, workschid: '' })}>
          <option value="">작업 선택</option>
          {tasks.map(t => (
            <option key={t.taskid} value={t.taskid}>
              {t.site_name ? `${t.site_name} ` : ''}{t.task_name}
            </option>
          ))}
        </select>
        <select value={form.workschid}
          onChange={e => setForm({ ...form, workschid: e.target.value })}>
          <option value="">스케줄(선택)</option>
          {taskScheds.map(s => (
            <option key={s.workschid} value={s.workschid}>
              #{s.workschid} {fmtDT(s.start_datetime) || '미배치'}
            </option>
          ))}
        </select>
        <input type="file" ref={fileRef} required />
        <button type="submit">업로드</button>
      </form>
      <table className="grid">
        <thead><tr>
          <th>파일ID</th><th>파일명</th><th>작업</th><th className="r">스케줄ID</th>
          <th>첨부파일경로</th><th>등록일시</th><th></th>
        </tr></thead>
        <tbody>
          {filtered.map(f => (
            <tr key={f.fileid}>
              <td className="r">{f.fileid}</td>
              <td><EditableCell value={f.file_name} disabled={!canEdit(f)}
                onSave={v => save(f.fileid, {
                  file_name: v, taskid: f.taskid,
                  workschid: f.workschid, task_filepath: f.task_filepath,
                })} /></td>
              <td>{taskOf(f.taskid)
                ? <button className="link" onClick={() => setSelTask(taskOf(f.taskid))}>
                    {f.task_name || `작업#${f.taskid}`}</button>
                : (f.task_name || (f.taskid ? `작업#${f.taskid}` : '-'))}</td>
              <td className="r">{f.workschid || '-'}</td>
              <td><EditableCell value={f.task_filepath} disabled={!canEdit(f)}
                onSave={v => save(f.fileid, {
                  file_name: f.file_name, taskid: f.taskid,
                  workschid: f.workschid, task_filepath: v,
                })} /></td>
              <td className="c">{fmtDT(f.create_date)}</td>
              <td>
                {f.task_filepath &&
                  <button onClick={() => download(f)}>다운로드</button>}
                {canEdit(f) &&
                  <button className="danger" onClick={() => del(f)}>삭제</button>}
              </td>
            </tr>
          ))}
          {filtered.length === 0 &&
            <tr><td colSpan="7" className="empty">첨부파일이 없습니다</td></tr>}
        </tbody>
      </table>
      <p className="hint">
        [업로드]는 파일을 서버 uploads/ 폴더에 저장합니다.
        외부 경로만 등록하려면 엑셀 업로드(CSV)를 사용하세요.
      </p>
      {selTask && <TaskDetailPopup task={selTask} onClose={() => setSelTask(null)} onChanged={load} />}
    </div>
  )
}
