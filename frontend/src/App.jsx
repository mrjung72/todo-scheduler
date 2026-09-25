import { useEffect, useState } from 'react'
import { NavLink, Link, Route, Routes, Navigate } from 'react-router-dom'
import api from './api'
import Home from './pages/Home'
import TaskList from './pages/TaskList'
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
          <NavLink to="/tasks">작업목록</NavLink>
          <NavLink to="/calendar">달력</NavLink>
          {[0, 1].includes(me.user_grade) && <NavLink to="/admin">관리자</NavLink>}
        </nav>
        {cfg && (
          <span className="workhours" title={`WORK_SEGMENTS=${cfg.work_segments}`}>
            근무 {cfg.segments.map(s => `${s.start}~${s.end}`).join(', ')}
            {' '}(하루 {cfg.work_hours_per_day}h)
          </span>
        )}
        <span className="me">
          {me.user_name}({me.userid})
          <button className="logout" onClick={logout}>로그아웃</button>
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/admin" element={
            [0, 1].includes(me.user_grade) ? <Admin /> : <Navigate to="/tasks" replace />
          } />
        </Routes>
      </main>
    </div>
  )
}
