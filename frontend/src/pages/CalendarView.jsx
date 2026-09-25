import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { taskColor, DAY_STAT_LABEL, STAT_LABEL, fmtDT } from '../api'

export default function CalendarView() {
  const [events, setEvents] = useState([])
  const [dayEvents, setDayEvents] = useState([])
  const [holEvents, setHolEvents] = useState([])
  const [selected, setSelected] = useState(null)
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

  useEffect(() => { load() }, [load])

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
        <span className="lg lg-v">휴가</span>
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
                <p><b>시작</b> {fmtDT(selected.start?.toISOString?.() ?? selected.start)}</p>
                <p><b>종료(예상)</b> {fmtDT(selected.end?.toISOString?.() ?? selected.end)}</p>
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
    </div>
  )
}
