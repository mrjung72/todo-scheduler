import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { colorOf, DAY_STAT_LABEL, fmtDT } from '../api'

export default function CalendarView() {
  const [events, setEvents] = useState([])
  const [dayEvents, setDayEvents] = useState([])
  const [selected, setSelected] = useState(null)
  const calRef = useRef(null)

  const load = useCallback(async () => {
    const [{ data: evs }, { data: days }] = await Promise.all([
      api.get('/schedules/events'),
      api.get('/calendar'),
    ])
    setEvents(evs.map(e => ({
      ...e,
      display: 'block',
      color: colorOf(e.extendedProps.siteid),
      classNames: ['arrow-event'],
    })))
    // 휴일/휴가를 배경 이벤트로 표시
    setDayEvents(
      days.filter(d => d.date_stat !== 'W').map(d => ({
        start: `${d.dateid.slice(0, 4)}-${d.dateid.slice(4, 6)}-${d.dateid.slice(6, 8)}`,
        allDay: true,
        display: 'background',
        color: d.date_stat === 'V' ? 'rgba(251,140,0,.25)' : 'rgba(229,57,53,.18)',
        title: d.holiday_remark || DAY_STAT_LABEL[d.date_stat],
      }))
    )
  }, [])

  useEffect(() => { load() }, [load])

  const onEventClick = (info) => {
    setSelected({ ...info.event.extendedProps, title: info.event.title,
      start: info.event.start, end: info.event.end })
  }

  return (
    <div className="calendar-wrap">
      <div className="legend">
        <span className="lg lg-h">휴일</span>
        <span className="lg lg-v">휴가</span>
        <span className="lg-note">작업 색상 = 사이트별 자동 배정 / 클릭 시 상세</span>
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
        height="auto"
        events={[...events, ...dayEvents]}
        eventClick={onEventClick}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        dayMaxEventRows={6}
        datesSet={load}
      />
      {selected && (
        <div className="popup" onClick={() => setSelected(null)}>
          <div className="popup-body" onClick={e => e.stopPropagation()}>
            <h3>{selected.title}</h3>
            <p><b>사이트</b> {selected.site_name || selected.siteid || '-'}</p>
            <p><b>작업자</b> {selected.work_user_name || selected.work_userid || '-'}</p>
            <p><b>우선순위</b> {selected.priority}</p>
            <p><b>예상시간</b> {selected.work_hours_estimated}h</p>
            <p><b>시작</b> {fmtDT(selected.start?.toISOString?.() ?? selected.start)}</p>
            <p><b>종료(예상)</b> {fmtDT(selected.end?.toISOString?.() ?? selected.end)}</p>
            <button onClick={() => setSelected(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
