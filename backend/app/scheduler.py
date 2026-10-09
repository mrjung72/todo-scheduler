"""근무일 기준 작업 스케줄 자동계산 엔진.

근무시간: 환경변수 WORK_SEGMENTS 로 설정 (기본 "09:00-12:00,13:00-18:00" = 하루 8시간)
비근무일: 토/일 + calendar_define 에서 date_stat 이 'H'(휴일)인 날
calendar_define 에 없는 날짜는 월~금=근무일, 토/일=휴일로 간주.
휴일 수동작업: workday_cal 이 해당일을 'F' 로 표시 -> 근무구간 무시, 경과시간 그대로 적용.
작업자별 휴가: user_holiday 에 해당 작업자+일자가 있으면
  A(종일) -> 그날 근무 불가, P(일부) -> holiday_hours 만큼 하루 근무시간 차감(하루 뒤쪽부터 차감)

재계산(recalculate) 규칙:
- 대기중(W) tasks 를 work_userid 별로 그룹화하고 task.priority 순으로 정렬
- 각 작업자 그룹 내에서 순차 배치 (이전 작업 종료 -> 다음 작업 시작)
- start_fixed=1 인 작업은 task_start_date 를 유지하고 종료예상일시만 재계산
"""
import os
from datetime import datetime, timedelta, date, time
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from .models import CalendarDefine, Task, UserHoliday

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


def has_workday_between(cal: dict, start: datetime, end: datetime) -> bool:
    """start~end 기간에 근무일이 하루라도 포함되면 True — 휴일작업 경고용.
    달력에 H로 등록된 날(공휴일 포함)은 평일이라도 휴일로 본다."""
    if not start or not end:
        return False
    d = start.date()
    while d <= end.date():
        if is_working_day(d, cal):
            return True
        d += timedelta(days=1)
    return False


def _day_segments(d: date):
    return [
        (datetime.combine(d, s), datetime.combine(d, e)) for s, e in DAY_SEGMENTS
    ]


# 휴일 수동작업 표시: 근무구간(WORK_SEGMENTS) 무시하고 하루 전체(24h) 작업가능
FREE_DAY_STAT = "F"


def worker_segments(d: date, cal: dict, hol: dict, userid) -> list:
    """작업자의 해당 일 근무 구간 목록 (개인휴가 반영).
    달력 값이 'F' 이면 근무구간 무시하고 00:00~24:00 전체를 작업가능으로 둔다."""
    stat = cal.get(d.strftime("%Y%m%d"))
    if stat == FREE_DAY_STAT:
        base = datetime.combine(d, time(0, 0))
        segs = [(base, base + timedelta(days=1))]
    elif not is_working_day(d, cal):
        return []
    else:
        segs = _day_segments(d)
    h = hol.get((userid or "", d.strftime("%Y%m%d")))
    if not h:
        return segs
    cat, hrs = h
    day_hours = sum(
        (e - s).total_seconds() for s, e in segs) / 3600.0
    if cat == "A" or (hrs or 0) >= day_hours:
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


def workday_cal(cal: dict, d: date) -> dict:
    """d 가 휴일이면 그 날짜만 'F'(종일 작업가능)로 간주한 달력 맵 반환.
    휴일에 수동으로 작업을 등록할 때 사용 — 근무구간 무시, 경과시간 그대로."""
    if is_working_day(d, cal):
        return cal
    c = dict(cal)
    c[d.strftime("%Y%m%d")] = FREE_DAY_STAT
    return c


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


def work_hours_between(start: datetime, end: datetime, cal: dict, hol: dict = None, userid=None) -> float:
    """start~end 사이 근무구간 겹침 시간 합계 (실제 작업시간 측정용).
    start 일이 'F'(휴일 수동작업)면 그 날은 경과시간 그대로 계산된다."""
    hol = hol or {}
    if not start or not end or end <= start:
        return 0.0
    total = 0.0
    d = start.date()
    while d <= end.date():
        for seg_s, seg_e in worker_segments(d, cal, hol, userid):
            s, e = max(start, seg_s), min(end, seg_e)
            if s < e:
                total += (e - s).total_seconds() / 3600.0
        d += timedelta(days=1)
    return round(total, 2)


def daily_breakdown(start, end, cal, hol, uid):
    """시작~종료 구간을 일별로 분해.
    {date: {"hours": 작업시간, "spans": [[시작비율, 끝비율], ...]}} 반환.
    spans 비율은 그날 근무시간(구간별 실제 근무 합계) 기준 0~1.
    점심 등 구간 사이 공백은 제외되므로 채움이 연속적으로 이어진다."""
    result = {}
    d = start.date()
    while d <= end.date():
        segs = worker_segments(d, cal, hol, uid)
        if segs:
            daylen = sum((e - s).total_seconds() for s, e in segs) or 1
            # 일부휴가 등으로 차감된 뒤쪽 비율 (정상 근무시간 대비 비작업 꼬리)
            nominal = sum((e - s).total_seconds()
                          for s, e in worker_segments(d, cal, {}, uid)) or daylen
            off = round(max(0.0, 1 - daylen / nominal), 3)
            hours, spans = 0.0, []
            offset = 0.0  # 이전 근무구간들의 누적 길이(초)
            for s, e in segs:
                seg_dur = (e - s).total_seconds()
                cs, ce = max(s, start), min(e, end)
                if cs < ce:
                    hours += (ce - cs).total_seconds() / 3600.0
                    spans.append([
                        round((offset + (cs - s).total_seconds()) / daylen, 3),
                        round((offset + (ce - s).total_seconds()) / daylen, 3),
                    ])
                offset += seg_dur
            if hours > 0:
                result[d.strftime("%Y-%m-%d")] = {
                    "hours": round(hours, 1), "spans": spans,
                    "off": off,
                    # 'F'(휴일 수동작업): 24h 기준 비율 -> 프론트에서 최소폭 보정
                    "free": cal.get(d.strftime("%Y%m%d")) == FREE_DAY_STAT}
        d += timedelta(days=1)
    return result


def recalculate(db: Session, only_userid: str = None) -> tuple:
    """대기중(W) 작업의 시작/예상종료일시 재계산. (갱신된 작업 수, 0) 반환.

    only_userid 가 주어지면 해당 작업자의 작업만 대상으로 한다.
    """
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)

    # 대기중(W) 작업만 재계산, 휴일작업은 자동 스케줄링 대상에서 제외
    task_q = db.query(Task).filter(Task.task_stat == "W") \
                           .filter(Task.holiday_work != 1)
    if only_userid:
        task_q = task_q.filter(Task.work_userid == only_userid)
    rows = task_q.all()

    # 작업자별 그룹화
    groups: dict = {}
    for task in rows:
        key = task.work_userid or ""
        groups.setdefault(key, []).append(task)

    now = datetime.now().replace(second=0, microsecond=0)
    updated = 0

    # 작업자별 진행중(P)/중단(H) 작업의 가장 늦은 종료예상시각 -> 대기 작업은 그 이후 배치
    in_prog_end: dict = {}
    for t in db.query(Task).filter(Task.task_stat.in_(["P", "H"])):
        if t.task_end_date_estimated:
            uid = t.work_userid or ""
            cur = in_prog_end.get(uid)
            if cur is None or t.task_end_date_estimated > cur:
                in_prog_end[uid] = t.task_end_date_estimated

    for key, items in groups.items():
        items.sort(key=lambda x: (x.priority or 0, x.taskid))
        cursor = max(now, in_prog_end.get(key, now))
        # 시작일시가 고정된 작업은 자리를 유지 — 먼저 종료시각을 계산해 기준선에 반영.
        # 비고정 작업은 이 작업자의 가장 마지막 스케줄이 끝난 이후부터만 배치한다.
        fixed_ids = {t.taskid for t in items
                     if t.start_fixed and t.task_start_date}
        for task in items:
            if task.taskid not in fixed_ids:
                continue
            uid = task.work_userid or ""
            cal_f = workday_cal(cal, task.task_start_date.date())
            task.task_end_date_estimated = add_work_hours(
                task.task_start_date, task.work_hours_estimated or 0,
                cal_f, hol, uid)
            cursor = max(cursor, task.task_end_date_estimated)
            updated += 1
        for task in items:
            if task.taskid in fixed_ids:
                continue
            uid = task.work_userid or ""
            start = next_work_start(cursor, cal, hol, uid)
            task.task_start_date = start
            task.task_end_date_estimated = add_work_hours(
                start, task.work_hours_estimated or 0, cal, hol, uid)
            cursor = task.task_end_date_estimated
            updated += 1

    db.commit()
    return updated, 0
