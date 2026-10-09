from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, aliased
from sqlalchemy import or_
from pydantic import BaseModel

from ..database import get_db
from ..models import Task, User, Site, TaskChgLog, WorkScheduleLog
from ..schemas import TaskCreate, TaskUpdate, TaskOut, TaskDetail, TaskChgLogOut
from ..scheduler import (
    recalculate, get_calendar_map, get_holiday_map,
    add_work_hours, workday_cal, daily_breakdown,
)
from ..statusflow import apply_task_stat_change
from ..security import get_current_user, check_task_access

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

ReqUser = aliased(User)
ItosUser = aliased(User)
WorkUser = aliased(User)

# users FK 대상 컬럼: 화면/CSV에서 빈 문자열로 들어오면 FK 위반이 되므로 NULL로 정규화
_USER_FK_COLS = ("req_userid", "itos_userid", "work_userid")


def _norm_user_fks(data: dict):
    for k in _USER_FK_COLS:
        if data.get(k) == "":
            data[k] = None


def _detail_query(db: Session):
    """tasks + 사용자/사이트 조인"""
    return (
        db.query(
            Task,
            ReqUser.user_name.label("req_user_name"),
            ItosUser.user_name.label("itos_user_name"),
            WorkUser.user_name.label("work_user_name"),
            Site.site_name.label("site_name"),
        )
        .select_from(Task)
        .outerjoin(ReqUser, ReqUser.userid == Task.req_userid)
        .outerjoin(ItosUser, ItosUser.userid == Task.itos_userid)
        .outerjoin(WorkUser, WorkUser.userid == Task.work_userid)
        .outerjoin(Site, Site.siteid == Task.siteid)
    )


def _to_detail(row) -> TaskDetail:
    task, req_name, itos_name, work_name, site_name = row
    data = {c.name: getattr(task, c.name) for c in Task.__table__.columns}
    data.update(
        req_user_name=req_name,
        itos_user_name=itos_name,
        work_user_name=work_name,
        site_name=site_name,
    )
    return TaskDetail(**data)


@router.get("", response_model=list[TaskDetail])
def list_tasks(
    q: str = Query(None, description="검색어"),
    field: str = Query("all", description="all|task_name|req_user|itos_user|work_user"),
    task_stat: str = Query(None),
    siteid: str = Query(None),
    task_type: str = Query(None),
    work_userid: str = Query(None),
    db: Session = Depends(get_db),
):
    query = _detail_query(db)

    if siteid:
        query = query.filter(Task.siteid == siteid)

    if work_userid:
        query = query.filter(Task.work_userid == work_userid)

    if task_type:
        types = [s for s in str(task_type).split(',') if s]
        query = query.filter(Task.task_type.in_(types))

    if task_stat:
        stats = [s for s in str(task_stat).split(',') if s]
        query = query.filter(Task.task_stat.in_(stats))

    if q:
        like = f"%{q}%"
        if field == "task_name":
            query = query.filter(Task.task_name.like(like))
        elif field == "req_user":
            query = query.filter(
                or_(Task.req_userid.like(like), ReqUser.user_name.like(like))
            )
        elif field == "itos_user":
            query = query.filter(
                or_(Task.itos_userid.like(like), ItosUser.user_name.like(like))
            )
        elif field == "work_user":
            query = query.filter(
                or_(Task.work_userid.like(like), WorkUser.user_name.like(like))
            )
        else:
            query = query.filter(
                or_(
                    Task.task_name.like(like),
                    Task.req_userid.like(like),
                    ReqUser.user_name.like(like),
                    Task.itos_userid.like(like),
                    ItosUser.user_name.like(like),
                    Task.work_userid.like(like),
                    WorkUser.user_name.like(like),
                )
            )

    rows = query.order_by(Task.priority, Task.taskid).all()
    return [_to_detail(r) for r in rows]


@router.post("/recalculate")
def recalc(db: Session = Depends(get_db),
           me: User = Depends(get_current_user)):
    """우선순위 기준으로 대기중 작업의 시작/종료일시를 재계산.

    관리자는 전체, 개발자는 본인 작업만 대상으로 한다."""
    updated, created = recalculate(db, only_userid=None if me.user_grade in (0, 1) else me.userid)
    return {"updated": updated, "created": created}


@router.post("/auto-schedule/{taskid}", response_model=TaskDetail)
def auto_schedule_one(taskid: int, db: Session = Depends(get_db),
                      me: User = Depends(get_current_user)):
    """단일 작업 자동 스케줄 (해당 작업자 라인의 마지막에 배치)."""
    task = db.get(Task, taskid)
    if not task:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    recalculate(db, only_userid=None if me.user_grade in (0, 1) else me.userid)
    row = _detail_query(db).filter(Task.taskid == taskid).first()
    return _to_detail(row)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    data = body.model_dump()
    _norm_user_fks(data)
    if me.user_grade not in (0, 1):
        data["work_userid"] = me.userid  # 비스태프는 자기 작업만 등록 가능
    if not data.get("req_userid"):
        data["req_userid"] = me.userid   # 요청자 미지정 시 등록자 본인
    now = datetime.now().replace(microsecond=0)
    if not data.get("req_date"):
        data["req_date"] = now          # 요청일자 = 등록 시각
    task = Task(**data)
    db.add(task)
    db.flush()  # taskid 확보
    # 등록 상태를 상태변경이력 첫 행으로 기록
    db.add(TaskChgLog(taskid=task.taskid, task_stat=task.task_stat or "R",
                      work_hours=0, remark="등록",
                      work_userid=me.userid, create_date=now))
    db.commit()
    db.refresh(task)
    return task


@router.put("/{taskid}", response_model=TaskOut)
def update_task(taskid: int, body: TaskUpdate, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    obj = db.get(Task, taskid)
    if not obj:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    check_task_access(me, obj.work_userid, obj.siteid)
    data = body.model_dump(exclude_unset=True)
    _norm_user_fks(data)
    if me.user_grade not in (0, 1) and "work_userid" in data and data["work_userid"] != me.userid:
        raise HTTPException(403, "다른 작업자에게 배정할 수 없습니다")
    new_stat = data.pop("task_stat", None)
    remark = data.pop("stat_remark", None)
    # 유형/작업명/우선순위/현업담당자/IT업무담당자는 R·C·W 상태에서만 변경 가능
    restricted = {"task_name", "task_type", "priority", "req_userid", "itos_userid",
                  "work_hours_estimated", "work_userid"}
    eff_stat = new_stat if new_stat is not None else obj.task_stat
    if eff_stat not in ("R", "C", "W") and \
            any(f in data and data[f] != getattr(obj, f) for f in restricted):
        raise HTTPException(400,
            "유형/작업명/우선순위/예상작업시간/현업담당자/IT업무담당자/작업자는 작업요청·검토중·대기중 상태에서만 변경할 수 있습니다")
    # 실제 작업시간은 상태전이(P 구간) 시 자동 집계 — 직접 수정 불가
    if "work_hours_real" in data and data["work_hours_real"] != obj.work_hours_real:
        raise HTTPException(400, "실제 작업시간은 자동 집계되므로 직접 수정할 수 없습니다")
    for k, v in data.items():
        setattr(obj, k, v)
    # 작업상태 변경: 전이 규칙 검증 + 이력 기록
    if new_stat is not None:
        apply_task_stat_change(db, obj, new_stat, remark,
                               actor_userid=me.userid)
    # 예상 작업시간 변경 시 시작일시가 잡힌 작업의 종료예상일시 재계산
    if "work_hours_estimated" in data and obj.task_start_date:
        cal = get_calendar_map(db)
        hol = get_holiday_map(db)
        uid = obj.work_userid or ""
        # 고정 시작일이 휴일이면 그날은 경과시간 그대로 적용
        cal_f = workday_cal(cal, obj.task_start_date.date())
        obj.task_end_date_estimated = add_work_hours(
            obj.task_start_date, obj.work_hours_estimated or 0,
            cal_f, hol, uid)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{taskid}", status_code=204)
def delete_task(taskid: int, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    obj = db.get(Task, taskid)
    if not obj:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    check_task_access(me, obj.work_userid, obj.siteid)
    db.query(WorkScheduleLog).filter(
        WorkScheduleLog.taskid == taskid).delete()
    db.query(TaskChgLog).filter(TaskChgLog.taskid == taskid).delete()
    db.delete(obj)
    db.commit()


class StartSet(BaseModel):
    start_datetime: datetime


@router.patch("/{taskid}/start", response_model=TaskOut)
def set_start(taskid: int, body: StartSet, db: Session = Depends(get_db),
              me: User = Depends(get_current_user)):
    """시작일시 수동 설정 -> start_fixed=1 로 고정하고 종료예상일시 재계산."""
    task = db.get(Task, taskid)
    if not task:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    check_task_access(me, task.work_userid, task.siteid)
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)
    uid = task.work_userid or ""
    # 입력값 그대로 저장 (휴일/근무시간 스냅 없음). 지정일이 휴일이면
    # 근무구간을 무시하고 그날의 경과시간 그대로 작업시간을 적용해 종료를 계산
    task.task_start_date = body.start_datetime
    task.start_fixed = 1
    cal = workday_cal(cal, body.start_datetime.date())
    task.task_end_date_estimated = add_work_hours(
        task.task_start_date, task.work_hours_estimated or 0, cal, hol, uid
    )
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{taskid}/unfix", response_model=TaskOut)
def unfix_start(taskid: int, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    """수동 시작일시 고정 해제 -> 다음 재계산 시 자동 배치."""
    task = db.get(Task, taskid)
    if not task:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    check_task_access(me, task.work_userid, task.siteid)
    task.start_fixed = 0
    db.commit()
    db.refresh(task)
    return task


@router.get("/{taskid}/daily")
def daily_hours(taskid: int, db: Session = Depends(get_db)):
    """작업의 시작~예상종료 구간을 일별 작업시간으로 분해."""
    task = db.get(Task, taskid)
    if not task:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    if not task.task_start_date or not task.task_end_date_estimated:
        return []
    cal = get_calendar_map(db)
    hol = get_holiday_map(db)
    uid = task.work_userid or ""
    bd = daily_breakdown(
        task.task_start_date, task.task_end_date_estimated,
        workday_cal(cal, task.task_start_date.date()), hol, uid)
    return [{"date": k, "hours": v["hours"]} for k, v in bd.items()]


@router.get("/{taskid}/his", response_model=list[TaskChgLogOut])
def task_his(taskid: int, db: Session = Depends(get_db)):
    """작업 상태변경이력 (최근 이력 순)."""
    rows = (db.query(TaskChgLog, WorkUser.user_name)
            .outerjoin(WorkUser, WorkUser.userid == TaskChgLog.work_userid)
            .filter(TaskChgLog.taskid == taskid)
            .order_by(TaskChgLog.taskchgid.desc()).all())
    return [{**{c.name: getattr(h, c.name) for c in TaskChgLog.__table__.columns},
             "work_user_name": name} for h, name in rows]
