import { useId } from 'react'
import { isReqUser } from './api'

// 검색 가능한 요청자 선택 입력: 텍스트 입력 + 리스트다운(datalist)
// "이름" 또는 "이름 (ID)" 자유 입력 — 값 표시는 입력 텍스트,
// 실제 필터는 resolveUserid()로 userid 변환 후 적용한다.
export default function ReqUserInput({ users, value, onChange,
  placeholder = '요청자(전체)' }) {
  const dlId = `req-dl-${useId().replace(/:/g, '')}`
  return (
    <>
      <input list={dlId} placeholder={placeholder} value={value}
        style={{ width: 160 }}
        onChange={e => onChange(e.target.value)} />
      <datalist id={dlId}>
        {users.filter(isReqUser).map(u =>
          <option key={u.userid} value={`${u.user_name} (${u.userid})`} />)}
      </datalist>
    </>
  )
}
