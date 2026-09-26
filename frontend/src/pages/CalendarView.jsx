import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { taskColor, DAY_STAT_LABEL, STAT_LABEL, fmtDT, NEXT_STAT } from '../api'

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
  // 수정 가능: 관리자(0)는 전부, 개발자(1)는 본인 작업만
  const canEdit = s => !s.holiday && me &&
    (me.user_grade === 0 || (me.user_grade === 1 && s.work_userid === me.userid))
  const [events, setEvents] = useState([])
  const [dayEvents, setDayEvents] = useState([])
  const [holEvents, setHolEvents] = useState([])
  const [selected, setSelected] = useState(null)
  const [users, setUsers] = useState([])
  const [sites, setSites] = useState([])
  const [dayMap, setDayMap] = useState({})
  // 사이트 기본값 = 로그인 사용자의 기본사이트(default_siteid)
  const [siteFilter, setSiteFilter] = useState(me?.default_siteid || '')
  const [q, setQ] = useState('')
  const [statFilter, setStatFilter] = useState('')
  const emptyHol = { kind: 'user', work_userid: '', holiday_category: 'A',
    holiday_hours: 4, holiday_remark: '', date_stat: 'H' }
  const [holForm, setHolForm] = useState(null)  // {date:'yyyy-mm-dd', ...emptyHol}
  const [editForm, setEditForm] = useState(null)  // 작업 수정 모드
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

  // datetime-local 입력값 'YYYY-MM-DDTHH:mm' (로컬 시각)
  const toLocalInput = d => d ? fmtLocal(d).replace(' ', 'T') : ''

  const startEdit = () => setEditForm({
    priority: selected.priority ?? 0,
    work_hours_estimated: selected.work_hours_estimated ?? 0,
    work_userid: selected.work_userid || '',
    work_stat: selected.work_stat || selected.task_stat || 'W',
    start: toLocalInput(selected.start),
    unfix: false,
  })
  const saveEdit = async e => {
    e.preventDefault()
    await api.put(`/tasks/${selected.taskid}`, {
      priority: +editForm.priority,
      work_hours_estimated: +editForm.work_hours_estimated,
      work_userid: editForm.work_userid || null,
    })
    await api.put(`/schedules/${selected.workschid}`, {
      work_stat: editForm.work_stat,
      work_userid: editForm.work_userid || null,
    })
    if (editForm.unfix) {
      await api.patch(`/schedules/${selected.workschid}/unfix`)
    } else if (editForm.start && editForm.start !== toLocalInput(selected.start)) {
      // 로컬 naive 시각 그대로 전송 (toISOString은 UTC로 밀림)
      await api.patch(`/schedules/${selected.workschid}/start`, {
        start_datetime: editForm.start.length === 16 ? editForm.start + ':00' : editForm.start,
      })
    }
    setEditForm(null)
    setSelected(null)
    load()
  }

  const onEventClick = async (info) => {
    const props = { ...info.event.extendedProps, title: info.event.title,
      workschid: info.event.id,
      start: info.event.start, end: info.event.end, daily: null }
    setEditForm(null)
    setSelected(props)
    if (!props.holiday) {
      const { data } = await api.get(`/schedules/${info.event.id}/daily`)
      setSelected(s => s && s.taskid === props.taskid ? { ...s, daily: data } : s)
    }
  }

  const kw = q.trim().toLowerCase()
  const filtered = events.filter(e => {
    const p = e.extendedProps || {}
    if (siteFilter && p.siteid !== siteFilter) return false
    if (statFilter && (p.work_stat || p.task_stat) !== statFilter) return false
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
        <select value={statFilter} onChange={e => setStatFilter(e.target.value)}>
          <option value="">상태(전체)</option>
          {Object.entries(STAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load}>검색</button>
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
          return (
            <div className="ev-line">
              {w && <span className="ev-worker">{w}</span>}
              {csr && <span className="csr">{csr}</span>}
              <span className="ev-title">{arg.event.title}</span>
              {stat && <span className="ev-stat">{stat}</span>}
            </div>
          )
        }}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        dayMaxEventRows={6}
        datesSet={load}
      />
      {selected && (
        <div className="popup" onClick={() => setSelected(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3 className="popup-title" style={{
              background: selected.holiday ? '#fb8c00' : taskColor(selected.taskid),
            }}>
              {selected.holiday && selected.start
                ? `${selected.start.getMonth() + 1}/${selected.start.getDate()} `
                : (selected.site_name || selected.siteid) &&
                  `${selected.site_name || selected.siteid} `}
              {selected.task_csrid && <span className="csr">{selected.task_csrid}</span>}
              {selected.title}
            </h3>
            {editForm ? (
              <form onSubmit={saveEdit}>
                <div className="popup-info">
                  <p><b>우선순위</b>
                    <input type="number" value={editForm.priority}
                      onChange={e => setEditForm({ ...editForm, priority: e.target.value })} /></p>
                  <p><b>예상시간(h)</b>
                    <input type="number" min="0.5" step="0.5" required
                      value={editForm.work_hours_estimated}
                      onChange={e => setEditForm({ ...editForm, work_hours_estimated: e.target.value })} /></p>
                  <p><b>작업자</b>
                    <select value={editForm.work_userid}
                      onChange={e => setEditForm({ ...editForm, work_userid: e.target.value })}>
                      <option value="">-</option>
                      {users.filter(u => u.user_grade === 1)
                        .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
                    </select></p>
                  <p><b>상태</b>
                    <select value={editForm.work_stat}
                      onChange={e => setEditForm({ ...editForm, work_stat: e.target.value })}>
                      {Object.entries(STAT_LABEL)
                        .filter(([k]) => NEXT_STAT[selected.work_stat
                          || selected.task_stat]?.includes(k))
                        .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></p>
                  <p><b>시작일시</b>
                    <input type="datetime-local" value={editForm.start}
                      onChange={e => setEditForm({ ...editForm, start: e.target.value })} /></p>
                  {!!selected.start_fixed && (
                    <p className="chk">
                      <input type="checkbox" checked={editForm.unfix}
                        onChange={e => setEditForm({ ...editForm, unfix: e.target.checked })} />
                      <span>시작일시 고정 해제 (재계산 시 자동 배치)</span>
                    </p>
                  )}
                </div>
                <div className="popup-btns">
                  <button type="submit" className="primary">저장</button>
                  <button type="button" onClick={() => setEditForm(null)}>취소</button>
                </div>
              </form>
            ) : selected.holiday ? (
              <div className="popup-info">
                <p><b>작업자</b> {selected.user_name || selected.work_userid}</p>
                <p><b>구분</b> {selected.holiday_category === 'A' ? '종일' : `일부 (${selected.holiday_hours}h)`}</p>
                {selected.holiday_remark && <p><b>설명</b> {selected.holiday_remark}</p>}
              </div>
            ) : (
              <div className="popup-info">
                <p><b>사이트</b> {selected.site_name || selected.siteid || '-'}</p>
                <p><b>작업자</b> {selected.work_user_name || selected.work_userid || '-'}</p>
                <p><b>우선순위</b> {selected.priority}</p>
                <p><b>예상시간</b> {selected.work_hours_estimated}h
                  {selected.daily && ` (총 ${selected.daily.length}일)`}</p>
                <p><b>시작</b> {fmtLocal(selected.start)}</p>
                <p><b>종료(예상)</b> {fmtLocal(selected.end)}</p>
                {selected.daily && selected.daily.length > 0 && (
                  <div className="daily">
                    <b>일별 작업시간</b>
                    <table>
                      <tbody>
                        {selected.daily.map(d => {
                          const wd = '일월화수목금토'[new Date(d.date).getDay()]
                          return (
                            <tr key={d.date}>
                              <td>{d.date} ({wd})</td>
                              <td className="r">{d.hours}h</td>
                            </tr>
                          )
                        })}
                        <tr className="sum">
                          <td>합계</td>
                          <td className="r">
                            {selected.daily.reduce((a, d) => a + d.hours, 0).toFixed(1)}h
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {!editForm && (
              <div className="popup-btns">
                {canEdit(selected) && <button onClick={startEdit}>수정</button>}
                <button onClick={() => setSelected(null)}>닫기</button>
              </div>
            )}
          </div>
        </div>
      )}
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
