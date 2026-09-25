from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import WorkSchedule, Task, User, Site
from ..schemas import ScheduleCreate, ScheduleUpdate, ScheduleOut
from ..scheduler import get_calendar_map, next_work_start, add_work_hours

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


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
            },
        })
    return events


@router.post("", response_model=ScheduleOut, status_code=201)
def create_schedule(body: ScheduleCreate, db: Session = Depends(get_db)):
    obj = WorkSchedule(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


class StartSet(BaseModel):
    start_datetime: datetime


@router.patch("/{workschid}/start", response_model=ScheduleOut)
def set_start(workschid: int, body: StartSet, db: Session = Depends(get_db)):
    """시작일시 수동 설정 -> start_fixed=1 로 고정하고 종료일시 재계산."""
    sched = db.get(WorkSchedule, workschid)
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    task = db.get(Task, sched.taskid)
    cal = get_calendar_map(db)
    sched.start_datetime = next_work_start(body.start_datetime, cal)
    sched.start_fixed = 1
    sched.end_datetime_estimated = add_work_hours(
        sched.start_datetime, (task.work_hours_estimated or 0) if task else 0, cal
    )
    if task:
        task.task_start_date = sched.start_datetime
        task.task_end_date = sched.end_datetime_estimated
    db.commit()
    db.refresh(sched)
    return sched


@router.patch("/{workschid}/unfix", response_model=ScheduleOut)
def unfix_start(workschid: int, db: Session = Depends(get_db)):
    """수동 시작일시 고정 해제 -> 다음 재계산 시 자동 배치."""
    sched = db.get(WorkSchedule, workschid)
    if not sched:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    sched.start_fixed = 0
    db.commit()
    db.refresh(sched)
    return sched


@router.put("/{workschid}", response_model=ScheduleOut)
def update_schedule(workschid: int, body: ScheduleUpdate, db: Session = Depends(get_db)):
    obj = db.get(WorkSchedule, workschid)
    if not obj:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{workschid}", status_code=204)
def delete_schedule(workschid: int, db: Session = Depends(get_db)):
    obj = db.get(WorkSchedule, workschid)
    if not obj:
        raise HTTPException(404, "스케줄을 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
