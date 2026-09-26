import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { taskColor, DAY_STAT_LABEL, STAT_LABEL,
  loadFilter, saveFilter } from '../api'
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

  // 개인휴가 바: 일부(P)는 하루 근무의 뒤쪽 비율만큼만 채움 (A는 전체 폭)
  if (p.holiday) {
    const s = p.span
    if (s?.[0] > 0 && dayEl.offsetWidth) {
      arg.el.style.marginLeft = `${(s[0] * dayEl.offsetWidth / segW * 100).toFixed(3)}%`
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
      const x0 = Math.max(0, r.left - elRect.left)
      const x1 = Math.min(elRect.width, r.right - elRect.left)
      if (x1 - x0 <= 0) continue
      const dd = p.daily[td.dataset.date]
      if (!dd || dd.free) light.push([x0 / elRect.width, x1 / elRect.width])
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
  const admin = me?.user_grade === 0
  // 휴일/휴가 등록: 관리자(0)·개발자(1)·IT담당자(2) (비관리자는 본인 휴가만)
  const canReg = me && [0, 1, 2].includes(me.user_grade)
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
  // 달력은 대기중(W)/작업중(P) 스케줄만 표시 (서버에서도 W,P만 반환)
  const emptyHol = { kind: 'user', work_userid: '', holiday_category: 'A',
    holiday_hours: 4, holiday_remark: '', date_stat: 'H' }
  const [holForm, setHolForm] = useState(null)  // {date:'yyyy-mm-dd', ...emptyHol}
  const calRef = useRef(null)

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
      }))
    )
    // 작업자 개인 휴가를 종일 이벤트로 표시
    setHolEvents(hols.map(h => ({
      start: `${h.dateid.slice(0, 4)}-${h.dateid.slice(4, 6)}-${h.dateid.slice(6, 8)}`,
      allDay: true,
      title: `${h.user_name || h.work_userid} 휴가` +
        (h.holiday_category === 'P' ? `(${h.holiday_hours}h)` : '(종일)') +
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
    // 이벤트(작업바/휴가바) 위 클릭은 eventClick이 처리 -> 여기선 건너뜀
    if (info.jsEvent.target.closest('.fc-daygrid-event-harness, .fc-event')) return
    if (!canReg) return  // 관리자/개발자만 휴일·휴가 등록 가능
    setSelected(null)
    const date = info.dateStr.slice(0, 10)
    const day = dayMap[date.replaceAll('-', '')]
    setHolForm({ date, ...emptyHol,
      work_userid: admin ? '' : me.userid,   // 개발자는 본인 고정
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
      await api.post('/user-holidays', {
        dateid,
        work_userid: holForm.work_userid,
        holiday_category: holForm.holiday_category,
        holiday_hours: holForm.holiday_category === 'P' ? +holForm.holiday_hours : 0,
        holiday_remark: holForm.holiday_remark,
      })
    }
    setHolForm(null)
    load()
  }

  const onEventClick = (info) => {
    const p = { ...info.event.extendedProps, title: info.event.title,
      workschid: info.event.id, start: info.event.start, end: info.event.end }
    if (p.holiday) { setSelected(p); return }
    // 작업 이벤트 → 공용 작업 상세 팝업 (TaskDetail 형태로 매핑)
    setSelTask({
      ...p,
      task_name: info.event.title,
      workschid: +info.event.id,
      start_datetime: fmtLocal(info.event.start),
      end_datetime_estimated: fmtLocal(info.event.end),
    })
  }

  const kw = q.trim().toLowerCase()
  const filtered = events.filter(e => {
    const p = e.extendedProps || {}
    if (siteFilter && p.siteid !== siteFilter) return false
    if (kw && ![e.title, p.work_user_name, p.work_userid, p.site_name]
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
        <input
          placeholder="검색어 (작업명/작업자/사이트)"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <span className="hint-inline">대기중/작업중 작업만 표시</span>
        <button onClick={() => {
          saveFilter('calendar', { site: siteFilter, q })
          alert('현재 검색조건을 저장했습니다')
        }}>검색조건 저장</button>
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
        events={[...filtered, ...dayEvents, ...holEvents]}
        eventClick={onEventClick}
        dateClick={onDateClick}
        eventDidMount={trimBarToWork}
        eventContent={(arg) => {
          if (arg.event.extendedProps.holiday) return arg.event.title
          const w = arg.event.extendedProps.work_user_name
            || arg.event.extendedProps.work_userid || ''
          const stat = STAT_LABEL[arg.event.extendedProps.work_stat
            || arg.event.extendedProps.task_stat] || ''
          const csr = arg.event.extendedProps.task_csrid
          const site = arg.event.extendedProps.site_name
          const req = arg.event.extendedProps.req_user_name
            || arg.event.extendedProps.req_userid
          return (
            <div className="ev-line">
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
        <div className="popup" onClick={() => setSelected(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3 className="popup-title" style={{ background: '#fb8c00' }}>
              {selected.start &&
                `${selected.start.getMonth() + 1}/${selected.start.getDate()} `}
              {selected.title}
            </h3>
            <div className="popup-info">
              <p><b>작업자</b> {selected.user_name || selected.work_userid}</p>
              <p><b>구분</b> {selected.holiday_category === 'A' ? '종일' : `일부 (${selected.holiday_hours}h)`}</p>
              {selected.holiday_remark && <p><b>설명</b> {selected.holiday_remark}</p>}
            </div>
            <div className="popup-btns">
              <button onClick={() => setSelected(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {selTask && <TaskDetailPopup task={selTask}
        onClose={() => setSelTask(null)} onChanged={load} />}
      {holForm && (
        <div className="popup" onClick={() => setHolForm(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>{holForm.date.slice(5).replace('-', '/')} 휴일/휴가 등록</h3>
            <form className="holiday-form" onSubmit={saveHoliday}>
              {canReg && (
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
                    {admin ? (
                      <select required value={holForm.work_userid}
                        onChange={e => setHolForm({ ...holForm, work_userid: e.target.value })}>
                        <option value="">선택</option>
                        {users.filter(u => u.user_grade === 1)
                          .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
                      </select>
                    ) : (
                      <span>{users.find(u => u.userid === me.userid)?.user_name || me.userid}</span>
                    )}
                  </label>
                  <label>구분
                    <select value={holForm.holiday_category}
                      onChange={e => setHolForm({ ...holForm, holiday_category: e.target.value })}>
                      <option value="A">종일</option>
                      <option value="P">일부(시간)</option>
                    </select>
                  </label>
                  {holForm.holiday_category === 'P' && (
                    <label>휴가시간
                      <input type="number" min="0.5" step="0.5" required
                        value={holForm.holiday_hours}
                        onChange={e => setHolForm({ ...holForm, holiday_hours: e.target.value })} />
                    </label>
                  )}
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
                <button type="submit" className="primary">등록</button>
                <button type="button" onClick={() => setHolForm(null)}>취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
