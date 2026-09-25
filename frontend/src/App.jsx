import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import api from './api'
import TaskList from './pages/TaskList'
import CalendarView from './pages/CalendarView'
import Admin from './pages/Admin'

export default function App() {
  const [cfg, setCfg] = useState(null)
  useEffect(() => {
    api.get('/config').then(r => setCfg(r.data)).catch(() => {})
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">TODO 작업 스케줄러</span>
        <nav>
          <NavLink to="/tasks">작업목록</NavLink>
          <NavLink to="/calendar">달력</NavLink>
          <NavLink to="/admin">관리자</NavLink>
        </nav>
        {cfg && (
          <span className="workhours" title={`WORK_SEGMENTS=${cfg.work_segments}`}>
            근무 {cfg.segments.map(s => `${s.start}~${s.end}`).join(', ')}
            {' '}(하루 {cfg.work_hours_per_day}h)
          </span>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  )
}
