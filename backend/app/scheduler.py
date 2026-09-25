"""근무일 기준 작업 스케줄 자동계산 엔진.

근무시간: 환경변수 WORK_SEGMENTS 로 설정 (기본 "09:00-12:00,13:00-18:00" = 하루 8시간)
비근무일: 토/일 + calendar_define 에서 date_stat 이 'H'(휴일) 또는 'V'(휴가)인 날
calendar_define 에 없는 날짜는 월~금=근무일, 토/일=휴일로 간주.

재계산(recalculate) 규칙:
- work_schedule 을 work_userid 별로 그룹화하고 task.priority 순으로 정렬
- 각 작업자 그룹 내에서 순차 배치 (이전 작업 종료 -> 다음 작업 시작)
- start_fixed=1 인 스케줄은 start_datetime 을 유지하고 종료일시만 재계산
"""
import os
from datetime import datetime, timedelta, date, time
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from .models import CalendarDefine, WorkSchedule, Task

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


def is_working_day(d: date, cal: dict) -> bool:
    stat = cal.get(d.strftime("%Y%m%d"))
    if stat is not None:
        return stat == "W"
    return d.weekday() < 5  # 기본: 월~금 근무


def _day_segments(d: date):
    return [
        (datetime.combine(d, s), datetime.combine(d, e)) for s, e in DAY_SEGMENTS
    ]


def next_work_start(dt: datetime, cal: dict) -> datetime:
    """dt 이후(포함) 가장 빠른 근무 시작 시각을 반환."""
    d = dt.date()
    # 최대 5년치만 탐색
    for _ in range(366 * 5):
        if is_working_day(d, cal):
            for seg_s, seg_e in _day_segments(d):
                if dt <= seg_s:
                    return seg_s
                if seg_s < dt < seg_e:
                    return dt
        d += timedelta(days=1)
        dt = datetime.combine(d, time(0, 0))
    raise RuntimeError("근무 가능한 날짜를 찾을 수 없습니다 (달력 설정 확인)")


def add_work_hours(start: datetime, hours: float, cal: dict) -> datetime:
    """start 부터 근무시간 hours 만큼 경과한 시각을 반환."""
    if hours <= 0:
        return start
    remaining = float(hours)
    cur = next_work_start(start, cal)
    while True:
        d = cur.date()
        if is_working_day(d, cal):
            for seg_s, seg_e in _day_segments(d):
                if cur >= seg_e:
                    continue
                s = max(cur, seg_s)
                avail = (seg_e - s).total_seconds() / 3600.0
                if remaining <= avail:
                    return s + timedelta(hours=remaining)
                remaining -= avail
                cur = seg_e
        cur = next_work_start(datetime.combine(d + timedelta(days=1), time(0, 0)), cal)


def recalculate(db: Session) -> int:
    """전체 작업스케줄 재계산. 갱신된 스케줄 수를 반환."""
    cal = get_calendar_map(db)

    rows = (
        db.query(WorkSchedule, Task)
        .join(Task, WorkSchedule.taskid == Task.taskid)
        .filter(Task.task_stat.in_(["W", "P"]))
        .filter(WorkSchedule.work_stat.in_(["W", "P"]))
        .all()
    )

    # 작업자별 그룹화
    groups: dict = {}
    for sched, task in rows:
        key = sched.work_userid or ""
        groups.setdefault(key, []).append((sched, task))

    now = datetime.now().replace(second=0, microsecond=0)
    updated = 0

    for key, items in groups.items():
        items.sort(key=lambda x: (x[1].priority or 0, x[1].taskid))
        cursor = now
        for sched, task in items:
            if sched.start_fixed and sched.start_datetime:
                start = next_work_start(sched.start_datetime, cal)
                sched.start_datetime = start
            else:
                start = next_work_start(cursor, cal)
                sched.start_datetime = start

            est_hours = task.work_hours_estimated or 0
            sched.end_datetime_estimated = add_work_hours(start, est_hours, cal)

            real_hours = task.work_hours_real or 0
            if real_hours > 0:
                sched.end_datetime_real = add_work_hours(start, real_hours, cal)

            # tasks 테이블의 시작/완료일자도 동기화
            task.task_start_date = sched.start_datetime
            task.task_end_date = sched.end_datetime_estimated

            cursor = sched.end_datetime_estimated
            updated += 1

    db.commit()
    return updated
