import { useState } from 'react'
import api from '../api'

export default function Login({ onLogin, onSignup, onReapply }) {
  const [form, setForm] = useState({ userid: '', password: '' })
  const [err, setErr] = useState('')
  const [rej, setRej] = useState(false)   // 승인불가 계정 여부

  const submit = async e => {
    e.preventDefault()
    setErr(''); setRej(false)
    try {
      const { data } = await api.post('/auth/login', form)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      onLogin(data.user)
    } catch (ex) {
      setErr(ex.response?.data?.detail || '로그인 실패')
      if (ex.response?.status === 401) {
        try {
          const { data } = await api.get('/auth/check-userid',
            { params: { userid: form.userid.trim().toLowerCase() } })
          if (data.rejected) setRej(true)
        } catch { /* 조회 실패 시 버튼 미표시 */ }
      }
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
        {rej &&
          <button type="button" className="primary"
            onClick={() => onReapply(form)}>회원정보 수정</button>}
        <button type="submit" className="primary">로그인</button>
        <button type="button" className="link" onClick={onSignup}>회원가입</button>
      </form>
    </div>
  )
}
