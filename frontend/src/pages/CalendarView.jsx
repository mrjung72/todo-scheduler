import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { taskColor, DAY_STAT_LABEL, STAT_LABEL, TASK_TYPE_LABEL,
  dutyOfGrade, isDevWorker, loadFilter, saveFilter } from '../api'
import TaskDetailPopup from '../TaskDetailPopup'

const p2 = n => String(n).padStart(2, '0')
const fmtYMD = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

// 작업바 길이 자체를 시작일·종료일의 작업시간 비율에 맞게 줄임
// (시작일 앞쪽 / 종료일 뒤쪽의 비작업 구간만큼 바를 안쪽으로 당김)
// 이벤트 extendedProps.daily = {date: {hours, spans:[[f0,f1]..]}}
//   f0/f1 = 그날 근무시간(점심 등 공백 제외한 실제 근무 합계) 기준 위치 비율
//   하루의 spans는 연속 구간이므로 첫 span의 f0, 마지막 span의 f1이 바의 양끝
function trimBarToWork(arg) {
  const p = arg.event.extendedProps || {}
  const harness = arg.el.closest('.fc-daygrid-event-harness')
  const dayEl = arg.el.closest('.fc-daygrid-day')
  if (!harness || !dayEl) return            // week뷰, +more 팝오버 등은 제외
  const segW = harness.offsetWidth          // 세그먼트(바) 전체 너비 px
  if (!segW) return

  // 개인휴가 바: 일부(P-오후/M-오전)는 차지하는 비율 구간만큼만 채움 (A는 전체 폭)
  if (p.holiday) {
    const s = p.span
    if (s && dayEl.offsetWidth) {
      if (s[0] > 0)
        arg.el.style.marginLeft = `${(s[0] * dayEl.offsetWidth / segW * 100).toFixed(3)}%`
      if (s[1] - s[0] < 1)
        arg.el.style.width = `${((s[1] - s[0]) * dayEl.offsetWidth / segW * 100).toFixed(3)}%`
    }
    return
  }
  if (!p.daily) return

  const startKey = fmtYMD(arg.event.start)
  let endKey = startKey
  if (arg.event.end) {
    const ed = new Date(arg.event.end)
    if (ed.getHours() === 0 && ed.getMinutes() === 0) ed.setDate(ed.getDate() - 1)
    endKey = fmtYMD(ed)
  }

  const startDay = p.daily[startKey]
  const endDay = p.daily[endKey]
  let f0 = startDay?.spans?.[0]?.[0]
  let f1 = endDay?.spans?.at(-1)?.[1]

  // 휴일 시작일(free): 시작일 칸은 전체 폭으로 표시 (여백 미적용)
  if (startDay?.free) {
    f0 = 0
    if (startKey === endKey) f1 = 1
  }

  // margin % 기준은 harness 너비. 토/일 칸이 좁으므로 칸별 실제 px 너비를 %로 환산
  // 시작일이 있는 세그먼트: 앞쪽 비작업 비율만큼 왼쪽 여백
  if (arg.isStart && f0 > 0 && dayEl.offsetWidth) {
    arg.el.style.marginLeft = `${(f0 * dayEl.offsetWidth / segW * 100).toFixed(3)}%`
  }
  // 종료일이 있는 세그먼트: 뒤쪽 비작업 비율만큼 오른쪽 여백
  if (arg.isEnd) {
    // 종료일 칸 = 같은 주(같은 tr) 안의 해당 날짜 td
    const endEl = dayEl.parentElement
      ?.querySelector(`td.fc-daygrid-day[data-date="${endKey}"]`)
    if (f1 != null && f1 < 1 && endEl?.offsetWidth) {
      arg.el.style.marginRight = `${((1 - f1) * endEl.offsetWidth / segW * 100).toFixed(3)}%`
    }
  }

  // 휴일(비작업일: daily 없음 또는 free) 칸과 겹치는 구간은 바탕색을 연하게
  const tr = dayEl.parentElement
  const light = []
  const elRect = arg.el.getBoundingClientRect()   // 여백 적용 후 실제 바 위치
  if (tr && elRect.width) {
    for (const td of tr.querySelectorAll('td.fc-daygrid-day')) {
      const r = td.getBoundingClientRect()
      const cellLeft = r.left - elRect.left
      const x0 = Math.max(0, cellLeft)
      const x1 = Math.min(elRect.width, r.right - elRect.left)
      if (x1 - x0 <= 0 || !r.width) continue
      const dd = p.daily[td.dataset.date]
      // 비작업 칸: 없거나 free(수동작업일)면 전체 연하게.
      // 점유구간(occ, 다른 작업이 차지한 시간)·휴가로 잘린 뒤쪽(off)도 연하게
      const offs = (!dd || dd.free) ? [[0, 1]]
        : [...(dd.occ || []), ...(dd.off ? [[1 - dd.off, 1]] : [])]
      const c0 = (x0 - cellLeft) / r.width, c1 = (x1 - cellLeft) / r.width
      for (const [a, b] of offs) {
        const lo = Math.max(c0, a), hi = Math.min(c1, b)
        if (hi > lo) light.push([
          (cellLeft + lo * r.width) / elRect.width,
          (cellLeft + hi * r.width) / elRect.width])
      }
    }
  }
  if (light.length) {
    const parts = []
    for (const [a, b] of light) {
      parts.push(`transparent ${(a * 100).toFixed(1)}%`)
      parts.push(`rgba(255,255,255,.55) ${(a * 100).toFixed(1)}%`)
      parts.push(`rgba(255,255,255,.55) ${(b * 100).toFixed(1)}%`)
      parts.push(`transparent ${(b * 100).toFixed(1)}%`)
    }
    arg.el.style.backgroundImage = `linear-gradient(to right, ${parts.join(', ')})`
  }
}

// Date 객체를 로컬 시각 'YYYY-MM-DD HH:mm'으로 포맷 (toISOString은 UTC라 9시간 밀림)
const fmtLocal = d => {
  if (!d) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function CalendarView() {
  const me = JSON.parse(localStorage.getItem('user') || 'null')
  const staff = me && [0, 1].includes(me.user_grade)
  // 휴가 등록: 관리자(0)·수석(1)·일반개발자(2)·IT담당자(5) (비스태프는 본인 휴가만)
  // 공통 휴일 등록: 0·1·5만
  const canReg = me && ['A', 'D'].includes(dutyOfGrade(me.user_grade))   // 개발 라인 휴가 등록
  const canRegDay = me && [0, 1].includes(me.user_grade)
  const [users, setUsers] = useState([])          // 휴가 등록 폼용
  const [events, setEvents] = useState([])
  const [dayEvents, setDayEvents] = useState([])
  const [holEvents, setHolEvents] = useState([])
  const [selected, setSelected] = useState(null)  // 휴가/휴일 팝업 대상
  const [selTask, setSelTask] = useState(null)    // 작업 상세 팝업 대상(공용 컴포넌트)
  const [sites, setSites] = useState([])
  const [dayMap, setDayMap] = useState({})
  // 초기값 = 저장된 검색조건, 없으면 사용자 기본사이트
  const [savedF] = useState(() => loadFilter('calendar'))
  const [siteFilter, setSiteFilter] = useState(() =>
    savedF.site ?? me?.default_siteid ?? '')
  const [q, setQ] = useState(savedF.q || '')
  const [typeFilter, setTypeFilter] = useState(savedF.type || '')
  const [workerFilter, setWorkerFilter] = useState(savedF.worker || '')
  const [showHol, setShowHol] = useState(savedF.holiday !== false)  // 작업자휴가 표시 여부
  // 달력은 대기중(W)/작업중(P) 스케줄만 표시 (서버에서도 W,P만 반환)
  const emptyHol = { kind: 'user', work_userid: '', holiday_category: 'A',
    holiday_half: 'PM', holiday_hours: 4, holiday_remark: '', date_stat: 'H' }
  const [holForm, setHolForm] = useState(null)  // {date:'yyyy-mm-dd', ...emptyHol}
  const calRef = useRef(null)
  const downOnOverlay = useRef(false)  // 오버레이에서 눌러 오버레이에서 뗀 클릭만 닫기

  const load = useCallback(async () => {
    const [{ data: evs }, { data: days }, { data: hols }] = await Promise.all([
      api.get('/schedules/events'),
      api.get('/calendar'),
      api.get('/user-holidays'),
    ])
    setEvents(evs.map(e => ({
      ...e,
      display: 'block',
      color: taskColor(e.extendedProps.taskid),
      classNames: ['arrow-event'],
    })))
    // 휴일/휴가를 배경 이벤트로 표시
    setDayMap(Object.fromEntries(days.map(d => [d.dateid, d])))
    setDayEvents(
      days.filter(d => d.date_stat !== 'W').map(d => ({
        start: `${d.dateid.slice(0, 4)}-${d.dateid.slice(4, 6)}-${d.dateid.slice(6, 8)}`,
        allDay: true,
        display: 'background',
        color: 'rgba(229,57,53,.18)',
        title: d.holiday_remark || DAY_STAT_LABEL[d.date_stat],
        extendedProps: { day_holiday: true },
      }))
    )
    // 작업자 개인 휴가를 종일 이벤트로 표시
    setHolEvents(hols.map(h => ({
      start: `${h.dateid.slice(0, 4)}-${h.dateid.slice(4, 6)}-${h.dateid.slice(6, 8)}`,
      allDay: true,
      title: `${h.user_name || h.work_userid} 휴가` +
        (h.holiday_category === 'P' ? `(오후 ${h.holiday_hours}h)`
          : h.holiday_category === 'M' ? `(오전 ${h.holiday_hours}h)` : '(종일)') +
        (h.holiday_remark ? ` ${h.holiday_remark}` : ''),
      color: '#fb8c00',
      classNames: ['holiday-event'],
      extendedProps: { holiday: true, ...h },
    })))
  }, [])

  useEffect(() => {
    load()
    api.get('/users').then(r => setUsers(r.data))
    api.get('/sites').then(r => setSites(r.data))
  }, [load])

  const onDateClick = (info) => {
    // 날짜 숫자를 눌렀을 때만 팝업 — 칸의 빈 공백 클릭은 무시
    if (!info.jsEvent.target.closest('.fc-daygrid-day-number')) return
    // 이벤트(작업바/휴가바) 위 클릭은 eventClick이 처리 -> 여기선 건너뜀
    if (info.jsEvent.target.closest('.fc-daygrid-event-harness, .fc-event')) return
    if (!canReg) return  // 휴가 등록 권한 없음
    setSelected(null)
    const date = info.dateStr.slice(0, 10)
    const day = dayMap[date.replaceAll('-', '')]
    // 비스태프: 해당 일자에 본인 휴가가 이미 있으면 수정 모드로 연다
    if (!staff) {
      const exist = holEvents.find(e => e.start === date &&
        e.extendedProps.work_userid === me.userid)
      if (exist) {
        const h = exist.extendedProps
        setHolForm({ date, ...emptyHol, edit: true,
          work_userid: h.work_userid,
          holiday_category: h.holiday_category === 'M' ? 'P' : h.holiday_category,
          holiday_half: h.holiday_category === 'M' ? 'AM' : 'PM',
          holiday_hours: h.holiday_hours || 4,
          holiday_remark: h.holiday_remark || '' })
        return
      }
    }
    setHolForm({ date, ...emptyHol,
      work_userid: me.userid,   // 기본 본인 — 스태프는 선택 변경 가능
      date_stat: 'H',
      holiday_remark: day?.holiday_remark || '' })
  }

  const saveHoliday = async e => {
    e.preventDefault()
    const dateid = holForm.date.replaceAll('-', '')
    if (holForm.kind === 'day') {
      // 공통 휴일: calendar_define 에 없으면 생성, 있으면 갱신
      if (dayMap[dateid]) {
        await api.put(`/calendar/${dateid}`, {
          date_stat: holForm.date_stat,
          holiday_remark: holForm.holiday_remark,
        })
      } else {
        await api.post('/calendar', {
          dateid, date_name: holForm.date,
          date_stat: holForm.date_stat,
          holiday_remark: holForm.holiday_remark,
        })
      }
    } else {
      if (!holForm.work_userid) return
      const body = {
        holiday_category: holForm.holiday_category === 'P'
          ? (holForm.holiday_half === 'AM' ? 'M' : 'P')
          : 'A',
        holiday_hours: holForm.holiday_category === 'P' ? +holForm.holiday_hours : 0,
        holiday_remark: holForm.holiday_remark,
      }
      // 수정 모드이거나 해당 일자+작업자의 휴가가 이미 있으면 갱신(PUT)
      const exist = holForm.edit || holEvents.some(e =>
        e.start === holForm.date &&
        e.extendedProps.work_userid === holForm.work_userid)
      if (exist) {
        await api.put(`/user-holidays/${dateid}/${holForm.work_userid}`, body)
      } else {
        await api.post('/user-holidays', {
          dateid, work_userid: holForm.work_userid, ...body })
      }
    }
    setHolForm(null)
    load()
  }

  const delHoliday = async () => {
    if (!window.confirm('휴가를 삭제할까요?')) return
    await api.delete(`/user-holidays/${selected.dateid}/${selected.work_userid}`)
    setSelected(null)
    load()
  }

  // 휴가 조회 팝업에서 수정 모드로 전환
  const editHoliday = () => {
    const h = selected, d = h.dateid
    setHolForm({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      ...emptyHol, edit: true,
      work_userid: h.work_userid,
      holiday_category: h.holiday_category === 'M' ? 'P' : h.holiday_category,
      holiday_half: h.holiday_category === 'M' ? 'AM' : 'PM',
      holiday_hours: h.holiday_hours || 4,
      holiday_remark: h.holiday_remark || '' })
    setSelected(null)
  }

  const onEventClick = (info) => {
    const p = { ...info.event.extendedProps, title: info.event.title,
      start: info.event.start, end: info.event.end }
    if (p.holiday) { setSelected(p); return }
    // 공통휴일 배경 이벤트 등 taskid 없는 이벤트는 팝업 대상 아님
    if (!p.taskid) return
    // 작업 이벤트 → 공용 작업 상세 팝업 (TaskDetail 형태로 매핑)
    setSelTask({
      ...p,
      task_name: info.event.title,
      task_start_date: fmtLocal(info.event.start),
      task_end_date_estimated: fmtLocal(info.event.end),
    })
  }

  const kw = q.trim().toLowerCase()
  const filtered = events.filter(e => {
    const p = e.extendedProps || {}
    if (siteFilter && p.siteid !== siteFilter) return false
    if (typeFilter && p.task_type !== typeFilter) return false
    if (workerFilter && p.work_userid !== workerFilter) return false
    if (kw && ![e.title, p.work_user_name, p.work_userid, p.site_name]
      .some(v => (v ?? '').toString().toLowerCase().includes(kw))) return false
    return true
  })
  // 작업자 휴가도 작업자 필터/검색어(작업자명/ID/설명)로 필터링
  const filteredHol = holEvents.filter(e => {
    const p = e.extendedProps || {}
    if (workerFilter && p.work_userid !== workerFilter) return false
    if (kw && ![e.title, p.user_name, p.work_userid]
      .some(v => (v ?? '').toString().toLowerCase().includes(kw))) return false
    return true
  })

  return (
    <div className="calendar-wrap">
      <div className="toolbar">
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="">사이트(전체)</option>
          {sites.map(s => <option key={s.siteid} value={s.siteid}>{s.site_name}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">유형(전체)</option>
          {Object.entries(TASK_TYPE_LABEL).map(([k, v]) =>
            <option key={k} value={k}>{v}({k})</option>)}
        </select>
        <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)}>
          <option value="">작업자(전체)</option>
          {users.filter(isDevWorker)
            .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
        </select>
        <input
          placeholder="검색어 (작업명/작업자/사이트)"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <button onClick={() => {
          saveFilter('calendar', { site: siteFilter, q, type: typeFilter, worker: workerFilter, holiday: showHol })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
        <label className="hint-inline" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={showHol}
            onChange={e => setShowHol(e.target.checked)} /> 작업자휴가
        </label>
        <span className="hint-notice">대기중/작업중 작업만 표시</span>
      </div>
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek',
        }}
        locale="ko"
        height="100%"
        fixedWeekCount={false}
        events={[...filtered, ...dayEvents, ...(showHol ? filteredHol : [])]}
        eventClick={onEventClick}
        dateClick={onDateClick}
        eventDidMount={trimBarToWork}
        eventContent={(arg) => {
          if (arg.event.extendedProps.holiday) return arg.event.title
          const w = arg.event.extendedProps.work_user_name
            || arg.event.extendedProps.work_userid || ''
          const stat = STAT_LABEL[arg.event.extendedProps.task_stat] || ''
          const csr = arg.event.extendedProps.task_csrid
          const site = arg.event.extendedProps.site_name
          const req = arg.event.extendedProps.req_user_name
            || arg.event.extendedProps.req_userid
          const prio = arg.event.extendedProps.priority
          return (
            <div className="ev-line">
              <span className="ev-id">#{arg.event.extendedProps.taskid}</span>
              {prio != null && <span className="ev-prio">{prio}</span>}
              {!!arg.event.extendedProps.holiday_work &&
                <span className="badge hol-badge">휴일</span>}
              {!!arg.event.extendedProps.weekday_included &&
                <span className="badge warn-badge" title="휴일작업 기간에 평일이 포함되어 있습니다">평일</span>}
              {site && <span className="ev-site">{site}</span>}
              {csr && <span className="csr">{csr}</span>}
              {req && <span className="ev-req">{req}</span>}
              <span className="ev-title">{arg.event.title}</span>
              {w && <span className="ev-worker">{w}</span>}
              {stat && <span className="ev-stat">{stat}</span>}
            </div>
          )
        }}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        dayMaxEventRows={6}
        datesSet={load}
      />
      {selected?.holiday && (
        <div className="popup"
          onMouseDown={e => { if (e.target === e.currentTarget) downOnOverlay.current = true }}
          onClick={e => {
            if (e.target === e.currentTarget && downOnOverlay.current) setSelected(null)
            downOnOverlay.current = false
          }}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3 className="popup-title" style={{ background: '#fb8c00' }}>
              {selected.start &&
                `${selected.start.getMonth() + 1}/${selected.start.getDate()} `}
              {selected.title}
            </h3>
            <div className="popup-info">
              <p><b>작업자</b> {selected.user_name || selected.work_userid}</p>
              <p><b>구분</b> {selected.holiday_category === 'A' ? '종일'
                : `일부 (${selected.holiday_category === 'M' ? '오전' : '오후'} ${selected.holiday_hours}h)`}</p>
              {selected.holiday_remark && <p><b>설명</b> {selected.holiday_remark}</p>}
            </div>
            <div className="popup-btns">
              {canReg && (staff || selected.work_userid === me?.userid) && (
                <>
                  <button className="primary" onClick={editHoliday}>수정</button>
                  <button onClick={delHoliday}>삭제</button>
                </>
              )}
              <button onClick={() => setSelected(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {selTask && <TaskDetailPopup task={selTask}
        onClose={() => setSelTask(null)} onChanged={load} />}
      {holForm && (
        <div className="popup"
          onMouseDown={e => { if (e.target === e.currentTarget) downOnOverlay.current = true }}
          onClick={e => {
            if (e.target === e.currentTarget && downOnOverlay.current) setHolForm(null)
            downOnOverlay.current = false
          }}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>{holForm.date.slice(5).replace('-', '/')} {holForm.edit ? '휴가 수정' : '휴일/휴가 등록'}</h3>
            <form className="holiday-form" onSubmit={saveHoliday}>
              {!holForm.edit && canRegDay && (
                <label>등록구분
                  <select value={holForm.kind}
                    onChange={e => setHolForm({ ...holForm, kind: e.target.value })}>
                    <option value="user">개인 휴가</option>
                    <option value="day">공통 휴일</option>
                  </select>
                </label>
              )}
              {holForm.kind === 'user' ? (
                <>
                  <label>작업자
                    {staff ? (
                      <select required disabled={!!holForm.edit}
                        value={holForm.work_userid}
                        onChange={e => {
                          const uid = e.target.value
                          // 선택한 작업자가 해당일 휴가를 이미 등록했으면 수정 모드로
                          const exist = holEvents.find(ev => ev.start === holForm.date &&
                            ev.extendedProps.work_userid === uid)
                          setHolForm(exist
                            ? { ...holForm, work_userid: uid, edit: true,
                                holiday_category: exist.extendedProps.holiday_category,
                                holiday_hours: exist.extendedProps.holiday_hours || 4,
                                holiday_remark: exist.extendedProps.holiday_remark || '' }
                            : { ...holForm, work_userid: uid, edit: false })
                        }}>
                        <option value="">선택</option>
                        {me && !users.some(u => u.userid === me.userid && isDevWorker(u)) &&
                          <option value={me.userid}>{me.user_name || me.userid}</option>}
                        {users.filter(isDevWorker)
                          .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
                      </select>
                    ) : (
                      <span>{users.find(u => u.userid === holForm.work_userid)?.user_name
                        || holForm.work_userid}</span>
                    )}
                  </label>
                  <label>구분
                    <select value={holForm.holiday_category}
                      onChange={e => setHolForm({ ...holForm, holiday_category: e.target.value })}>
                      <option value="A">종일</option>
                      <option value="P">일부(시간)</option>
                    </select>
                  </label>
                  {holForm.holiday_category === 'P' && (<>
                    <label>시간대
                      <select value={holForm.holiday_half}
                        onChange={e => setHolForm({ ...holForm, holiday_half: e.target.value })}>
                        <option value="AM">오전</option>
                        <option value="PM">오후</option>
                      </select>
                    </label>
                    <label>휴가시간
                      <input type="number" min="0.5" step="0.5" required
                        value={holForm.holiday_hours}
                        onChange={e => setHolForm({ ...holForm, holiday_hours: e.target.value })} />
                    </label>
                  </>)}
                </>
              ) : (
                <label>구분
                  <select value={holForm.date_stat}
                    onChange={e => setHolForm({ ...holForm, date_stat: e.target.value })}>
                    {Object.entries(DAY_STAT_LABEL)
                      .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              )}
              <label>설명
                <input placeholder="예: 연차, 오후반차, 공휴일" value={holForm.holiday_remark}
                  onChange={e => setHolForm({ ...holForm, holiday_remark: e.target.value })} />
              </label>
              <div className="popup-btns">
                <button type="submit" className="primary">{holForm.edit ? '저장' : '등록'}</button>
                <button type="button" onClick={() => setHolForm(null)}>취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
