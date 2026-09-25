from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import WorkSchedule, Task, User, Site
from ..schemas import ScheduleCreate, ScheduleUpdate, ScheduleOut
from ..security import get_current_user, check_owner_or_admin
from ..scheduler import (
    get_calendar_map, get_holiday_map, next_work_start, add_work_hours,
    worker_segments,
)
from datetime import timedelta

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def _daily_breakdown(start, end, cal, hol, uid):
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
                    "hours": round(hours, 1), "spans": spans}
        d += timedelta(days=1)
    return result


@router.get("", response_model=list[ScheduleOut])
def list_schedules(
    taskid: int = Query(None),
    work_userid: str = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(WorkSchedule)
    if taskid is not None:
        q = q.filter(WorkSchedule.taskid == taskid)
    if work_userid:
        q = q.filter(WorkSchedule.work_userid == work_userid)
    return q.order_by(WorkSchedule.workschid).all()


@router.get("/events")
def calendar_events(db: Session = Depends(get_db)):
    """FullCalendar용 이벤트: 스케줄 + 작업/담당자/사이트 정보"""
    WorkUser = User
    rows = (
        db.query(WorkSchedule, Task, WorkUser.user_name, Site.site_name)
        .join(Task, WorkSchedule.taskid == Task.taskid)
        .outerjoin(WorkUser, WorkUser.userid == WorkSchedule.work_userid)
        .outerjoin(Site, Site.siteid == Task.siteid)
        .filter(WorkSchedule.work_stat.in_(["W", "P"]))
        .all()
    )
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)
    events = []
    for sched, task, work_user_name, site_name in rows:
        if not sched.start_datetime or not sched.end_datetime_estimated:
            continue
        events.append({
            "id": str(sched.workschid),
            "title": task.task_name,
            "start": sched.start_datetime.isoformat(),
            "end": sched.end_datetime_estimated.isoformat(),
            "extendedProps": {
                "taskid": task.taskid,
                "siteid": task.siteid,
                "site_name": site_name,
                "priority": task.priority,
                "work_userid": sched.work_userid,
                "work_user_name": work_user_name,
                "work_stat": sched.work_stat,
                "task_stat": task.task_stat,
                "work_hours_estimated": task.work_hours_estimated,
                "start_fixed": sched.start_fixed,
                # 일별 작업 분해: 달력 작업바를 시간 비례로 채우는 용도
                "daily": _daily_breakdown(
                    sched.start_datetime, sched.end_datetime_estimated,
                    cal, hol, sched.work_userid or ""),
            },
        })
    return events


@router.get("/{workschid}/daily")
def daily_hours(workschid: int, db: Session = Depends(get_db)):
    """스케줄의 시작~종료 구간을 일별 작업시간으로 분해."""
    sched = db.get(WorkSchedule, workschid)
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    if not sched.start_datetime or not sched.end_datetime_estimated:
        return []
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)
    uid = sched.work_userid or ""
    bd = _daily_breakdown(
        sched.start_datetime, sched.end_datetime_estimated, cal, hol, uid)
    return [{"date": k, "hours": v["hours"]} for k, v in bd.items()]


@router.post("", response_model=ScheduleOut, status_code=201)
def create_schedule(body: ScheduleCreate, db: Session = Depends(get_db),
                    me: User = Depends(get_current_user)):
    data = body.model_dump()
    if me.user_grade != 0:
        data["work_userid"] = me.userid  # 비관리자는 자기 스케줄만 생성 가능
    obj = WorkSchedule(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


class StartSet(BaseModel):
    start_datetime: datetime


@router.patch("/{workschid}/start", response_model=ScheduleOut)
def set_start(workschid: int, body: StartSet, db: Session = Depends(get_db),
              me: User = Depends(get_current_user)):
    """시작일시 수동 설정 -> start_fixed=1 로 고정하고 종료일시 재계산."""
    sched = db.get(WorkSchedule, workschid)
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    check_owner_or_admin(me, sched.work_userid)
    task = db.get(Task, sched.taskid)
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)
    uid = sched.work_userid or ""
    sched.start_datetime = next_work_start(body.start_datetime, cal, hol, uid)
    sched.start_fixed = 1
    sched.end_datetime_estimated = add_work_hours(
        sched.start_datetime, (task.work_hours_estimated or 0) if task else 0, cal, hol, uid
    )
    if task:
        task.task_start_date = sched.start_datetime
        task.task_end_date = sched.end_datetime_estimated
    db.commit()
    db.refresh(sched)
    return sched


@router.patch("/{workschid}/unfix", response_model=ScheduleOut)
def unfix_start(workschid: int, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    """수동 시작일시 고정 해제 -> 다음 재계산 시 자동 배치."""
    sched = db.get(WorkSchedule, workschid)
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    check_owner_or_admin(me, sched.work_userid)
    sched.start_fixed = 0
    db.commit()
    db.refresh(sched)
    return sched


@router.put("/{workschid}", response_model=ScheduleOut)
def update_schedule(workschid: int, body: ScheduleUpdate, db: Session = Depends(get_db),
                    me: User = Depends(get_current_user)):
    obj = db.get(WorkSchedule, workschid)
    if not obj:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    check_owner_or_admin(me, obj.work_userid)
    data = body.model_dump(exclude_unset=True)
    if me.user_grade != 0 and "work_userid" in data and data["work_userid"] != me.userid:
        raise HTTPException(403, "다른 작업자에게 배정할 수 없습니다")
    for k, v in data.items():
        setattr(obj, k, v)
    # 작업상태 변경 시 연결된 작업(tasks.task_stat)도 동기화
    if "work_stat" in data and obj.taskid:
        task = db.get(Task, obj.taskid)
        if task:
            task.task_stat = obj.work_stat
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{workschid}", status_code=204)
def delete_schedule(workschid: int, db: Session = Depends(get_db),
                    me: User = Depends(get_current_user)):
    obj = db.get(WorkSchedule, workschid)
    if not obj:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    check_owner_or_admin(me, obj.work_userid)
    db.delete(obj)
    db.commit()
