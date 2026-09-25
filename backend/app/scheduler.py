"""근무일 기준 작업 스케줄 자동계산 엔진.

근무시간: 환경변수 WORK_SEGMENTS 로 설정 (기본 "09:00-12:00,13:00-18:00" = 하루 8시간)
비근무일: 토/일 + calendar_define 에서 date_stat 이 'H'(휴일)인 날
calendar_define 에 없는 날짜는 월~금=근무일, 토/일=휴일로 간주.
작업자별 휴가: user_holiday 에 해당 작업자+일자가 있으면
  A(종일) -> 그날 근무 불가, P(일부) -> holiday_hours 만큼 하루 근무시간 차감(하루 뒤쪽부터 차감)

재계산(recalculate) 규칙:
- work_schedule 을 work_userid 별로 그룹화하고 task.priority 순으로 정렬
- 각 작업자 그룹 내에서 순차 배치 (이전 작업 종료 -> 다음 작업 시작)
- start_fixed=1 인 스케줄은 start_datetime 을 유지하고 종료일시만 재계산
"""
import os
from datetime import datetime, timedelta, date, time
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from .models import CalendarDefine, WorkSchedule, Task, UserHoliday

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


def _parse_time(s: str) -> time:
    h, m = s.strip().split(":")
    return time(int(h), int(m))


def _parse_segments(env_val: str):
    """'09:00-12:00,13:00-18:00' -> [(time,time), ...]"""
    segs = []
    for part in env_val.split(","):
        part = part.strip()
        if not part:
            continue
        s, e = part.split("-")
        segs.append((_parse_time(s), _parse_time(e)))
    if not segs:
        raise ValueError("WORK_SEGMENTS 환경변수가 비어있습니다")
    return segs


# 하루 근무 구간. 예) "09:00-12:00,13:00-18:00" = 8h, "09:00-17:00" = 점심없이 8h
WORK_SEGMENTS = os.getenv("WORK_SEGMENTS", "09:00-12:00,13:00-18:00")
DAY_SEGMENTS = _parse_segments(WORK_SEGMENTS)
WORK_HOURS_PER_DAY = sum(
    (datetime.combine(date.today(), e) - datetime.combine(date.today(), s)).total_seconds() / 3600
    for s, e in DAY_SEGMENTS
)


def get_calendar_map(db: Session) -> dict:
    """{dateid 'yyyymmdd': date_stat} 맵 반환"""
    return {r.dateid: r.date_stat for r in db.query(CalendarDefine).all()}


def get_holiday_map(db: Session) -> dict:
    """{(work_userid, dateid): (holiday_category, holiday_hours)} 맵 반환"""
    return {
        (r.work_userid or "", r.dateid): (r.holiday_category or "A", r.holiday_hours or 0)
        for r in db.query(UserHoliday).all()
    }


def is_working_day(d: date, cal: dict) -> bool:
    stat = cal.get(d.strftime("%Y%m%d"))
    if stat is not None:
        return stat == "W"
    return d.weekday() < 5  # 기본: 월~금 근무


def _day_segments(d: date):
    return [
        (datetime.combine(d, s), datetime.combine(d, e)) for s, e in DAY_SEGMENTS
    ]


def worker_segments(d: date, cal: dict, hol: dict, userid) -> list:
    """작업자의 해당 일 근무 구간 목록 (개인휴가 반영)."""
    if not is_working_day(d, cal):
        return []
    segs = _day_segments(d)
    h = hol.get((userid or "", d.strftime("%Y%m%d")))
    if not h:
        return segs
    cat, hrs = h
    if cat == "A" or (hrs or 0) >= WORK_HOURS_PER_DAY:
        return []
    # P-일부휴가: 하루 근무의 마지막 hrs 시간을 제외 (오후반차 방식)
    remaining = float(hrs)
    out = []
    for s, e in reversed(segs):
        if remaining <= 0:
            out.append((s, e))
            continue
        dur = (e - s).total_seconds() / 3600.0
        if remaining >= dur:
            remaining -= dur
            continue
        out.append((s, e - timedelta(hours=remaining)))
        remaining = 0
    return list(reversed(out))


def next_work_start(dt: datetime, cal: dict, hol: dict = None, userid=None) -> datetime:
    """dt 이후(포함) 가장 빠른 근무 시작 시각을 반환."""
    hol = hol or {}
    d = dt.date()
    # 최대 5년치만 탐색
    for _ in range(366 * 5):
        for seg_s, seg_e in worker_segments(d, cal, hol, userid):
            if dt <= seg_s:
                return seg_s
            if seg_s < dt < seg_e:
                return dt
        d += timedelta(days=1)
        dt = datetime.combine(d, time(0, 0))
    raise RuntimeError("근무 가능한 날짜를 찾을 수 없습니다 (달력/휴가 설정 확인)")


def add_work_hours(start: datetime, hours: float, cal: dict, hol: dict = None, userid=None) -> datetime:
    """start 부터 근무시간 hours 만큼 경과한 시각을 반환."""
    hol = hol or {}
    if hours <= 0:
        return start
    remaining = float(hours)
    cur = next_work_start(start, cal, hol, userid)
    while True:
        d = cur.date()
        for seg_s, seg_e in worker_segments(d, cal, hol, userid):
            if cur >= seg_e:
                continue
            s = max(cur, seg_s)
            avail = (seg_e - s).total_seconds() / 3600.0
            if remaining <= avail:
                return s + timedelta(hours=remaining)
            remaining -= avail
            cur = seg_e
        cur = next_work_start(datetime.combine(d + timedelta(days=1), time(0, 0)), cal, hol, userid)


def recalculate(db: Session, only_userid: str = None) -> tuple:
    """대기중(W) 작업의 스케줄 재계산. (갱신된 스케줄 수, 신규 생성 수) 반환.

    only_userid 가 주어지면 해당 작업자의 스케줄/작업만 대상으로 한다.
    스케줄이 없는 대기중 작업은 work_userid=itos_userid 로 스케줄을 자동 생성한다.
    """
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)

    # 스케줄이 없는 대기중/작업중 작업 -> 스케줄 자동 생성 (작업자는 IT담당자 기본 배정)
    scheduled_taskids = {r[0] for r in db.query(WorkSchedule.taskid).all()}
    created = 0
    task_q = db.query(Task).filter(Task.task_stat.in_(["W", "P"]))
    if only_userid:
        task_q = task_q.filter(Task.work_userid == only_userid)
    for t in task_q.all():
        if t.taskid not in scheduled_taskids:
            db.add(WorkSchedule(taskid=t.taskid, work_stat=t.task_stat,
                                work_userid=t.work_userid or t.itos_userid))
            created += 1
    if created:
        db.flush()

    rows = (
        db.query(WorkSchedule, Task)
        .join(Task, WorkSchedule.taskid == Task.taskid)
        .filter(Task.task_stat == "W")          # 대기중 작업만 재계산
        .filter(WorkSchedule.work_stat == "W")
    )
    if only_userid:
        rows = rows.filter(WorkSchedule.work_userid == only_userid)
    rows = rows.all()

    # 작업자별 그룹화
    groups: dict = {}
    for sched, task in rows:
        key = sched.work_userid or ""
        groups.setdefault(key, []).append((sched, task))

    now = datetime.now().replace(second=0, microsecond=0)
    updated = 0

    # 작업자별 작업중(P) 스케줄의 가장 늦은 종료예상시각 -> 대기 작업은 그 이후 배치
    in_prog_end: dict = {}
    for sch in db.query(WorkSchedule).filter(WorkSchedule.work_stat == "P"):
        if sch.end_datetime_estimated:
            uid = sch.work_userid or ""
            cur = in_prog_end.get(uid)
            if cur is None or sch.end_datetime_estimated > cur:
                in_prog_end[uid] = sch.end_datetime_estimated

    for key, items in groups.items():
        items.sort(key=lambda x: (x[1].priority or 0, x[1].taskid))
        cursor = max(now, in_prog_end.get(key, now))
        for sched, task in items:
            uid = sched.work_userid or ""
            if sched.start_fixed and sched.start_datetime:
                start = next_work_start(sched.start_datetime, cal, hol, uid)
                sched.start_datetime = start
            else:
                start = next_work_start(cursor, cal, hol, uid)
                sched.start_datetime = start

            est_hours = task.work_hours_estimated or 0
            sched.end_datetime_estimated = add_work_hours(start, est_hours, cal, hol, uid)

            real_hours = task.work_hours_real or 0
            if real_hours > 0:
                sched.end_datetime_real = add_work_hours(start, real_hours, cal, hol, uid)

            # tasks 테이블의 시작/완료일자도 동기화
            task.task_start_date = sched.start_datetime
            task.task_end_date = sched.end_datetime_estimated

            cursor = sched.end_datetime_estimated
            updated += 1

    db.commit()
    return updated, created
