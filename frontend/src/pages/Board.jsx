import { useCallback, useEffect, useRef, useState } from 'react'
import api, { fmtDT, fmtSize, uploadWithProgress, downloadFile,
  hasMd, mdHtml, attachCheck, attachHint } from '../api'
import ProgressBar from '../ProgressBar'
import TaskDetailPopup from '../TaskDetailPopup'
import WorkLogEditor from '../WorkLogEditor'

// 팝업 드래그 이동 (관리자 게시판 팝업과 동일 방식)
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

/* 게시판 — 목록 / 작성·수정 / 상세 팝업(첨부·댓글) */
export default function Board() {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const [view, setView] = useState('list')     // list | write (상세는 팝업)
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)         // 상세 대상
  const [edit, setEdit] = useState(null)       // 수정 대상 (write 폼 재사용)
  const [taskPop, setTaskPop] = useState(null) // 관련 작업 상세 팝업 대상
  const tasksRef = useRef(null)                // 작업 목록 캐시 (관련작업 링크용)
  const [pw, setPw] = useState('')             // 비공개글 열람 비밀번호(세션)
  const [lock, setLock] = useState(null)       // {b, pw, err} 비밀번호 입력 대상글

  const load = useCallback(async (kw = q) => {
    try {
      const { data } = await api.get('/boards', { params: kw ? { q: kw } : {} })
      setRows(data)
    } catch { setRows([]) }
  }, [q])

  useEffect(() => { load('').catch(() => {}) }, [load])

  const openDetail = async (b, passwd = '') => {
    try {
      const { data } = passwd
        ? await api.post(`/boards/${b.boardid}/open`, { password: passwd })
        : await api.get(`/boards/${b.boardid}`)
      setSel(data)
      setPw(passwd)
      setLock(null)
    } catch (e) {
      const d = e.response?.data?.detail
      if (d === 'need_password') {
        setLock({ b, pw: '', err: '' })        // 비밀번호 입력 팝업
        return
      }
      if (passwd) {                          // 열람 시도 후 실패 — 팝업 유지 + 오류 표시
        setLock(l => l && { ...l, err: '비밀번호가 일치하지 않습니다' })
        return
      }
      alert(d === '비공개 게시글입니다' ? '비공개 게시글입니다 (작성자·관리자만 열람 가능)'
        : (typeof d === 'string' ? d : '조회에 실패했습니다'))
    }
  }

  const tryUnlock = e => {
    e.preventDefault()
    if (lock) openDetail(lock.b, lock.pw)
  }

  const delBoard = async b => {
    if (!window.confirm(`게시글 '${b.title}'을(를) 삭제할까요?`)) return
    try {
      await api.delete(`/boards/${b.boardid}`)
      setSel(null); setView('list'); load()  // 팝업·작성창 모두 닫고 목록으로
    } catch (e) { alert(e.response?.data?.detail || '삭제에 실패했습니다') }
  }

  // 관련 작업 클릭 → 작업 상세 팝업 (/tasks 목록에서 찾아 표시, 최초 1회만 조회)
  const openTask = b => {
    if (!b.taskid) return
    const show = list => {
      const t = list.find(x => x.taskid === b.taskid)
      t ? setTaskPop(t)
        : alert('작업을 찾을 수 없습니다 (삭제되었을 수 있습니다)')
    }
    tasksRef.current ? show(tasksRef.current)
      : api.get('/tasks').then(r => { tasksRef.current = r.data; show(r.data) })
          .catch(e => alert(e.response?.data?.detail || '작업 조회에 실패했습니다'))
  }

  return (
    <div>
      <div className="toolbar">
        <input placeholder="제목/내용 검색" value={q}
          onChange={e => { setQ(e.target.value); load(e.target.value) }} />
        <span style={{ flex: 1 }} />
        {view === 'list' &&
          <button className="primary" onClick={() => { setEdit(null); setView('write') }}>글쓰기</button>}
        {view === 'write' &&
          <button onClick={() => { setView('list'); setEdit(null); load() }}>목록</button>}
      </div>

      {view === 'list' && (
        <table className="grid">
          <thead><tr>
            <th style={{ width: 60 }}>번호</th><th>제목</th>
            <th style={{ width: 130 }}>관련작업</th>
            <th style={{ width: 110 }}>작성자</th>
            <th style={{ width: 70 }}>첨부</th>
            <th style={{ width: 70 }}>댓글</th><th style={{ width: 140 }}>작성일시</th>
          </tr></thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.boardid}>
                <td className="r">{b.boardid}</td>
                <td>
                  <button className="link" onClick={() => openDetail(b)}>
                    {(b.has_passwd || !b.is_public) && '🔒 '}{b.title}</button>
                  {!b.is_public
                    ? <span className="bd-private">비공개</span>
                    : b.has_passwd && <span className="bd-private">비밀번호</span>}
                </td>
                <td>{b.taskid
                  ? <button className="link" title="작업 상세 보기"
                      onClick={() => openTask(b)}>
                      #{b.taskid} {b.task_name || ''}</button>
                  : ''}</td>
                <td>{b.user_name || b.user_id}</td>
                <td className="r">{b.file_count || ''}</td>
                <td className="r">{b.comment_count || ''}</td>
                <td className="r">{fmtDT(b.create_date)}</td>
              </tr>
            ))}
            {!rows.length &&
              <tr><td colSpan="7" className="empty">게시글이 없습니다</td></tr>}
          </tbody>
        </table>
      )}

      {view === 'write' &&
        <BoardForm me={me} edit={edit}
          onDone={() => { setView('list'); setEdit(null); load() }}
          onCancel={() => { setView('list'); setEdit(null) }} />}

      {sel && view === 'list' &&
        <BoardDetailPopup me={me} post={sel} pw={pw}
          onClose={() => setSel(null)}
          onEdit={() => { setEdit(sel); setSel(null); setView('write') }}
          onDelete={() => delBoard(sel)}
          onReload={() => openDetail(sel, pw)} />}

      {taskPop && <TaskDetailPopup task={taskPop}
        onClose={() => setTaskPop(null)} onChanged={load} />}

      {lock && (
        <div className="popup" onClick={() => setLock(null)}>
          <form className="popup-body" onClick={e => e.stopPropagation()}
            onSubmit={tryUnlock}>
            <h3>🔒 비공개 게시글</h3>
            <p style={{ marginBottom: 10 }}>
              <b>{lock.b.title}</b> — 열람 비밀번호를 입력하세요</p>
            <input type="password" autoFocus style={{ width: '100%' }}
              placeholder="열람 비밀번호" value={lock.pw}
              onChange={e => setLock({ ...lock, pw: e.target.value, err: '' })} />
            {lock.err && <p className="err">{lock.err}</p>}
            <div className="popup-btns">
              <button type="submit" className="primary">확인</button>
              <button type="button" onClick={() => setLock(null)}>취소</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

/* 글 작성·수정 폼 — 파일 다중 첨부 + 진행바 (관리자 화면에서도 재사용) */
export function BoardForm({ edit, onDone, onCancel }) {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const [title, setTitle] = useState(edit?.title || '')
  const [content, setContent] = useState(edit?.content || '')
  // 공개 범위: pub=공개, pw=공개(비밀번호 열람), prv=비공개(목록 비노출)
  const [scope, setScope] = useState(
    !edit ? 'pub' : !edit.is_public ? 'prv' : edit.has_passwd ? 'pw' : 'pub')
  const [passwd, setPasswd] = useState('')     // 공개(비밀번호) 열람 비밀번호 (수정 시 빈칸=유지)
  const [files, setFiles] = useState([])       // 신규 작성: 저장 시 함께 올릴 대기 파일
  const [editFiles, setEditFiles] = useState(edit?.files || [])  // 수정 시 기존 첨부
  const [upPct, setUpPct] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // 관련 작업 — "#번호 작업명" 검색 입력 (선택사항)
  const [tasks, setTasks] = useState([])
  const [taskSel, setTaskSel] = useState(
    edit?.taskid ? `#${edit.taskid} ${edit.task_name || ''}` : '')
  useEffect(() => {
    api.get('/tasks').then(r => setTasks(r.data)).catch(() => {})
  }, [])
  const fileRef = useRef(null)
  // 신규 작성 시 본문 이미지 — 게시글 ID가 없으므로 pending 토큰으로 보관하고
  // 저장(글 생성) 후 실제 fileid로 본문 URL을 치환한다
  const pendRef = useRef([])   // [{ token, file }]
  const pendingImage = async f => {
    const token = `pending-${Date.now()}-${pendRef.current.length}`
    pendRef.current.push({ token, file: f })
    return { fileid: token, file_name: f.name || 'image.png' }
  }

  // 수정 화면 전용: 게시글 ID가 이미 있으므로 선택 파일을 즉시 업로드
  const uploadNow = async () => {
    const fs = Array.from(fileRef.current?.files || [])
    if (!fs.length) { alert('첨부할 파일을 선택하세요'); return }
    const limMsg = attachCheck(me, editFiles.length, fs)
    if (limMsg) { setErr(limMsg); return }
    try {
      for (const f of fs) {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('boardid', edit.boardid)
        setUpPct(0)
        const { data } = await uploadWithProgress('/attach-files', fd, setUpPct)
        setEditFiles(list => [...list, data])
      }
      fileRef.current.value = ''
      setFiles([])
    } catch (e) {
      setErr(e.response?.data?.detail || '업로드에 실패했습니다')
    } finally { setUpPct(null) }
  }

  const delEditFile = f =>
    window.confirm(`'${f.file_name}'을(를) 삭제할까요?`) &&
    api.delete(`/attach-files/board/${f.fileid}`)
      .then(() => setEditFiles(list => list.filter(x => x.fileid !== f.fileid)))
      .catch(e => alert(e.response?.data?.detail || '삭제에 실패했습니다'))

  const save = async e => {
    e.preventDefault()
    setErr('')
    if (scope === 'pw' && !passwd && !(edit && edit.has_passwd)) {
      setErr('공개(비밀번호 열람)는 열람 비밀번호를 입력해 주세요'); return
    }
    const tm = (taskSel || '').match(/^#(\d+)/)
    if (taskSel.trim() && !tm) {
      setErr('관련 작업은 목록에서 "#번호 작업명" 형식으로 선택해 주세요'); return
    }
    const taskid = tm ? +tm[1] : null
    if (!edit) {   // 신규: 대기 파일 + 본문 임시 이미지 전부 사전 검사
      const limMsg = attachCheck(me, 0,
        [...files, ...pendRef.current.map(p => p.file)])
      if (limMsg) { setErr(limMsg); return }
    }
    try {
      setSaving(true)
      let boardid = edit?.boardid
      if (edit) {
        const body = { title, content, is_public: scope === 'prv' ? 0 : 1,
          taskid }
        if (scope === 'pw' && passwd) body.passwd = passwd      // 비밀번호 변경
        else if (scope === 'pub') body.passwd = ''              // 공개 전환 → 비밀번호 해제
        // prv는 passwd 미전송 → 서버가 비공개 전환과 함께 해제
        await api.put(`/boards/${boardid}`, body)
      } else {
        const { data } = await api.post('/boards', {
          title, content, is_public: scope === 'prv' ? 0 : 1,
          taskid, passwd: scope === 'pw' && passwd ? passwd : null })
        boardid = data.boardid
      }
      // 신규 작성 시에만: 저장하면서 대기 중인 파일들을 업로드
      if (!edit) {
        // 본문에 임시 URL로 삽입된 이미지 → 실제 첨부로 올리고 URL 치환
        let body2 = content
        for (const p of pendRef.current) {
          if (!body2.includes(`board/${p.token}/`)) continue  // 본문에서 지워진 임시 이미지
          const fd = new FormData()
          fd.append('file', p.file)
          fd.append('boardid', boardid)
          const { data } = await api.post('/attach-files', fd)
          body2 = body2.replaceAll(
            `board/${p.token}/download`, `board/${data.fileid}/download`)
        }
        if (body2 !== content)
          await api.put(`/boards/${boardid}`, { content: body2 })
        for (const f of files) {
          const fd = new FormData()
          fd.append('file', f)
          fd.append('boardid', boardid)
          setUpPct(0)
          await uploadWithProgress('/attach-files', fd, setUpPct)
        }
      }
      onDone()
    } catch (ex) {
      setErr(ex.response?.data?.detail || '저장에 실패했습니다')
    } finally { setSaving(false); setUpPct(null) }
  }

  return (
    <form className="bd-form" onSubmit={save}>
      <label>제목
        <input required maxLength={100} value={title}
          title="100자 이하로 입력하세요"
          onChange={e => setTitle(e.target.value)} />
      </label>
      <label>공개 여부
        <span className="bd-scope">
          <label><input type="radio" checked={scope === 'pub'}
            onChange={() => setScope('pub')} /> 공개</label>
          <label><input type="radio" checked={scope === 'pw'}
            onChange={() => setScope('pw')} /> 공개 (비밀번호 열람)</label>
          <label><input type="radio" checked={scope === 'prv'}
            onChange={() => setScope('prv')} /> 비공개</label>
        </span>
      </label>
      {scope === 'pw' && (
        <label>열람 비밀번호
          <input type="password" value={passwd} maxLength={50}
            placeholder={edit?.has_passwd ? '설정됨 — 변경 시에만 입력' : '열람 비밀번호 입력'}
            onChange={e => setPasswd(e.target.value)} />
        </label>
      )}
      <label>관련 작업
        <input list="bd-task-dl" value={taskSel}
          placeholder="작업 검색 (#번호·작업명) — 선택사항"
          onChange={e => setTaskSel(e.target.value)} />
        <datalist id="bd-task-dl">
          {tasks.map(t => <option key={t.taskid}
            value={`#${t.taskid} ${t.task_name}`} />)}
        </datalist>
      </label>
      <label>내용</label>
      <WorkLogEditor value={content} onChange={setContent} rows={10}
        boardid={edit?.boardid ?? null}
        pendingImage={edit ? null : pendingImage} />
      <label>첨부파일
        <span className="hint">({attachHint(me) || '제한 없음'})</span>
      </label>
      {edit && !!editFiles.length && (
        <table className="grid">
          <tbody>
            {editFiles.map(f => (
              <tr key={f.fileid}>
                <td>{f.file_name}</td>
                <td className="r" style={{ width: 90 }}>{fmtSize(f.file_size)}</td>
                <td className="r" style={{ width: 50 }}>
                  <button type="button" className="link"
                    onClick={() => delEditFile(f)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span>
        <label className="btn-file">파일 선택
          <input type="file" multiple hidden ref={fileRef}
            onChange={e => {
              const fs = Array.from(e.target.files || [])
              const limMsg = attachCheck(me,
                editFiles.length + (edit ? 0 : pendRef.current.length), fs)
              if (limMsg) { setErr(limMsg); e.target.value = ''; return }
              setErr(''); setFiles(fs)
            }} />
        </label>
        {edit &&
          <button type="button" onClick={uploadNow}
            disabled={!files.length || upPct != null}>업로드</button>}
      </span>
      {!!files.length &&
        <ul className="bd-filesel">
          {files.map((f, i) => <li key={i}>{f.name} ({fmtSize(f.size)})</li>)}
          {!edit && <li className="hint">저장 시 함께 업로드됩니다</li>}
        </ul>}
      <ProgressBar pct={upPct} />
      {err && <p className="err">{err}</p>}
      <div className="popup-btns">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? '저장 중…' : '저장'}</button>
        <button type="button" onClick={onCancel}>취소</button>
      </div>
    </form>
  )
}

/* 상세 — 본문·첨부파일·댓글 (팝업 공용: 사용자 게시판 + 관리자 게시판 탭) */
export function BoardDetail({ me, post, pw, onEdit, onDelete, onReload,
  onTitleDown, onClose }) {
  const [text, setText] = useState('')
  const [pick, setPick] = useState([])          // 업로드 대기 중인 선택 파일
  const [upPct, setUpPct] = useState(null)
  const fileRef = useRef(null)
  const staff = [0, 1].includes(me?.user_grade)

  const download = f =>
    downloadFile(`/attach-files/board/${f.fileid}/download` +
      (pw ? `?pw=${encodeURIComponent(pw)}` : ''))

  const uploadNow = async () => {
    if (!pick.length) { alert('첨부할 파일을 선택하세요'); return }
    const limMsg = attachCheck(me, (post.files || []).length, pick)
    if (limMsg) { alert(limMsg); return }
    try {
      for (const f of pick) {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('boardid', post.boardid)
        setUpPct(0)
        await uploadWithProgress('/attach-files', fd, setUpPct)
      }
      setPick([])
      if (fileRef.current) fileRef.current.value = ''
      onReload()
    } catch (e) {
      alert(e.response?.data?.detail || '업로드에 실패했습니다')
    } finally { setUpPct(null) }
  }

  const delFile = async f => {
    if (!window.confirm(`'${f.file_name}'을(를) 삭제할까요?`)) return
    try {
      await api.delete(`/attach-files/board/${f.fileid}`)
      onReload()
    } catch (e) { alert(e.response?.data?.detail || '삭제에 실패했습니다') }
  }

  const addComment = async () => {
    const t = text.trim()
    if (!t) return
    try {
      await api.post(`/boards/${post.boardid}/comments`,
        { content: t, passwd: pw || null })
      setText('')
      onReload()
    } catch (e) { alert(e.response?.data?.detail || '등록에 실패했습니다') }
  }

  const delComment = async c => {
    if (!window.confirm('댓글을 삭제할까요?')) return
    try {
      await api.delete(`/boards/${post.boardid}/comments/${c.commentid}`)
      onReload()
    } catch (e) { alert(e.response?.data?.detail || '삭제에 실패했습니다') }
  }

  // 공개 범위 변경 — pub 공개 / pw 공개(비밀번호 열람) / prv 비공개(목록 비노출)
  const scopeOf = p => !p.is_public ? 'prv' : (p.has_passwd ? 'pw' : 'pub')
  const setScope = v => {
    const body = { is_public: v === 'prv' ? 0 : 1 }
    if (v === 'pub') body.passwd = ''               // 공개 전환 → 비밀번호 해제
    if (v === 'pw' && !post.has_passwd) {           // 기존 비밀번호 없으면 입력받기
      const pw = window.prompt('열람 비밀번호를 입력하세요')
      if (!pw) return
      body.passwd = pw
    }
    api.put(`/boards/${post.boardid}`, body)
      .then(onReload)
      .catch(e => alert(e.response?.data?.detail || '변경에 실패했습니다'))
  }

  // 공개여부/수정/삭제/닫기 버튼 행 — 상·하단에 동일하게 표시
  const btns = (
    <div className="popup-btns">
      {post.can_edit && (
        <span className="bd-pubsel">
          공개여부
          <select value={scopeOf(post)}
            onChange={e => setScope(e.target.value)}>
            <option value="pub">공개</option>
            <option value="pw">공개(비밀번호 열람)</option>
            <option value="prv">비공개</option>
          </select>
        </span>
      )}
      {post.can_edit && onEdit && <button onClick={onEdit}>수정</button>}
      {post.can_edit && onDelete &&
        <button className="danger" onClick={onDelete}>삭제</button>}
      {onClose && <button onClick={onClose}>닫기</button>}
    </div>
  )

  return (
    <div className="bd-detail">
      <div className="bd-head">
        <h3 onMouseDown={onTitleDown}
          style={onTitleDown ? { cursor: 'move', userSelect: 'none' } : undefined}>
          {(post.has_passwd || !post.is_public) && '🔒 '}{post.title}
          {!post.is_public
            ? <span className="bd-private">비공개</span>
            : post.has_passwd && <span className="bd-private">비밀번호</span>}
        </h3>
        <span className="bd-meta">
          {post.user_name || post.user_id} · {fmtDT(post.create_date)}
          {post.update_date && ` (수정 ${fmtDT(post.update_date)})`}
          {post.taskid && ` · 관련작업 #${post.taskid} ${post.task_name || ''}`}
        </span>
      </div>
      {btns}
      {hasMd(post.content)
        ? <div className="bd-content md"
            dangerouslySetInnerHTML={mdHtml(post.content)} />
        : <div className="bd-content">{post.content || ''}</div>}

      <div className="blk-title">첨부파일</div>
      <table className="grid">
        <tbody>
          {(post.files || []).map(f => (
            <tr key={f.fileid}>
              <td>
                <button className="link" onClick={() => download(f)}>
                  {f.file_name}</button>
              </td>
              <td className="r" style={{ width: 90 }}>{fmtSize(f.file_size)}</td>
              <td className="r" style={{ width: 140 }}>{fmtDT(f.create_date)}</td>
              <td className="r" style={{ width: 50 }}>
                {post.can_edit &&
                  <button className="link" onClick={() => delFile(f)}>삭제</button>}
              </td>
            </tr>
          ))}
          {!post.files?.length &&
            <tr><td className="empty">첨부파일이 없습니다</td></tr>}
        </tbody>
      </table>
      {post.can_edit && (
        <div className="bd-attach-row">
          <label className="btn-file">파일 선택
            <input type="file" hidden multiple ref={fileRef}
              onChange={e => {
                const fs = Array.from(e.target.files || [])
                const limMsg = attachCheck(me, (post.files || []).length, fs)
                if (limMsg) { alert(limMsg); e.target.value = ''; return }
                setPick(fs)
              }} />
          </label>
          {!!pick.length &&
            <span className="bd-pickname">
              {pick.map(f => f.name).join(', ')}</span>}
          <button onClick={uploadNow}
            disabled={!pick.length || upPct != null}>업로드</button>
          {attachHint(me) &&
            <span className="hint"> {attachHint(me)}</span>}
        </div>
      )}
      <ProgressBar pct={upPct} />

      <div className="blk-title">댓글 {post.comments?.length || 0}</div>
      <div className="comment-list">
        {(post.comments || []).map(c => (
          <div key={c.commentid} className="comment-row">
            <div className="comment-head">
              <b>{c.user_name || c.user_id}</b>
              <span className="comment-date">{fmtDT(c.create_date)}</span>
              {(c.user_id === me?.userid || staff) &&
                <button className="link" onClick={() => delComment(c)}>삭제</button>}
            </div>
            <div className="comment-body">{c.content}</div>
          </div>
        ))}
        {!post.comments?.length &&
          <div className="comment-empty">댓글이 없습니다</div>}
      </div>
      <div className="comment-add">
        <textarea rows={2} maxLength={2000} value={text}
          placeholder="댓글을 입력하세요"
          onChange={e => setText(e.target.value)} />
        <button className="primary" onClick={addComment}>등록</button>
      </div>

      {btns}
    </div>
  )
}

/* 상세 팝업 — 오버레이 클릭·타이틀 드래그 (사용자 게시판 + 관리자 게시판 공용) */
export function BoardDetailPopup({ me, post, pw, onClose, onEdit, onDelete,
  onReload }) {
  const { pos, onDown } = useDrag()
  const downOnOverlay = useRef(false)   // 오버레이에서 눌러 오버레이에서 뗀 클릭만 닫기
  return (
    <div className="popup"
      onMouseDown={e => { if (e.target === e.currentTarget) downOnOverlay.current = true }}
      onClick={e => {
        if (e.target === e.currentTarget && downOnOverlay.current) onClose?.()
        downOnOverlay.current = false
      }}>
      <div className="popup-body task-popup" onClick={e => e.stopPropagation()}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        <BoardDetail me={me} post={post} pw={pw} onTitleDown={onDown}
          onEdit={onEdit} onDelete={onDelete} onReload={onReload}
          onClose={onClose} />
      </div>
    </div>
  )
}
