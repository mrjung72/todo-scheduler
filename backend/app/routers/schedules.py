"""작업이력(work_schedule_log) CRUD + 캘린더 이벤트 + 작업상태변경이력(task_chg_log).

- 작업이력: 작업자가 작업 내용을 수동으로 기록하는 로그 (상태/일정은 tasks에서 관리)
- 이벤트: tasks 의 task_start_date/task_end_date_estimated 기준 (대기중/작업중만)
- 변경이력: 상태 전이 시 statusflow에서 자동 기록된 로그 조회/삭제
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, aliased

from ..database import get_db
from ..models import WorkScheduleLog, TaskChgLog, Task, User, Site
from ..schemas import WorkLogCreate, WorkLogUpdate, WorkLogOut
from ..security import get_current_user, check_owner_or_admin, require_staff
from ..scheduler import (
    get_calendar_map, get_holiday_map, workday_cal, daily_breakdown,
    has_workday_between,
)
from ..statusflow import auto_start_due_tasks

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


@router.get("", response_model=list[WorkLogOut])
def list_work_logs(
    taskid: int = Query(None),
    work_userid: str = Query(None),
    db: Session = Depends(get_db),
):
    q = (db.query(WorkScheduleLog, User.user_name)
           .outerjoin(User, User.userid == WorkScheduleLog.work_userid))
    if taskid is not None:
        q = q.filter(WorkScheduleLog.taskid == taskid)
    if work_userid:
        q = q.filter(WorkScheduleLog.work_userid == work_userid)
    rows = q.order_by(WorkScheduleLog.workschid).all()
    return [WorkLogOut(**{k: v for k, v in vars(w).items() if not k.startswith('_')},
                       work_user_name=uname)
            for w, uname in rows]


@router.get("/events")
def calendar_events(db: Session = Depends(get_db)):
    """FullCalendar용 이벤트: 작업 + 담당자/사이트 정보 (대기중/작업중만)."""
    auto_start_due_tasks(db)   # 예정시작 지난 대기 작업은 자동으로 작업중 전이
    WorkUser = aliased(User)
    ReqUser = aliased(User)
    rows = (
        db.query(Task, WorkUser.user_name, WorkUser.dept_name,
                 WorkUser.job_title, Site.site_name,
                 Task.req_userid, ReqUser.user_name,
                 ReqUser.dept_name, ReqUser.job_title)
        .outerjoin(WorkUser, WorkUser.userid == Task.work_userid)
        .outerjoin(ReqUser, ReqUser.userid == Task.req_userid)
        .outerjoin(Site, Site.siteid == Task.siteid)
        .filter(or_(Task.task_stat.in_(["W", "P"]), Task.holiday_work == 1))
        .all()
    )
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)
    events = []
    for (task, work_user_name, work_user_dept, work_user_title,
         site_name, req_userid, req_user_name,
         req_user_dept, req_user_title) in rows:
        if not task.task_start_date or not task.task_end_date_estimated:
            continue
        events.append({
            "id": str(task.taskid),
            "title": task.task_name,
            "start": task.task_start_date.isoformat(),
            "end": task.task_end_date_estimated.isoformat(),
            "extendedProps": {
                "taskid": task.taskid,
                "task_csrid": task.task_csrid,
                "siteid": task.siteid,
                "site_name": site_name,
                "priority": task.priority,
                "work_userid": task.work_userid,
                "work_user_name": work_user_name,
                "work_user_dept": work_user_dept,
                "work_user_title": work_user_title,
                "task_stat": task.task_stat,
                "task_type": task.task_type,
                "work_hours_estimated": task.work_hours_estimated,
                "req_userid": req_userid,
                "req_user_name": req_user_name,
                "req_user_dept": req_user_dept,
                "req_user_title": req_user_title,
                "req_date": task.req_date.isoformat() if task.req_date else None,
                "task_req_remark": task.task_req_remark,
                "start_fixed": task.start_fixed,
                "holiday_work": task.holiday_work,
                # 휴일작업인데 기간에 근무일 포함 시 경고 플래그
                "weekday_included": bool(task.holiday_work) and
                    has_workday_between(cal, task.task_start_date,
                                        task.task_end_date_estimated),
                # 일별 작업 분해: 달력 작업바를 시간 비례로 채우는 용도
                # (시작일이 휴일이면 그 날짜도 작업가능일로 간주해 분해)
                "daily": daily_breakdown(
                    task.task_start_date, task.task_end_date_estimated,
                    workday_cal(cal, task.task_start_date.date()),
                    hol, task.work_userid or ""),
            },
        })
    return events


@router.get("/his")
def all_chg_logs(db: Session = Depends(get_db),
                 me: User = Depends(get_current_user)):
    """전체 작업 상태변경이력 (최근 이력 순, 관리자화면용).
    비스태프(일반개발자)는 본인 작업의 이력만 조회."""
    WorkUser = aliased(User)
    q = (db.query(TaskChgLog, Task.task_name, WorkUser.user_name)
         .outerjoin(Task, Task.taskid == TaskChgLog.taskid)
         .outerjoin(WorkUser, WorkUser.userid == TaskChgLog.work_userid))
    if me.user_grade not in (0, 1):
        q = q.filter(Task.work_userid == me.userid)
    rows = q.order_by(TaskChgLog.taskchgid.desc()).all()
    return [{
        "taskchgid": h.taskchgid,
        "taskid": h.taskid,
        "task_name": task_name,
        "work_userid": h.work_userid,
        "work_user_name": work_user_name,
        "task_stat": h.task_stat,
        "work_hours": h.work_hours,
        "remark": h.remark,
        "create_date": h.create_date,
    } for h, task_name, work_user_name in rows]


@router.delete("/his", status_code=204)
def delete_all_chg_logs(db: Session = Depends(get_db),
                        me: User = Depends(require_staff)):
    """작업 상태변경이력 전체 삭제 (관리자/개발자)."""
    db.query(TaskChgLog).delete()
    db.commit()


@router.delete("/his/{taskchgid}", status_code=204)
def delete_chg_log(taskchgid: int, db: Session = Depends(get_db),
                   me: User = Depends(require_staff)):
    """작업 상태변경이력 단건 삭제 (관리자/개발자)."""
    obj = db.get(TaskChgLog, taskchgid)
    if not obj:
        raise HTTPException(404, "이력을 찾을 수 없습니다")
    db.delete(obj)
    db.commit()


@router.post("", response_model=WorkLogOut, status_code=201)
def create_work_log(body: WorkLogCreate, db: Session = Depends(get_db),
                    me: User = Depends(get_current_user)):
    """작업이력 수동 등록 (작업자의 작업내용 기록)."""
    data = body.model_dump()
    if not data.get("taskid") or not db.get(Task, data["taskid"]):
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    if me.user_grade != 0:
        data["work_userid"] = me.userid  # 비관리자는 자기 이력만 등록 가능
    obj = WorkScheduleLog(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{workschid}", response_model=WorkLogOut)
def update_work_log(workschid: int, body: WorkLogUpdate,
                    db: Session = Depends(get_db),
                    me: User = Depends(get_current_user)):
    obj = db.get(WorkScheduleLog, workschid)
    if not obj:
        raise HTTPException(404, "작업이력을 찾을 수 없습니다")
    check_owner_or_admin(me, obj.work_userid)
    data = body.model_dump(exclude_unset=True)
    # 등록 후에는 작업/작업자 변경 불가 — 작업내용만 수정 가능
    if "taskid" in data and data["taskid"] != obj.taskid:
        raise HTTPException(400, "등록된 이력의 작업은 변경할 수 없습니다")
    if "work_userid" in data and data["work_userid"] != obj.work_userid:
        raise HTTPException(400, "등록된 이력의 작업자는 변경할 수 없습니다")
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{workschid}", status_code=204)
def delete_work_log(workschid: int, db: Session = Depends(get_db),
                    me: User = Depends(get_current_user)):
    obj = db.get(WorkScheduleLog, workschid)
    if not obj:
        raise HTTPException(404, "작업이력을 찾을 수 없습니다")
    check_owner_or_admin(me, obj.work_userid)
    db.delete(obj)
    db.commit()
