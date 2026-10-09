import { useEffect, useRef, useState } from 'react'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import api, { fmtDT, STAT_LABEL, TASK_TYPE_LABEL, NEXT_STAT, taskColor } from './api'

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
  const [pview, setPview] = useState('info')  // info(기본: 작업정보+요청내용) | his
  const [daily, setDaily] = useState(null)
  const [his, setHis] = useState(null)
  const [logs, setLogs] = useState(null)
  const [logForm, setLogForm] = useState(null)   // {workschid?, work_remark} 작업이력 등록/수정
  const [logView, setLogView] = useState(null)   // 작업내용 상세 팝업
  const isStaff = me && [0, 1].includes(me.user_grade)
  const [files, setFiles] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [reqText, setReqText] = useState(task.task_req_remark || '')
  const [reqEdit, setReqEdit] = useState(null)
  const fileRef = useRef(null)
  const downOnOverlay = useRef(false)   // mousedown이 오버레이에서 시작됐는지
  const { pos, onDown } = useDrag()           // 메인 팝업 드래그
  const { pos: logPos, onDown: logOnDown } = useDrag()  // 작업내용 팝업 드래그

  useEffect(() => {
    api.get(`/tasks/${task.taskid}/daily`)
      .then(r => setDaily(r.data)).catch(() => setDaily([]))
    api.get('/config').then(r => setCfg(r.data)).catch(() => {})
    loadFiles()   // 첨부파일 목록
  }, [task.taskid])

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
  const downloadFile = f =>
    api.get(`/attach-files/${f.fileid}/download`, { responseType: 'blob' })
      .then(r => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(r.data)
        a.download = f.file_name
        a.click()
        URL.revokeObjectURL(a.href)
      }).catch(e => alert(e.response?.data?.detail || '다운로드 실패'))
  const uploadFile = async (workschid = null, ev = null) => {
    const f = ev ? ev.target.files?.[0] : fileRef.current?.files?.[0]
    if (!f) { alert('첨부할 파일을 선택하세요'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('taskid', task.taskid)
    if (workschid) fd.append('workschid', workschid)
    try {
      await api.post('/attach-files', fd)
      if (ev) ev.target.value = ''
      else fileRef.current.value = ''
      loadFiles()
    } catch (e) { alert(e.response?.data?.detail || '업로드 실패') }
  }

  // 총 작업일수: 일별 배분이 있으면 실제 일수, 없으면 예상시간/하루작업시간으로 환산
  const workDays = (daily && daily.length) ? daily.length
    : (cfg?.work_hours_per_day && task.work_hours_estimated
      ? +(task.work_hours_estimated / cfg.work_hours_per_day).toFixed(1) : null)

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
            {(task.site_name || task.siteid) &&
              <span className="pt-chip">{task.site_name || task.siteid}</span>}
            {task.task_type &&
              <span className="pt-chip">{TASK_TYPE_LABEL[task.task_type] || task.task_type}</span>}
            {task.task_csrid && <span className="csr">{task.task_csrid}</span>}
            {!!task.holiday_work && <span className="pt-chip">휴일작업</span>}
            <span className="pt-chip">{STAT_LABEL[task.task_stat] || task.task_stat}</span>
          </div>
          <div className="pt-row2">{task.task_name}</div>
        </h3>
        {pview === 'his' ? (
          <div className="his-cols">
          <div className="his-col">
          <b className="blk-title">상태변경이력</b>
          <div className="popup-info">
            <div className="daily" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
              <table>
                <thead><tr>
                  <th>등록일시</th><th>변경상태</th><th>변경자</th>
                </tr></thead>
                <tbody>
                  {(his || []).map(h => (
                    <tr key={h.taskchgid}>
                      <td className="c">{fmtDT(h.create_date)}</td>
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
          </div>
          <div className="his-col">
          <div className="blk-title">
            <b className="blk-title">작업이력</b>
            <button className="link req-edit-btn"
              onClick={() => { setLogView({ work_remark: '' })
                setLogForm({ work_remark: '' }) }}>등록</button>
          </div>
          <div className="popup-info">
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
          </div>
          </div>
        ) : (
          <div className="popup-info info-daily">
            <div className="info-col">
              <p><b>요청자</b> {fmtUser(task.req_user_name, task.req_userid,
                task.req_user_title, task.req_user_dept)}</p>
              <p><b>작업자</b> {fmtUser(task.work_user_name, task.work_userid,
                task.work_user_title, task.work_user_dept)}</p>
              <p><b>예상시간</b> {task.work_hours_estimated}h
                {workDays != null && ` (총 ${workDays}일)`}</p>
              <p><b>요청일자</b> {fmtDT(task.req_date) || '-'}</p>
              <p><b>시작</b> {fmtDT(task.task_start_date) || '-'}</p>
              <p><b>종료(예상)</b> {fmtDT(task.task_end_date_estimated) || '-'}</p>
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
        )}
        {pview === 'info' && (
          <>
          <div className="blk-title">
            작업요청내용
            {canEdit && reqEdit === null &&
              <button className="link req-edit-btn"
                onClick={() => setReqEdit(reqText)}>수정</button>}
          </div>
          <div className="popup-info req-info">
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
                      <td className="r">{fmtDT(f.create_date)}</td>
                    </tr>
                  ))}
                  {files && !files.length && (
                    <tr><td colSpan="2" className="empty">첨부파일이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
              {canAttach && (
                <div className="attach-add">
                  <input type="file" ref={fileRef} />
                  <button onClick={uploadFile}>첨부</button>
                </div>
              )}
            </div>
          </div>
          </>
        )}
        <div className="popup-btns">
          <button onClick={() => {
            setPview(pview === 'his' ? 'info' : 'his')
            if (pview !== 'his') {
              if (!his) api.get(`/tasks/${task.taskid}/his`)
                .then(r => setHis(r.data)).catch(console.error)
              if (!logs) loadLogs()
            }
          }}>
            {pview === 'his' ? '작업요청정보' : '작업이력'}
          </button>
          <button onClick={onClose}>닫기</button>
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
                            <td className="r">{fmtDT(f.create_date)}</td>
                          </tr>
                        ))}
                        {!(files || []).some(f => f.workschid === logView.workschid) && (
                          <tr><td className="empty">첨부파일이 없습니다</td></tr>
                        )}
                      </tbody>
                    </table>
                    {(isStaff || logView.work_userid === me?.userid) &&
                      <div className="attach-add">
                        <label className="btn-file">파일 첨부
                          <input type="file" hidden
                            onChange={e => uploadFile(logView.workschid, e)} />
                        </label>
                      </div>}
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
    </div>
  )
}
