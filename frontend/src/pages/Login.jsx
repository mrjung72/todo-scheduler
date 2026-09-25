import { useState } from 'react'
import api from '../api'

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ userid: '', password: '' })
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setErr('')
    try {
      const { data } = await api.post('/auth/login', form)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      onLogin(data.user)
    } catch (ex) {
      setErr(ex.response?.data?.detail || '로그인 실패')
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-box" onSubmit={submit}>
        <h2>TODO 작업 스케줄러</h2>
        <input required autoFocus placeholder="사용자ID" value={form.userid}
          onChange={e => setForm({ ...form, userid: e.target.value })} />
        <input required type="password" placeholder="비밀번호" value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })} />
        {err && <div className="login-err">{err}</div>}
        <button type="submit" className="primary">로그인</button>
      </form>
    </div>
  )
}
