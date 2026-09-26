import { useEffect, useState } from 'react'
import { NavLink, Link, Route, Routes, Navigate } from 'react-router-dom'
import api, { GRADE_LABEL } from './api'
import Home from './pages/Home'
import TaskList from './pages/TaskList'
import Kanban from './pages/Kanban'
import CalendarView from './pages/CalendarView'
import Admin from './pages/Admin'
import Login from './pages/Login'

export default function App() {
  const [cfg, setCfg] = useState(null)
  const [me, setMe] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })

  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data)).catch(() => {})
  }, [])

  const [wantLogin, setWantLogin] = useState(false)
  const [profile, setProfile] = useState(null)   // 사용자 상세 팝업
  const [pwOpen, setPwOpen] = useState(false)    // 비밀번호 변경 팝업
  const [pw, setPw] = useState({ cur: '', next: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  const openProfile = () => {
    setPwOpen(false)
    api.get('/users/me').then(r => setProfile(r.data)).catch(() => setProfile(me))
  }

  const openPw = () => {
    setPw({ cur: '', next: '', confirm: '' }); setPwMsg(''); setPwErr('')
    setPwOpen(true)
  }

  const changePw = async e => {
    e.preventDefault()
    setPwMsg(''); setPwErr('')
    if (pw.next !== pw.confirm) { setPwErr('새 비밀번호가 일치하지 않습니다'); return }
    try {
      await api.post('/users/me/password', {
        current_password: pw.cur, new_password: pw.next,
      })
      setPwMsg('비밀번호가 변경되었습니다')
      setPw({ cur: '', next: '', confirm: '' })
    } catch (err) {
      setPwErr(err.response?.data?.detail || '변경에 실패했습니다')
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setMe(null)
  }

  // 비로그인: 홈 화면만 공개, [로그인] 버튼으로 로그인 화면 전환
  if (!me || !localStorage.getItem('token')) {
    if (wantLogin) return <Login onLogin={u => { setMe(u); setWantLogin(false) }} />
    return (
      <div className="app">
        <header className="topbar">
          <Link to="/" className="logo">
            TODO 작업 스케줄러{cfg && <span className="version"> v{cfg.version}</span>}
          </Link>
          <button className="primary" style={{ marginLeft: 'auto' }}
            onClick={() => setWantLogin(true)}>로그인</button>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="logo">
          TODO 작업 스케줄러{cfg && <span className="version"> v{cfg.version}</span>}
        </Link>
        <nav>
          <NavLink to="/kanban">칸반</NavLink>
          <NavLink to="/calendar">달력</NavLink>
          <NavLink to="/tasks">작업목록</NavLink>
          {[0, 1].includes(me.user_grade) && <NavLink to="/admin">관리자</NavLink>}
        </nav>
        {cfg && (
          <span className="workhours" title={`WORK_SEGMENTS=${cfg.work_segments}`}>
            {cfg.work_hours_per_day} 시간/일 작업 기준
          </span>
        )}
        <span className="me">
          <button className="mebtn" title="사용자 정보"
            onClick={openProfile}>{me.user_name}({me.userid})</button>
          <button className="logout" onClick={logout}>로그아웃</button>
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/kanban" element={<Kanban />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/admin" element={
            [0, 1].includes(me.user_grade) ? <Admin /> : <Navigate to="/tasks" replace />
          } />
        </Routes>
      </main>
      {profile && (
        <div className="popup" onClick={() => setProfile(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>사용자 정보</h3>
            <p><b>ID</b> {profile.userid}</p>
            <p><b>이름</b> {profile.user_name}</p>
            <p><b>부서/직급</b> {[profile.dept_name, profile.job_title]
              .filter(Boolean).join(' / ') || '-'}</p>
            <p><b>연락처</b> {profile.user_tel || '-'}</p>
            <p><b>이메일</b> {profile.user_email || '-'}</p>
            <p><b>등급</b> {GRADE_LABEL[profile.user_grade] ?? profile.user_grade}</p>
            <p><b>기본사이트</b> {profile.default_siteid || '-'}</p>
            <div className="popup-btns">
              <button onClick={openPw}>비밀번호 변경</button>
              <button onClick={() => setProfile(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {pwOpen && (
        <div className="popup" onClick={() => setPwOpen(false)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>비밀번호 변경</h3>
            <form className="holiday-form" onSubmit={changePw}>
              <label>현재 비밀번호
                <input type="password" required value={pw.cur}
                  onChange={e => setPw({ ...pw, cur: e.target.value })} />
              </label>
              <label>새 비밀번호
                <input type="password" required value={pw.next}
                  onChange={e => setPw({ ...pw, next: e.target.value })} />
              </label>
              <label>새 비밀번호 확인
                <input type="password" required value={pw.confirm}
                  onChange={e => setPw({ ...pw, confirm: e.target.value })} />
              </label>
              {pwMsg && <p className="msg">{pwMsg}</p>}
              {pwErr && <p className="err">{pwErr}</p>}
              <div className="popup-btns">
                <button type="submit" className="primary">비밀번호 변경</button>
                <button type="button" onClick={() => setPwOpen(false)}>닫기</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
