import { useCallback, useEffect, useRef, useState } from 'react'
import api, { fmtDT, fmtSize, uploadWithProgress, downloadFile } from '../api'
import ProgressBar from '../ProgressBar'

/* 게시판 — 목록 / 작성·수정 / 상세(첨부·댓글) */
export default function Board() {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const [view, setView] = useState('list')     // list | write | detail
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)         // 상세 대상
  const [edit, setEdit] = useState(null)       // 수정 대상 (write 폼 재사용)
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
      setView('detail')
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
      setSel(null); setView('list'); load()
    } catch (e) { alert(e.response?.data?.detail || '삭제에 실패했습니다') }
  }

  return (
    <div>
      <div className="toolbar">
        <input placeholder="제목/내용 검색" value={q}
          onChange={e => { setQ(e.target.value); load(e.target.value) }} />
        <span style={{ flex: 1 }} />
        {view === 'list' &&
          <button className="primary" onClick={() => { setEdit(null); setView('write') }}>글쓰기</button>}
        {view !== 'list' &&
          <button onClick={() => { setView('list'); setSel(null); setEdit(null); load() }}>목록</button>}
      </div>

      {view === 'list' && (
        <table className="grid">
          <thead><tr>
            <th style={{ width: 60 }}>번호</th><th>제목</th>
            <th style={{ width: 110 }}>작성자</th><th style={{ width: 70 }}>첨부</th>
            <th style={{ width: 70 }}>댓글</th><th style={{ width: 140 }}>작성일시</th>
          </tr></thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.boardid}>
                <td className="r">{b.boardid}</td>
                <td>
                  <button className="link" onClick={() => openDetail(b)}>
                    {!b.is_public && '🔒 '}{b.title}</button>
                  {!b.is_public && <span className="bd-private">비공개</span>}
                </td>
                <td>{b.user_name || b.user_id}</td>
                <td className="r">{b.file_count || ''}</td>
                <td className="r">{b.comment_count || ''}</td>
                <td className="r">{fmtDT(b.create_date)}</td>
              </tr>
            ))}
            {!rows.length &&
              <tr><td colSpan="6" className="empty">게시글이 없습니다</td></tr>}
          </tbody>
        </table>
      )}

      {view === 'write' &&
        <BoardForm me={me} edit={edit}
          onDone={() => { setView('list'); setEdit(null); load() }}
          onCancel={() => { setView('list'); setEdit(null) }} />}

      {view === 'detail' && sel &&
        <BoardDetail me={me} post={sel} pw={pw}
          onEdit={() => { setEdit(sel); setView('write') }}
          onDelete={() => delBoard(sel)}
          onReload={() => openDetail(sel, pw)} />}

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

/* 글 작성·수정 폼 — 파일 다중 첨부 + 진행바 */
function BoardForm({ edit, onDone, onCancel }) {
  const [title, setTitle] = useState(edit?.title || '')
  const [content, setContent] = useState(edit?.content || '')
  const [isPublic, setIsPublic] = useState(edit ? !!edit.is_public : true)
  const [passwd, setPasswd] = useState('')     // 비공개 열람 비밀번호 (수정 시 빈칸=유지)
  const [files, setFiles] = useState([])       // 신규 작성: 저장 시 함께 올릴 대기 파일
  const [editFiles, setEditFiles] = useState(edit?.files || [])  // 수정 시 기존 첨부
  const [upPct, setUpPct] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  // 수정 화면 전용: 게시글 ID가 이미 있으므로 선택 파일을 즉시 업로드
  const uploadNow = async () => {
    const fs = Array.from(fileRef.current?.files || [])
    if (!fs.length) { alert('첨부할 파일을 선택하세요'); return }
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
    try {
      setSaving(true)
      let boardid = edit?.boardid
      if (edit) {
        const body = { title, content, is_public: isPublic ? 1 : 0 }
        // 수정: 비공개일 때 비밀번호 입력값이 있으면 변경, 'clear' 동작은 해제
        if (!isPublic && passwd) body.passwd = passwd
        await api.put(`/boards/${boardid}`, body)
      } else {
        const { data } = await api.post('/boards', {
          title, content, is_public: isPublic ? 1 : 0,
          passwd: !isPublic && passwd ? passwd : null })
        boardid = data.boardid
      }
      // 신규 작성 시에만: 저장하면서 대기 중인 파일들을 업로드
      if (!edit) {
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
        <input required maxLength={200} value={title}
          onChange={e => setTitle(e.target.value)} />
      </label>
      <label>공개 여부
        <span className="bd-scope">
          <label><input type="radio" checked={isPublic}
            onChange={() => setIsPublic(true)} /> 공개</label>
          <label><input type="radio" checked={!isPublic}
            onChange={() => setIsPublic(false)} /> 비공개 (비밀번호 열람)</label>
        </span>
      </label>
      {!isPublic && (
        <label>열람 비밀번호
          <input type="password" value={passwd} maxLength={50}
            placeholder={edit?.has_passwd ? '설정됨 — 변경 시에만 입력' : '미설정 시 작성자·관리자만 열람'}
            onChange={e => setPasswd(e.target.value)} />
        </label>
      )}
      <label>내용
        <textarea rows={10} value={content}
          onChange={e => setContent(e.target.value)} />
      </label>
      <label>첨부파일</label>
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
            onChange={e => setFiles(Array.from(e.target.files || []))} />
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

/* 상세 — 본문·첨부파일·댓글 */
function BoardDetail({ me, post, pw, onEdit, onDelete, onReload }) {
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

  return (
    <div className="bd-detail">
      <div className="bd-head">
        <h3>
          {!post.is_public && '🔒 '}{post.title}
          {!post.is_public && <span className="bd-private">비공개</span>}
        </h3>
        <span className="bd-meta">
          {post.user_name || post.user_id} · {fmtDT(post.create_date)}
          {post.update_date && ` (수정 ${fmtDT(post.update_date)})`}
        </span>
      </div>
      <div className="bd-content">{post.content || ''}</div>

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
              onChange={e => setPick(Array.from(e.target.files || []))} />
          </label>
          {!!pick.length &&
            <span className="bd-pickname">
              {pick.map(f => f.name).join(', ')}</span>}
          <button onClick={uploadNow}
            disabled={!pick.length || upPct != null}>업로드</button>
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

      <div className="popup-btns">
        {post.can_edit && <button onClick={onEdit}>수정</button>}
        {post.can_edit &&
          <button className="danger" onClick={onDelete}>삭제</button>}
      </div>
    </div>
  )
}
