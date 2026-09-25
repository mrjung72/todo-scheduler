import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { taskColor, DAY_STAT_LABEL, STAT_LABEL, fmtDT } from '../api'

// Date 객체를 로컬 시각 'YYYY-MM-DD HH:mm'으로 포맷 (toISOString은 UTC라 9시간 밀림)
const fmtLocal = d => {
  if (!d) return ''
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function CalendarView() {
  const [events, setEvents] = useState([])
  const [dayEvents, setDayEvents] = useState([])
  const [holEvents, setHolEvents] = useState([])
  const [selected, setSelected] = useState(null)
  const [users, setUsers] = useState([])
  const [dayMap, setDayMap] = useState({})
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
        color: d.date_stat === 'V' ? 'rgba(251,140,0,.25)' : 'rgba(229,57,53,.18)',
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
  }, [load])

  const onDateClick = (info) => {
    // 이벤트(작업바/휴가바) 위 클릭은 eventClick이 처리 -> 여기선 건너뜀
    if (info.jsEvent.target.closest('.fc-daygrid-event-harness, .fc-event')) return
    setSelected(null)
    const date = info.dateStr.slice(0, 10)
    const day = dayMap[date.replaceAll('-', '')]
    setHolForm({ date, ...emptyHol,
      date_stat: day?.date_stat === 'W' ? 'H' : (day?.date_stat || 'H'),
      holiday_remark: day?.holiday_remark || '' })
  }

  const saveHoliday = async e => {
    e.preventDefault()
    const dateid = holForm.date.replaceAll('-', '')
    if (holForm.kind === 'day') {
      // 공통 휴일/휴가: calendar_define 에 없으면 생성, 있으면 갱신
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

  const onEventClick = async (info) => {
    const props = { ...info.event.extendedProps, title: info.event.title,
      start: info.event.start, end: info.event.end, daily: null }
    setSelected(props)
    if (!props.holiday) {
      const { data } = await api.get(`/schedules/${info.event.id}/daily`)
      setSelected(s => s && s.taskid === props.taskid ? { ...s, daily: data } : s)
    }
  }

  return (
    <div className="calendar-wrap">
      <div className="legend">
        <span className="lg lg-h">휴일</span>
        <span className="lg lg-uh">개인휴가</span>
        <span className="lg-note">작업 색상 = 작업별 자동 배정 / 클릭 시 상세</span>
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
        events={[...events, ...dayEvents, ...holEvents]}
        eventClick={onEventClick}
        dateClick={onDateClick}
        eventContent={(arg) => {
          if (arg.event.extendedProps.holiday) return arg.event.title
          const w = arg.event.extendedProps.work_user_name
            || arg.event.extendedProps.work_userid || ''
          const stat = STAT_LABEL[arg.event.extendedProps.work_stat
            || arg.event.extendedProps.task_stat] || ''
          return (
            <div className="ev-line">
              {w && <span className="ev-worker">{w}</span>}
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
            <h3>
              {selected.start
                ? `${selected.start.getMonth() + 1}/${selected.start.getDate()} `
                : ''}
              {selected.title}
            </h3>
            {selected.holiday ? (
              <>
                <p><b>작업자</b> {selected.user_name || selected.work_userid}</p>
                <p><b>구분</b> {selected.holiday_category === 'A' ? '종일' : `일부 (${selected.holiday_hours}h)`}</p>
                {selected.holiday_remark && <p><b>설명</b> {selected.holiday_remark}</p>}
              </>
            ) : (
              <>
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
              </>
            )}
            <button onClick={() => setSelected(null)}>닫기</button>
          </div>
        </div>
      )}
      {holForm && (
        <div className="popup" onClick={() => setHolForm(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>{holForm.date.slice(5).replace('-', '/')} 휴일/휴가 등록</h3>
            <form className="holiday-form" onSubmit={saveHoliday}>
              <label>등록구분
                <select value={holForm.kind}
                  onChange={e => setHolForm({ ...holForm, kind: e.target.value })}>
                  <option value="user">개인 휴가</option>
                  <option value="day">공통 휴일/휴가</option>
                </select>
              </label>
              {holForm.kind === 'user' ? (
                <>
                  <label>작업자
                    <select required value={holForm.work_userid}
                      onChange={e => setHolForm({ ...holForm, work_userid: e.target.value })}>
                      <option value="">선택</option>
                      {users.filter(u => u.user_grade === 1)
                        .map(u => <option key={u.userid} value={u.userid}>{u.user_name}</option>)}
                    </select>
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
