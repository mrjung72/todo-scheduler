import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import TaskList from './pages/TaskList'
import CalendarView from './pages/CalendarView'
import Admin from './pages/Admin'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">TODO 작업 스케줄러</span>
        <nav>
          <NavLink to="/tasks">작업목록</NavLink>
          <NavLink to="/calendar">달력</NavLink>
          <NavLink to="/admin">관리자</NavLink>
        </nav>
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
