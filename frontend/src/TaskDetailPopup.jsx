import { useEffect, useRef, useState } from 'react'
import api, { fmtDT, STAT_LABEL, TASK_TYPE_LABEL, NEXT_STAT, taskColor } from './api'

// 달력 작업 팝업과 동일한 스타일의 작업 상세 팝업 (칸반/작업목록 공용)
// task: /api/tasks 의 TaskDetail 형태 (task_start_date, task_stat 등 포함)
// 사용자 표기: 이름 직급/팀명 (없으면 ID)
const fmtUser = (name, id, title, dept) => {
  const base = name || id
  if (!base) return '-'
  const extra = [title, dept].filter(Boolean).join('/')
  return extra ? `${base} (${extra})` : base
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
  const [files, setFiles] = useState(null)
  const [cfg, setCfg] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    api.get(`/tasks/${task.taskid}/daily`)
      .then(r => setDaily(r.data)).catch(() => setDaily([]))
    api.get('/config').then(r => setCfg(r.data)).catch(() => {})
    loadFiles()   // 첨부파일 목록
  }, [task.taskid])

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
  const uploadFile = async () => {
    const f = fileRef.current?.files?.[0]
    if (!f) { alert('첨부할 파일을 선택하세요'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('taskid', task.taskid)
    try {
      await api.post('/attach-files', fd)
      fileRef.current.value = ''
      loadFiles()
    } catch (e) { alert(e.response?.data?.detail || '업로드 실패') }
  }

  // 총 작업일수: 일별 배분이 있으면 실제 일수, 없으면 예상시간/하루작업시간으로 환산
  const workDays = (daily && daily.length) ? daily.length
    : (cfg?.work_hours_per_day && task.work_hours_estimated
      ? +(task.work_hours_estimated / cfg.work_hours_per_day).toFixed(1) : null)

  return (
    <div className="popup" onClick={onClose}>
      <div className="popup-body task-popup" onClick={e => e.stopPropagation()}>
        <h3 className="popup-title" style={{ background: taskColor(task.taskid) }}>
          <div className="pt-row1">
            {(task.site_name || task.siteid) &&
              <span className="pt-chip">{task.site_name || task.siteid}</span>}
            {task.task_type &&
              <span className="pt-chip">{TASK_TYPE_LABEL[task.task_type] || task.task_type}</span>}
            {task.task_csrid && <span className="csr">{task.task_csrid}</span>}
            <span className="pt-chip">{STAT_LABEL[task.task_stat] || task.task_stat}</span>
          </div>
          <div className="pt-row2">{task.task_name}</div>
        </h3>
        {pview === 'his' ? (
          <div className="popup-info">
            <div className="daily">
              <b>작업상태변경이력</b>
              <table>
                <thead><tr>
                  <th>등록일시</th><th>변경상태</th><th>변경자</th>
                  <th className="r">작업기간</th><th>비고</th>
                </tr></thead>
                <tbody>
                  {(his || []).map(h => (
                    <tr key={h.taskchgid}>
                      <td className="c">{fmtDT(h.create_date)}</td>
                      <td>{STAT_LABEL[h.task_stat] ?? h.task_stat}</td>
                      <td>{h.work_user_name || h.work_userid || '-'}</td>
                      <td className="r">{h.work_hours ? `${h.work_hours}h` : '-'}</td>
                      <td>{h.remark || ''}</td>
                    </tr>
                  ))}
                  {(!his || !his.length) && (
                    <tr><td colSpan="5" className="empty">이력이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
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
          <div className="popup-info req-info">
            <div className="req-detail">
              {task.task_req_remark || '작업요청 내용이 없습니다'}
            </div>
            <div className="daily">
              <b>첨부파일</b>
              <table>
                <tbody>
                  {(files || []).map(f => (
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
        )}
        <div className="popup-btns">
          <button onClick={() => {
            setPview(pview === 'his' ? 'info' : 'his')
            if (pview !== 'his' && !his) {
              api.get(`/tasks/${task.taskid}/his`)
                .then(r => setHis(r.data)).catch(console.error)
            }
          }}>
            {pview === 'his' ? '작업요청정보' : '상태변경이력'}
          </button>
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}
