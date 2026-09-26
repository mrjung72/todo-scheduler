import { useEffect, useRef, useState } from 'react'
import api from '../api'

const empty = { userid: '', user_name: '', password: '', confirm: '',
  dept_name: '', job_title: '', user_tel: '', user_email: '' }
const TEL_RE = /^[0-9]{2,4}-?[0-9]{3,4}-?[0-9]{4}$/
const ID_RE = /^[a-z0-9._-]+$/

export default function Signup({ onBack, initial }) {
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState('')
  const [idState, setIdState] = useState('')   // '', 'checking', 'ok', 'dup', 'rej' 등
  const autoLoaded = useRef(false)

  // 로그인 화면에서 넘어온 승인불가 재신청: ID/비밀번호 미리 채움
  useEffect(() => {
    if (initial?.userid) {
      const uid = initial.userid.trim().toLowerCase()
      setForm(f => ({ ...f, userid: uid, password: initial.password || '',
        confirm: initial.password || '', user_email: `${uid}@sample.com` }))
    }
  }, [])

  // 회원ID 기가입 여부 실시간 체크
  useEffect(() => {
    if (!form.userid.trim()) { setIdState(''); return }
    if (!ID_RE.test(form.userid.trim())) { setIdState('chars'); return }
    if (form.userid.trim().length < 5) { setIdState('short'); return }
    if (form.userid.trim().length > 20) { setIdState('long'); return }
    setIdState('checking')
    const t = setTimeout(() => {
      api.get('/auth/check-userid', { params: { userid: form.userid.trim() } })
        .then(({ data }) => setIdState(data.exists ? (data.rejected ? 'rej' : 'dup') : 'ok'))
        .catch(() => setIdState(''))
    }, 300)
    return () => clearTimeout(t)
  }, [form.userid])

  // 승인불가 재신청 모드로 진입한 경우 기존 정보 자동 로드
  useEffect(() => {
    if (idState === 'rej' && initial?.userid && !autoLoaded.current) {
      autoLoaded.current = true
      loadInfo()
    }
  }, [idState])

  const submit = async e => {
    e.preventDefault()
    setErr('')
    const isReapply = idState === 'rej'
    if (idState !== 'ok' && !isReapply) {
      setErr(idState === 'dup' ? '이미 가입된 회원ID입니다'
        : idState === 'short' ? '회원ID는 5자 이상이어야 합니다'
        : idState === 'long' ? '회원ID는 20자 이하여야 합니다'
        : idState === 'chars' ? '영문, 숫자, _, -, . 만 사용할 수 있습니다'
        : '회원ID 중복 확인 중입니다'); return
    }
    if (form.password !== form.confirm) {
      setErr('비밀번호가 일치하지 않습니다'); return
    }
    if (!TEL_RE.test(form.user_tel.trim())) {
      setErr('연락처 형식이 올바르지 않습니다 (예: 010-1234-5678)'); return
    }
    try {
      const { confirm, ...body } = form
      const { data } = await api.post(isReapply ? '/auth/reapply' : '/auth/signup', body)
      alert(data.detail || (isReapply ? '수정된 정보로 재신청했습니다' : '가입 신청이 완료되었습니다'))
      onBack()
    } catch (ex) {
      setErr(ex.response?.data?.detail || '가입에 실패했습니다')
    }
  }

  const loadInfo = async () => {
    setErr('')
    if (!form.password) { setErr('비밀번호를 먼저 입력하세요'); return }
    try {
      const { data } = await api.post('/auth/rejected-info',
        { userid: form.userid.trim(), password: form.password })
      setForm(f => ({ ...f, ...data }))
      alert('기존 정보를 불러왔습니다. 수정 후 재신청하세요')
    } catch (ex) {
      setErr(ex.response?.data?.detail || '정보를 불러올 수 없습니다')
    }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const setId = e => {
    const v = e.target.value.toLowerCase()
    setForm({ ...form, userid: v, user_email: v.trim() ? `${v.trim()}@sample.com` : '' })
  }

  return (
    <div className="login-wrap">
      <form className="login-box signup-box" onSubmit={submit}>
        <h2>회원가입</h2>
        <p className="hint">{idState === 'rej'
          ? '승인불가된 회원입니다. 비밀번호를 입력하고 정보를 수정해 다시 신청하세요.'
          : '관리자 승인 후 로그인할 수 있습니다.'}</p>
        <input required autoFocus minLength={5} maxLength={20} placeholder="회원ID (5~20자)" value={form.userid} onChange={setId} />
        <div className="id-msg-slot">
          {idState === 'chars' && <div className="id-msg bad">영문, 숫자, _, -, . 만 사용할 수 있습니다</div>}
          {idState === 'short' && <div className="id-msg bad">5자 이상 입력해 주세요</div>}
          {idState === 'long' && <div className="id-msg bad">20자 이하로 입력해 주세요</div>}
          {idState === 'dup' && <div className="id-msg bad">이미 가입된 회원ID입니다</div>}
          {idState === 'rej' && <div className="id-msg bad">승인불가된 회원ID입니다 — 정보를 수정해 다시 신청할 수 있습니다</div>}
          {idState === 'ok' && <div className="id-msg good">사용 가능한 회원ID입니다</div>}
        </div>
        <input required placeholder="이름" value={form.user_name} onChange={set('user_name')} />
        <input required type="password" placeholder={idState === 'rej' ? '비밀번호 (본인확인)' : '비밀번호'}
          value={form.password} onChange={set('password')} />
        <input required type="password" placeholder="비밀번호 확인" value={form.confirm} onChange={set('confirm')} />
        {idState === 'rej' &&
          <button type="button" onClick={loadInfo}>본인확인 후 기존 정보 불러오기</button>}
        <input required placeholder="부서" value={form.dept_name} onChange={set('dept_name')} />
        <input required placeholder="직급" value={form.job_title} onChange={set('job_title')} />
        <input required placeholder="연락처 (예: 010-1234-5678)" value={form.user_tel} onChange={set('user_tel')} />
        <input required type="email" readOnly placeholder="이메일 (회원ID@sample.com 자동적용)"
          value={form.user_email} />
        {err && <div className="login-err">{err}</div>}
        <button type="submit" className="primary">{idState === 'rej' ? '수정 후 재신청' : '가입 신청'}</button>
        <button type="button" className="link" onClick={onBack}>로그인으로 돌아가기</button>
      </form>
    </div>
  )
}
