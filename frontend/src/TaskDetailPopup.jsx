import { useEffect, useRef, useState } from 'react'
import api, { fmtDT, STAT_LABEL, NEXT_STAT, taskColor } from './api'

// 달력 작업 팝업과 동일한 스타일의 작업 상세 팝업 (칸반/작업목록 공용)
// task: /api/tasks 의 TaskDetail 형태 (workschid, work_stat, start_datetime 등 포함)
export default function TaskDetailPopup({ task, onClose, onChanged }) {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const canEdit = me && (me.user_grade === 0 ||
    (me.user_grade === 1 && task.work_userid === me.userid))
  const canAttach = me && [0, 1].includes(me.user_grade)
  const [pview, setPview] = useState('info')   // info | req | his
  const [editForm, setEditForm] = useState(null)
  const [users, setUsers] = useState([])
  const [daily, setDaily] = useState(null)
  const [his, setHis] = useState(null)
  const [files, setFiles] = useState(null)
  const fileRef = useRef(null)

  const toLocalInput = iso => iso ? String(iso).slice(0, 16) : ''

  useEffect(() => {
    if (task.workschid) {
      api.get(`/schedules/${task.workschid}/daily`)
        .then(r => setDaily(r.data)).catch(() => setDaily([]))
    }
    api.get('/users').then(r => setUsers(r.data)).catch(() => {})
  }, [task.workschid])

  const startEdit = () => setEditForm({
    priority: task.priority ?? 0,
    work_hours_estimated: task.work_hours_estimated ?? 0,
    work_userid: task.work_userid || '',
    work_stat: task.work_stat || task.task_stat || 'W',
    req_remark: task.task_req_remark || '',
    start: toLocalInput(task.start_datetime),
    unfix: false,
  })

  const saveEdit = async e => {
    e.preventDefault()
    try {
      await api.put(`/tasks/${task.taskid}`, {
        priority: +editForm.priority,
        work_hours_estimated: +editForm.work_hours_estimated,
        work_userid: editForm.work_userid || null,
        task_req_remark: editForm.req_remark || null,
      })
      if (task.workschid) {
        await api.put(`/schedules/${task.workschid}`, {
          work_stat: editForm.work_stat,
          work_userid: editForm.work_userid || null,
        })
        if (editForm.unfix) {
          await api.patch(`/schedules/${task.workschid}/unfix`)
        } else if (editForm.start &&
            editForm.start !== toLocalInput(task.start_datetime)) {
          await api.patch(`/schedules/${task.workschid}/start`, {
            start_datetime: editForm.start.length === 16
              ? editForm.start + ':00' : editForm.start,
          })
        }
      }
      onChanged?.()
      onClose()
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
  const uploadFile = async () => {
    const f = fileRef.current?.files?.[0]
    if (!f) { alert('첨부할 파일을 선택하세요'); return }
    const fd = new FormData()
    fd.append('file', f)
    fd.append('taskid', task.taskid)
    if (task.workschid) fd.append('workschid', task.workschid)
    try {
      await api.post('/attach-files', fd)
      fileRef.current.value = ''
      loadFiles()
    } catch (e) { alert(e.response?.data?.detail || '업로드 실패') }
  }

  return (
    <div className="popup" onClick={onClose}>
      <div className="popup-body" onClick={e => e.stopPropagation()}>
        <h3 className="popup-title" style={{ background: taskColor(task.taskid) }}>
          {(task.site_name || task.siteid) && `${task.site_name || task.siteid} `}
          {task.task_csrid && <span className="csr">{task.task_csrid}</span>}
          {task.task_name}
        </h3>
        {editForm ? (
          <form onSubmit={saveEdit}>
            <div className="popup-info">
              <p><b>우선순위</b>
                <input type="number" value={editForm.priority}
                  onChange={e => setEditForm({ ...editForm, priority: e.target.value })} /></p>
              <p><b>예상시간(h)</b>
                <input type="number" min="0.5" step="0.5" required
                  value={editForm.work_hours_estimated}
                  onChange={e => setEditForm({ ...editForm, work_hours_estimated: e.target.value })} /></p>
              <p><b>작업자</b>
                <select value={editForm.work_userid}
                  onChange={e => setEditForm({ ...editForm, work_userid: e.target.value })}>
                  <option value="">-</option>
                  {users.filter(u => u.user_grade === 1)
                    .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
                </select></p>
              <p><b>상태</b>
                <select value={editForm.work_stat}
                  onChange={e => setEditForm({ ...editForm, work_stat: e.target.value })}>
                  {Object.entries(STAT_LABEL)
                    .filter(([k]) => NEXT_STAT[task.work_stat || task.task_stat]?.includes(k))
                    .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></p>
              <p><b>시작일시</b>
                <input type="datetime-local" value={editForm.start}
                  onChange={e => setEditForm({ ...editForm, start: e.target.value })} /></p>
              <p className="full"><b>작업요청내용</b>
                <textarea rows="12" value={editForm.req_remark}
                  onChange={e => setEditForm({ ...editForm, req_remark: e.target.value })} /></p>
              {!!task.start_fixed && (
                <p className="chk">
                  <input type="checkbox" checked={editForm.unfix}
                    onChange={e => setEditForm({ ...editForm, unfix: e.target.checked })} />
                  <span>시작일시 고정 해제 (재계산 시 자동 배치)</span>
                </p>
              )}
            </div>
            <div className="popup-btns">
              <button type="submit" className="primary">저장</button>
              <button type="button" onClick={() => setEditForm(null)}>취소</button>
            </div>
          </form>
        ) : pview === 'req' ? (
          <div className="popup-info">
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
        ) : pview === 'his' ? (
          <div className="popup-info">
            <div className="daily">
              <b>작업스케줄 이력</b>
              <table>
                <thead><tr>
                  <th>등록일시</th><th>변경상태</th>
                  <th className="r">작업기간</th><th>비고</th>
                </tr></thead>
                <tbody>
                  {(his || []).map(h => (
                    <tr key={h.workschhisid}>
                      <td className="c">{fmtDT(h.create_date)}</td>
                      <td>{STAT_LABEL[h.work_stat] ?? h.work_stat}</td>
                      <td className="r">{h.work_hours ? `${h.work_hours}h` : '-'}</td>
                      <td>{h.remark || ''}</td>
                    </tr>
                  ))}
                  {(!his || !his.length) && (
                    <tr><td colSpan="4" className="empty">이력이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="popup-info">
            <p><b>사이트</b> {task.site_name || task.siteid || '-'}</p>
            <p><b>작업자</b> {task.work_user_name || task.work_userid || '-'}</p>
            <p><b>우선순위</b> {task.priority}</p>
            <p><b>예상시간</b> {task.work_hours_estimated}h
              {daily && daily.length > 0 && ` (총 ${daily.length}일)`}</p>
            <p><b>상태</b> {STAT_LABEL[task.work_stat || task.task_stat] || '-'}</p>
            <p><b>시작</b> {fmtDT(task.start_datetime) || '-'}</p>
            <p><b>종료(예상)</b> {fmtDT(task.end_datetime_estimated) || '-'}</p>
            {daily && daily.length > 0 && (
              <div className="daily">
                <b>일별 작업시간</b>
                <table>
                  <tbody>
                    {daily.map(d => {
                      const wd = '일월화수목금토'[new Date(d.date).getDay()]
                      return (
                        <tr key={d.date}>
                          <td>{d.date} ({wd})</td>
                          <td className="r">{d.hours}h</td>
                        </tr>
                      )
                    })}
                    <tr className="sum">
                      <td>합계</td>
                      <td className="r">
                        {daily.reduce((a, d) => a + d.hours, 0).toFixed(1)}h
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {!editForm && (
          <div className="popup-btns">
            <button onClick={() => {
              setPview(pview === 'req' ? 'info' : 'req')
              if (pview !== 'req') loadFiles()
            }}>
              {pview === 'req' ? '작업정보' : '작업요청 상세'}
            </button>
            {task.workschid && (
              <button onClick={() => {
                setPview(pview === 'his' ? 'info' : 'his')
                if (pview !== 'his' && !his) {
                  api.get(`/schedules/${task.workschid}/his`)
                    .then(r => setHis(r.data)).catch(console.error)
                }
              }}>
                {pview === 'his' ? '작업정보' : '스케줄이력'}
              </button>
            )}
            {canEdit && pview === 'info' &&
              <button onClick={startEdit}>수정</button>}
            <button onClick={onClose}>닫기</button>
          </div>
        )}
      </div>
    </div>
  )
}
