from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, aliased
from sqlalchemy import or_, func, select

from ..database import get_db
from ..models import Task, User, Site, WorkSchedule
from ..schemas import TaskCreate, TaskUpdate, TaskOut, TaskDetail
from ..scheduler import recalculate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

ReqUser = aliased(User)
ItosUser = aliased(User)
WorkUser = aliased(User)


def _detail_query(db: Session):
    """tasks + 대표 work_schedule(taskid별 최소 workschid) + 사용자/사이트 조인"""
    sub = (
        db.query(
            WorkSchedule.taskid.label("taskid"),
            func.min(WorkSchedule.workschid).label("mid"),
        )
        .group_by(WorkSchedule.taskid)
        .subquery()
    )
    return (
        db.query(
            Task,
            WorkSchedule,
            ReqUser.user_name.label("req_user_name"),
            ItosUser.user_name.label("itos_user_name"),
            WorkUser.user_name.label("work_user_name"),
            Site.site_name.label("site_name"),
        )
        .select_from(Task)
        .outerjoin(sub, sub.c.taskid == Task.taskid)
        .outerjoin(WorkSchedule, WorkSchedule.workschid == sub.c.mid)
        .outerjoin(ReqUser, ReqUser.userid == Task.req_userid)
        .outerjoin(ItosUser, ItosUser.userid == Task.itos_userid)
        .outerjoin(WorkUser, WorkUser.userid == WorkSchedule.work_userid)
        .outerjoin(Site, Site.siteid == Task.siteid)
    )


def _to_detail(row) -> TaskDetail:
    task, sched, req_name, itos_name, work_name, site_name = row
    data = {c.name: getattr(task, c.name) for c in Task.__table__.columns}
    data.update(
        req_user_name=req_name,
        itos_user_name=itos_name,
        work_user_name=work_name,
        site_name=site_name,
        workschid=sched.workschid if sched else None,
        work_userid=sched.work_userid if sched else None,
        work_stat=sched.work_stat if sched else None,
        start_datetime=sched.start_datetime if sched else None,
        end_datetime_estimated=sched.end_datetime_estimated if sched else None,
        end_datetime_real=sched.end_datetime_real if sched else None,
        start_fixed=sched.start_fixed if sched else 0,
    )
    return TaskDetail(**data)


@router.get("", response_model=list[TaskDetail])
def list_tasks(
    q: str = Query(None, description="검색어"),
    field: str = Query("all", description="all|task_name|req_user|itos_user|work_user"),
    task_stat: str = Query(None),
    db: Session = Depends(get_db),
):
    query = _detail_query(db)

    if task_stat:
        query = query.filter(Task.task_stat == task_stat)

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
                or_(WorkSchedule.work_userid.like(like), WorkUser.user_name.like(like))
            )
        else:
            query = query.filter(
                or_(
                    Task.task_name.like(like),
                    Task.req_userid.like(like),
                    ReqUser.user_name.like(like),
                    Task.itos_userid.like(like),
                    ItosUser.user_name.like(like),
                    WorkSchedule.work_userid.like(like),
                    WorkUser.user_name.like(like),
                )
            )

    rows = query.order_by(Task.priority, Task.taskid).all()
    return [_to_detail(r) for r in rows]


@router.post("/recalculate")
def recalc(db: Session = Depends(get_db)):
    """우선순위 기준으로 전체 작업의 시작/종료일시를 재계산."""
    updated = recalculate(db)
    return {"updated": updated}


@router.post("/auto-schedule/{taskid}", response_model=TaskDetail)
def auto_schedule_one(taskid: int, db: Session = Depends(get_db)):
    """단일 작업 자동 스케줄 (해당 작업자 라인의 마지막에 배치)."""
    task = db.get(Task, taskid)
    if not task:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    recalculate(db)  # 단순화: 전체 재계산과 동일 로직 사용
    row = _detail_query(db).filter(Task.taskid == taskid).first()
    return _to_detail(row)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    data = body.model_dump()
    work_userid = data.pop("work_userid", None)
    task = Task(**data)
    db.add(task)
    db.flush()  # taskid 확보
    # 대표 작업스케줄 자동 생성
    sched = WorkSchedule(taskid=task.taskid, work_stat="W", work_userid=work_userid)
    db.add(sched)
    db.commit()
    db.refresh(task)
    return task


@router.put("/{taskid}", response_model=TaskOut)
def update_task(taskid: int, body: TaskUpdate, db: Session = Depends(get_db)):
    obj = db.get(Task, taskid)
    if not obj:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{taskid}", status_code=204)
def delete_task(taskid: int, db: Session = Depends(get_db)):
    obj = db.get(Task, taskid)
    if not obj:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    db.query(WorkSchedule).filter(WorkSchedule.taskid == taskid).delete()
    db.delete(obj)
    db.commit()
