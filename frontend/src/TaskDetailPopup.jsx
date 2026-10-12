import { useEffect, useRef, useState } from 'react'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import api, { fmtDT, fmtDTS, fmtSize, STAT_LABEL, TASK_TYPE_LABEL, NEXT_STAT,
  taskColor, taskColorComp, uploadWithProgress, downloadFile as dlFile } from './api'
import ProgressBar from './ProgressBar'

// 작업내용 소스 하이라이트: 언어 자동감지, 신뢰도 낮으면 일반 텍스트로
const highlightCode = text => {
  if (!text) return { __html: '' }
  const r = hljs.highlightAuto(text)
  if (r.relevance < 5) return null   // 일반 텍스트로 판단
  return { __html: r.value }
}

// 달력 작업 팝업과 동일한 스타일의 작업 상세 팝업 (칸반/작업목록 공용)
// task: /api/tasks 의 TaskDetail 형태 (task_start_date, task_stat 등 포함)
// 사용자 표기: 이름 직급/팀명 (없으면 ID)
const fmtUser = (name, id, title, dept) => {
  const base = name || id
  if (!base) return '-'
  const extra = [title, dept].filter(Boolean).join('/')
  return extra ? `${base} (${extra})` : base
}

// 값 복사 버튼: 클릭 시 클립보드 복사, 잠시 ✓ 표시
function CopyBtn({ text, title = '복사', bg }) {
  const [ok, setOk] = useState(false)
  const copy = e => {
    e.stopPropagation()
    const done = () => { setOk(true); setTimeout(() => setOk(false), 1200) }
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); done() } catch {}
      ta.remove()
    }
    navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(text).then(done).catch(fallback)
      : fallback()
  }
  return (
    <span className="copy-wrap">
      <button type="button" className={`copy-btn${ok ? ' done' : ''}`} title={title}
        style={bg && !ok ? { background: bg } : undefined}
        onMouseDown={e => e.stopPropagation()} onClick={copy}>
        {ok ? '✓' : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {ok && <span className="copy-toast">복사되었습니다</span>}
    </span>
  )
}

// 팝업 드래그 이동: 타이틀 mousedown -> 창 기준 오프셋을 transform으로 적용
function useDrag() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const onDown = e => {
    if (e.button !== 0) return
    e.preventDefault()
    const base = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    const move = ev => setPos({ x: ev.clientX - base.x, y: ev.clientY - base.y })
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return { pos, onDown }
}

export default function TaskDetailPopup({ task, onClose, onChanged }) {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const canEdit = me && ([0, 1].includes(me.user_grade) ||
    task.work_userid === me.userid ||
    (me.user_grade === 4 && me.default_siteid && task.siteid === me.default_siteid))
  const canAttach = me && [0, 1].includes(me.user_grade)
  const [btab, setBtab] = useState('req')    // 하단 블록 탭: req(요청내용+첨부) | his(작업이력) | chg(상태변경이력)
  const [daily, setDaily] = useState(null)
  const [his, setHis] = useState(null)
  const [logs, setLogs] = useState(null)
  const [logForm, setLogForm] = useState(null)   // {workschid?, work_remark} 작업이력 등록/수정
  const [logView, setLogView] = useState(null)   // 작업내용 상세 팝업
  const isStaff = me && [0, 1].includes(me.user_grade)
  const [files, setFiles] = useState(null)
  const [upPct, setUpPct] = useState(null)           // 업로드 진행률
  const [cfg, setCfg] = useState(null)
  // 작업자의 하루작업시간 — task 객체에 없으면 users 조회로 보완
  const [workHr, setWorkHr] = useState(task.work_hours_day)
  const [reqText, setReqText] = useState(task.task_req_remark || '')
  const [reqEdit, setReqEdit] = useState(null)
  const [tf, setTf] = useState({})               // 팝업 내 수정 반영 (시작/종료/예상/고정)
  const [startEdit, setStartEdit] = useState(null)   // 시작일시 수정 입력값
  const [hoursEdit, setHoursEdit] = useState(null)   // 예상시간 수정 입력값
  const [prioEdit, setPrioEdit] = useState(null)     // 우선순위 수정 입력값
  const [reqDateEdit, setReqDateEdit] = useState(null) // 요청일시 수정 입력값
  const [schedEdit, setSchedEdit] = useState(null)     // 스케쥴적용(Y/N) 수정 입력값
  const [recalcBusy, setRecalcBusy] = useState(false)
  // 수정 제한 항목은 작업요청·검토중·대기중(또는 휴일작업)에서만 변경 가능
  const canEditFields = canEdit &&
    (['R', 'C', 'W'].includes(task.task_stat) || !!task.holiday_work)
  const startDate = tf.task_start_date ?? task.task_start_date
  const endEst = tf.task_end_date_estimated ?? task.task_end_date_estimated
  const startFixed = tf.start_fixed ?? task.start_fixed
  const schedApply = tf.schedule_apply ?? task.schedule_apply ?? 'Y'
  const estHours = tf.work_hours_estimated ?? task.work_hours_estimated
  const prio = tf.priority ?? task.priority
  const fileRef = useRef(null)
  const tabRef = useRef(null)               // 탭 콘텐츠 — 탭 전환 시 높이 유지용
  const [minH, setMinH] = useState(0)       // 지금까지 표시된 최대 높이
  const downOnOverlay = useRef(false)   // mousedown이 오버레이에서 시작됐는지
  const { pos, onDown } = useDrag()           // 메인 팝업 드래그
  const { pos: logPos, onDown: logOnDown } = useDrag()  // 작업내용 팝업 드래그

  useEffect(() => {
    setTf({})   // 다른 작업으로 열릴 때 이전 수정값 초기화
    setBtab('req'); setHis(null); setLogs(null)
    api.get(`/tasks/${task.taskid}/daily`)
      .then(r => setDaily(r.data)).catch(() => setDaily([]))
    api.get('/config').then(r => setCfg(r.data)).catch(() => {})
    // 작업자의 하루시간은 항상 users 조회로 최신값 반영
    // (목록 로딩 후 변경되었거나 필드가 없는 경로로 열린 경우 대비)
    if (task.work_userid)
      api.get('/users').then(r => {
        const u = r.data.find(u => u.userid === task.work_userid)
        if (u) setWorkHr(u.work_hours_day)
      }).catch(() => {})
    loadFiles()   // 첨부파일 목록
    setMinH(0)    // 작업 전환 시 높이 기준 리셋
  }, [task.taskid])

  // 탭 전환으로 내용이 줄어도 팝업 높이는 유지 (탭 콘텐츠의 최대 높이를 min-height로)
  // — 팝업 전체가 아닌 탭 영역에 적용하므로 사용자가 창을 직접 줄이는 것은 가능
  useEffect(() => {
    const h = tabRef.current?.offsetHeight
    if (h && h > minH) setMinH(h)
  })

  const loadLogs = () =>
    api.get('/schedules', { params: { taskid: task.taskid } })
      .then(r => setLogs(r.data)).catch(console.error)

  const saveLog = async () => {
    try {
      if (logView?.workschid) {
        await api.put(`/schedules/${logView.workschid}`, {
          work_remark: logForm.work_remark })
        setLogView(v => ({ ...v, work_remark: logForm.work_remark }))
      } else {
        await api.post('/schedules', {
          taskid: task.taskid,
          work_remark: logForm.work_remark,
          work_userid: me.userid })
        setLogView(null)
      }
      setLogForm(null)
      loadLogs()
    } catch (e) { alert(e.response?.data?.detail || '저장에 실패했습니다') }
  }

  const reloadDaily = () =>
    api.get(`/tasks/${task.taskid}/daily`)
      .then(r => setDaily(r.data)).catch(() => {})

  // 직전 상태 되돌리기: F/X는 종료예상 미경과, 모든 상태는 변경 후 1시간 이내 (서버 판정)
  const canRevert = canEdit && task.can_revert && task.prev_stat
  const revert = async () => {
    if (!window.confirm(`'${STAT_LABEL[task.prev_stat]}' 상태로 되돌릴까요?`)) return
    try {
      await api.post(`/tasks/${task.taskid}/revert`)
      onChanged?.()
      onClose()
    } catch (e) { alert(e.response?.data?.detail || '처리에 실패했습니다') }
  }

  // 시작일시 수동 설정 (서버에서 고정 처리 + 종료예상일시 재계산)
  const saveStart = async () => {
    try {
      const { data } = await api.patch(`/tasks/${task.taskid}/start`, {
        start_datetime: startEdit.length === 16 ? startEdit + ':00' : startEdit })
      setTf(t => ({ ...t, task_start_date: data.task_start_date,
        task_end_date_estimated: data.task_end_date_estimated,
        start_fixed: data.start_fixed }))
      setStartEdit(null); reloadDaily(); onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '저장에 실패했습니다') }
  }
  const unfixStart = async () => {
    if (!window.confirm('시작일시 고정을 해제하면 다음 재계산 시 자동 배치됩니다. 계속할까요?')) return
    try {
      const { data } = await api.patch(`/tasks/${task.taskid}/unfix`)
      setTf(t => ({ ...t, start_fixed: data.start_fixed }))
      onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '처리에 실패했습니다') }
  }
  const saveHours = async () => {
    try {
      const { data } = await api.put(`/tasks/${task.taskid}`, {
        work_hours_estimated: +hoursEdit })
      setTf(t => ({ ...t, work_hours_estimated: data.work_hours_estimated,
        task_end_date_estimated: data.task_end_date_estimated }))
      setHoursEdit(null); reloadDaily(); onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '저장에 실패했습니다') }
  }

  const doRecalc = async () => {
    if (!confirm('대기중 작업의 일정을 우선순위 기준으로 재계산합니다.\n계속할까요?')) return
    try {
      setRecalcBusy(true)
      await api.post('/tasks/recalculate')
      const { data } = await api.get('/tasks')
      const t = (data || []).find(x => x.taskid === task.taskid)
      if (t) setTf(prev => ({ ...prev, ...t }))
      reloadDaily(); onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '재계산에 실패했습니다') }
    finally { setRecalcBusy(false) }
  }

  const savePrio = async () => {
    try {
      const { data } = await api.put(`/tasks/${task.taskid}`, {
        priority: +prioEdit })
      setTf(t => ({ ...t, priority: data.priority }))
      setPrioEdit(null); onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '저장에 실패했습니다') }
  }

  // 스케쥴적용 여부 수정 (작업요청·검토중 상태에서만 — 경로가 갈리기 전)
  const saveSched = async () => {
    try {
      const { data } = await api.put(`/tasks/${task.taskid}`, {
        schedule_apply: schedEdit })
      setTf(t => ({ ...t, schedule_apply: data.schedule_apply }))
      setSchedEdit(null); onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '저장에 실패했습니다') }
  }

  // 요청일시 수정 (상태 무관 — 메타 정보)
  const saveReqDate = async () => {
    try {
      const { data } = await api.put(`/tasks/${task.taskid}`, {
        req_date: reqDateEdit
          ? (reqDateEdit.length === 16 ? reqDateEdit + ':00' : reqDateEdit)
          : null })
      setTf(t => ({ ...t, req_date: data.req_date }))
      setReqDateEdit(null); onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '저장에 실패했습니다') }
  }

  const saveReq = async () => {
    try {
      await api.put(`/tasks/${task.taskid}`, { task_req_remark: reqEdit || null })
      setReqText(reqEdit)
      setReqEdit(null)
      onChanged?.()
    } catch (ex) {
      alert(ex.response?.data?.detail || '저장에 실패했습니다')
    }
  }

  const loadFiles = () => {
    api.get('/attach-files', { params: { taskid: task.taskid } })
      .then(r => setFiles(r.data)).catch(console.error)
  }
  const downloadFile = f => dlFile(`/attach-files/${f.fileid}/download`)
  const uploadFile = async (workschid = null, ev = null) => {
    const f = ev ? ev.target.files?.[0] : fileRef.current?.files?.[0]
    if (!f) { alert('첨부할 파일을 선택하세요'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('taskid', task.taskid)
    if (workschid) fd.append('workschid', workschid)
    try {
      setUpPct(0)
      await uploadWithProgress('/attach-files', fd, setUpPct)
      if (ev) ev.target.value = ''
      else fileRef.current.value = ''
      loadFiles()
    } catch (e) { alert(e.response?.data?.detail || '업로드 실패') }
    finally { setUpPct(null) }
  }

  // 하단 탭 전환 — 이력 탭 최초 진입 시 이력 로딩
  const selTab = tab => {
    setBtab(tab)
    if (tab === 'his' && !logs) loadLogs()
    if (tab === 'chg' && !his)
      api.get(`/tasks/${task.taskid}/his`)
        .then(r => setHis(r.data)).catch(console.error)
  }

  // 상태변경이력 초기화 (스태프) — 현재 상태의 기준 이력 1건만 남김
  const resetHis = async () => {
    if (!window.confirm('이 작업의 상태변경이력을 모두 초기화할까요?\n' +
      '(현재 상태의 기준 이력 1건만 남고 복구할 수 없습니다)')) return
    try {
      await api.delete(`/tasks/${task.taskid}/his`)
      api.get(`/tasks/${task.taskid}/his`)
        .then(r => setHis(r.data)).catch(console.error)
      onChanged?.()
    } catch (e) { alert(e.response?.data?.detail || '처리에 실패했습니다') }
  }

  // 총 작업일수: 일별 배분이 있으면 실제 작업일수(작업시간이 있는 날),
  // 없으면 예상시간/작업자 하루시간으로 환산
  const dayHours = workHr || cfg?.work_hours_per_day
  const workDays = (daily && daily.length)
    ? (daily.filter(d => d.hours > 0).length || null)
    : (dayHours && estHours ? +(estHours / dayHours).toFixed(1) : null)

  return (
    <div className="popup"
      onMouseDown={e => { if (e.target === e.currentTarget) downOnOverlay.current = true }}
      onClick={e => {
        // 오버레이에서 눌러 오버레이에서 뗀 클릭만 닫기 — 리사이즈 드래그 종료 클릭 무시
        if (e.target === e.currentTarget && downOnOverlay.current) onClose()
        downOnOverlay.current = false
      }}>
      <div className="popup-body task-popup" onClick={e => e.stopPropagation()}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        <h3 className="popup-title" onMouseDown={onDown}
          style={{ background: taskColor(task.taskid), cursor: 'move', userSelect: 'none' }}>
          <div className="pt-row1">
            <span className="pt-chip">#{task.taskid}</span>
            {prio != null &&
              <span className={`pt-chip${prio === 0 ? ' urgent' : ''}`}>
                {prio === 0 ? '긴급' : `우선순위 ${prio}`}</span>}
            {(task.site_name || task.siteid) &&
              <span className="pt-chip">{task.site_name || task.siteid}</span>}
            {task.task_type &&
              <span className="pt-chip">{TASK_TYPE_LABEL[task.task_type] || task.task_type}</span>}
            {task.task_csrid && <span className="csr">{task.task_csrid}</span>}
            {task.task_csrid &&
              <CopyBtn text={task.task_csrid} title="CSR번호 복사"
                bg={taskColorComp(task.taskid)} />}
            {!!task.holiday_work && <span className="pt-chip">휴일작업</span>}
            {schedApply === 'N' && <span className="pt-chip">스케쥴미적용</span>}
            <span className="pt-chip">{STAT_LABEL[task.task_stat] || task.task_stat}</span>
            {canRevert &&
              <button type="button" className="revert-btn"
                title={`${STAT_LABEL[task.prev_stat]}(으)로 되돌리기`}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); revert() }}>↩ 되돌림</button>}
          </div>
          <div className="pt-row2">{task.task_name}
            <CopyBtn text={task.task_name || ''} title="작업명 복사"
              bg={taskColorComp(task.taskid)} /></div>
        </h3>
        <div className="popup-info info-daily">
            <div className="info-col">
              <p><b>요청자</b> {fmtUser(task.req_user_name, task.req_userid,
                task.req_user_title, task.req_user_dept)}</p>
              <p><b>작업자</b> {fmtUser(task.work_user_name, task.work_userid,
                task.work_user_title, task.work_user_dept)}</p>
              <p><b>우선순위</b> {prioEdit === null ? (<>
                {prio}
                {canEditFields &&
                  <button className="link"
                    onClick={() => setPrioEdit(prio)}>수정</button>}
              </>) : (<>
                <input type="number" step="1" style={{ maxWidth: 80 }}
                  value={prioEdit}
                  onChange={e => setPrioEdit(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && savePrio()} />
                <button className="link" onClick={savePrio}>저장</button>
                <button className="link" onClick={() => setPrioEdit(null)}>취소</button>
              </>)}</p>
              <p><b>예상시간</b> {hoursEdit === null ? (<>
                {estHours}h
                {workDays != null && ` (총 ${workDays}일)`}
                {dayHours != null && ` / 하루 ${dayHours}시간`}
                {canEditFields &&
                  <button className="link"
                    onClick={() => setHoursEdit(estHours)}>수정</button>}
              </>) : (<>
                <input type="number" min="0.5" step="0.5" style={{ maxWidth: 80 }}
                  value={hoursEdit}
                  onChange={e => setHoursEdit(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveHours()} />h
                <button className="link" onClick={saveHours}>저장</button>
                <button className="link" onClick={() => setHoursEdit(null)}>취소</button>
              </>)}</p>
              <p><b>스케쥴</b> {schedEdit === null ? (<>
                {schedApply === 'N' ? '미적용 (단순업무)' : '적용'}
                {canEdit && ['R', 'C'].includes(task.task_stat) &&
                  <button className="link"
                    onClick={() => setSchedEdit(schedApply)}>수정</button>}
              </>) : (<>
                <select value={schedEdit}
                  onChange={e => setSchedEdit(e.target.value)}>
                  <option value="Y">적용 (스케쥴링 작업)</option>
                  <option value="N">미적용 (단순업무)</option>
                </select>
                <button className="link" onClick={saveSched}>저장</button>
                <button className="link" onClick={() => setSchedEdit(null)}>취소</button>
              </>)}</p>
              <p><b>요청일자</b> {reqDateEdit === null ? (<>
                {fmtDT(tf.req_date ?? task.req_date) || '-'}
                {canEdit &&
                  <button className="link" onClick={() =>
                    setReqDateEdit((tf.req_date ?? task.req_date)
                      ? (tf.req_date ?? task.req_date).slice(0, 16) : '')}>수정</button>}
              </>) : (<>
                <input type="datetime-local" value={reqDateEdit}
                  onChange={e => setReqDateEdit(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveReqDate()} />
                <button className="link" onClick={saveReqDate}>저장</button>
                <button className="link" onClick={() => setReqDateEdit(null)}>취소</button>
              </>)}</p>
              <p><b>시작</b> {startEdit === null ? (<>
                {fmtDT(startDate) || '-'}
                {!!startFixed &&
                  <span className="badge" title="시작일시가 고정되어 재계산에도 유지됩니다">고정</span>}
                {canEditFields &&
                  <button className="link" onClick={() =>
                    setStartEdit(startDate ? startDate.slice(0, 16) : '')}>수정</button>}
                {canEditFields && !!startFixed &&
                  <button className="link" onClick={unfixStart}>고정해제</button>}
              </>) : (<>
                <input type="datetime-local" value={startEdit}
                  onChange={e => setStartEdit(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveStart()} />
                <button className="link" onClick={saveStart}>저장</button>
                <button className="link" onClick={() => setStartEdit(null)}>취소</button>
              </>)}</p>
              <p><b>종료(예상)</b> {fmtDT(endEst) || '-'}
                {canEdit && schedApply !== 'N' &&
                  <button onClick={doRecalc} disabled={recalcBusy}
                    style={{ marginLeft: 12 }}
                    title="대기중 작업의 일정을 우선순위 기준으로 재계산합니다">작업스케쥴링 재실행</button>}
              </p>
            </div>
            {daily && daily.length > 0 && (
              <div className="daily">
                <b>일별 작업시간</b> ({daily.reduce((a, d) => a + d.hours, 0).toFixed(1)}h)
                <table>
                  <tbody>
                    {daily.map(d => {
                      const wd = '일월화수목금토'[new Date(d.date).getDay()]
                      return (
                        <tr key={d.date}>
                          <td>{d.date} ({wd})</td>
                          <td className="r">
                            {d.hours}h
                            {d.holiday &&
                              <span className="badge hol-badge">휴가{d.holiday !== '종일' ? ` ${d.holiday}` : ''}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        <div className="btab-bar">
          <button className={`btab${btab === 'req' ? ' active' : ''}`}
            onClick={() => selTab('req')}>작업요청내용</button>
          <button className={`btab${btab === 'his' ? ' active' : ''}`}
            onClick={() => selTab('his')}>작업이력</button>
          <button className={`btab${btab === 'chg' ? ' active' : ''}`}
            onClick={() => selTab('chg')}>상태변경이력</button>
          {btab === 'req' && canEdit && reqEdit === null &&
            <button className="link req-edit-btn"
              onClick={() => setReqEdit(reqText)}>수정</button>}
          {btab === 'his' &&
            <button className="link req-edit-btn"
              onClick={() => { setLogView({ work_remark: '' })
                setLogForm({ work_remark: '' }) }}>등록</button>}
          {btab === 'chg' && isStaff &&
            <button className="danger req-edit-btn"
              style={{ padding: '1px 8px' }}
              onClick={resetHis}>초기화</button>}
        </div>
        {btab === 'req' ? (
          <div className="popup-info req-info" ref={tabRef}
            style={{ minHeight: minH || undefined }}>
            {reqEdit !== null ? (
              <>
                <textarea className="req-edit" rows="10" value={reqEdit}
                  onChange={e => setReqEdit(e.target.value)} />
                <div className="popup-btns">
                  <button className="primary" onClick={saveReq}>저장</button>
                  <button onClick={() => setReqEdit(null)}>취소</button>
                </div>
              </>
            ) : (
              <div className="req-detail">
                {reqText || '작업요청 내용이 없습니다'}
              </div>
            )}
            <div className="daily">
              <b>첨부파일</b>
              <table>
                <tbody>
                  {(files || []).filter(f => !f.workschid).map(f => (
                    <tr key={f.fileid}>
                      <td>
                        <button className="link"
                          onClick={() => downloadFile(f)}>{f.file_name}</button>
                      </td>
                      <td className="r">{fmtSize(f.file_size)}</td>
                      <td className="r">{fmtDT(f.create_date)}</td>
                    </tr>
                  ))}
                  {files && !files.length && (
                    <tr><td colSpan="3" className="empty">첨부파일이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
              {canAttach && (<>
                <div className="attach-add">
                  <input type="file" ref={fileRef} />
                  <button onClick={() => uploadFile()}>첨부</button>
                </div>
                <ProgressBar pct={upPct} />
              </>)}
            </div>
          </div>
        ) : btab === 'his' ? (
          <div className="popup-info req-info" ref={tabRef}
            style={{ minHeight: minH || undefined }}>
            <div className="daily" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <table>
                <thead><tr>
                  <th>등록일시</th><th>작업자</th><th>작업내용</th>
                </tr></thead>
                <tbody>
                  {(logs || []).map(l => (
                    <tr key={l.workschid}>
                      <td className="c">{fmtDT(l.create_date)}</td>
                      <td>{l.work_user_name || l.work_userid || '-'}</td>
                      <td>
                        <button className="link log-link"
                          onClick={() => setLogView(l)}>
                          {l.work_remark || ''}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!logs || !logs.length) && (
                    <tr><td colSpan="3" className="empty">작업이력이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="popup-info req-info" ref={tabRef}
            style={{ minHeight: minH || undefined }}>
            <div className="daily" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <table>
                <thead><tr>
                  <th>등록일시</th><th>변경상태</th><th>변경자</th>
                </tr></thead>
                <tbody>
                  {(his || []).map(h => (
                    <tr key={h.taskchgid}>
                      <td className="c">{fmtDTS(h.create_date)}</td>
                      <td>{STAT_LABEL[h.task_stat] ?? h.task_stat}</td>
                      <td>{h.work_user_name || h.work_userid || '-'}</td>
                    </tr>
                  ))}
                  {(!his || !his.length) && (
                    <tr><td colSpan="3" className="empty">이력이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="popup-btns">
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
      {logView && (
          <div className="popup log-pop"
            onMouseDown={e => { if (e.target === e.currentTarget) downOnOverlay.current = true }}
            onClick={e => {
              if (e.target === e.currentTarget && downOnOverlay.current) {
                setLogView(null); setLogForm(null)
              }
              downOnOverlay.current = false
            }}>
            <div className="popup-body" onClick={e => e.stopPropagation()}
              style={{ transform: `translate(${logPos.x}px, ${logPos.y}px)` }}>
              <b className="blk-title" onMouseDown={logOnDown}
                style={{ marginTop: 0, cursor: 'move', userSelect: 'none' }}>작업내용</b>
              {logForm ? (
                <>
                  <textarea className="req-edit" rows="8" value={logForm.work_remark}
                    placeholder="작업 내용을 입력하세요"
                    onChange={e => setLogForm({ ...logForm, work_remark: e.target.value })} />
                  <div className="popup-btns">
                    <button className="primary" onClick={saveLog}>
                      {logView.workschid ? '저장' : '등록'}</button>
                    <button onClick={() => logView.workschid ? setLogForm(null)
                      : (setLogView(null), setLogForm(null))}>취소</button>
                  </div>
                </>
              ) : (
                <>
                  {(() => {
                    const html = highlightCode(logView.work_remark)
                    return html
                      ? <pre className="log-detail hljs"
                          dangerouslySetInnerHTML={html} />
                      : <div className="log-detail">{logView.work_remark || ''}</div>
                  })()}
                  <div className="daily log-attach" style={{ borderTop: 'none', paddingTop: 0 }}>
                    <b>첨부파일</b>
                    <table>
                      <tbody>
                        {(files || []).filter(f => f.workschid === logView.workschid).map(f => (
                          <tr key={f.fileid}>
                            <td>
                              <button className="link"
                                onClick={() => downloadFile(f)}>{f.file_name}</button>
                            </td>
                            <td className="r">{fmtSize(f.file_size)}</td>
                            <td className="r">{fmtDT(f.create_date)}</td>
                          </tr>
                        ))}
                        {!(files || []).some(f => f.workschid === logView.workschid) && (
                          <tr><td className="empty">첨부파일이 없습니다</td></tr>
                        )}
                      </tbody>
                    </table>
                    {(isStaff || logView.work_userid === me?.userid) && <>
                      <div className="attach-add">
                        <label className="btn-file">파일 첨부
                          <input type="file" hidden
                            onChange={e => uploadFile(logView.workschid, e)} />
                        </label>
                      </div>
                      <ProgressBar pct={upPct} />
                    </>}
                  </div>
                  <div className="popup-btns">
                    {(isStaff || logView.work_userid === me?.userid) &&
                      <button onClick={() => setLogForm({
                        work_remark: logView.work_remark || '' })}>수정</button>}
                    <button onClick={() => setLogView(null)}>닫기</button>
                  </div>
                </>
              )}
            </div>
          </div>
      )}
    </div>
  )
}
