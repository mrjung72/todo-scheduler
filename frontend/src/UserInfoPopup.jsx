import { useEffect, useState } from 'react'
import api, { GRADE_LABEL, USER_STAT_LABEL, DUTY_LABEL, isDevWorker } from './api'

// 사용자 정보 팝업 (작업목록/작업스케쥴의 담당자·작업자 클릭 시)
// users: 이미 로드된 사용자 목록 — 없으면 /users 를 조회해 보완
export default function UserInfoPopup({ userid, users, sites, onClose }) {
  const [u, setU] = useState(users?.find(x => x.userid === userid) || null)

  useEffect(() => {
    setU(users?.find(x => x.userid === userid) || null)
  }, [userid, users])
  useEffect(() => {
    if (!u && userid)
      api.get('/users')
        .then(r => setU(r.data.find(x => x.userid === userid) || { userid }))
        .catch(() => setU({ userid }))
  }, [u, userid])

  const siteName = u?.default_siteid &&
    (sites?.find(s => s.siteid === u.default_siteid)?.site_name || u.default_siteid)

  return (
    <div className="popup" onClick={onClose}>
      <div className="popup-body" onClick={e => e.stopPropagation()}>
        <h3 className="popup-title" style={{ background: '#47698a' }}>사용자 정보</h3>
        <div className="popup-info">
          <p><b>이름</b><span>{u?.user_name || '-'}</span></p>
          <p><b>ID</b><span>{u?.userid || userid}</span></p>
          <p><b>등급</b><span>{u ? (GRADE_LABEL[u.user_grade] || u.user_grade) : '-'}</span></p>
          <p><b>담당분류</b><span>{u ? (DUTY_LABEL[u.duty_class] || '-') : '-'}</span></p>
          <p><b>소속부서</b><span>{u?.dept_name || '-'}</span></p>
          <p><b>직책</b><span>{u?.job_title || '-'}</span></p>
          <p><b>연락처</b><span>{u?.user_tel || '-'}</span></p>
          <p><b>이메일</b><span>{u?.user_email || '-'}</span></p>
          <p><b>기본사이트</b><span>{siteName || '-'}</span></p>
          {u && isDevWorker(u) &&
            <p><b>하루작업시간</b><span>{u.work_hours_day ? `${u.work_hours_day}시간` : '기본'}</span></p>}
          <p><b>회원상태</b><span>{u ? (USER_STAT_LABEL[u.user_stat] || u.user_stat) : '-'}</span></p>
        </div>
        <div className="popup-btns">
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}
