"""사이트별 작업 업무유형(task_category) CRUD.

- 목록 조회는 로그인 사용자 전체
- 등록·수정·삭제는 스태프(관리자 0·수석개발자 1)만
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TaskCategory, Site, User, Task
from ..schemas import TaskCategoryIn, TaskCategoryUpdate, TaskCategoryOut
from ..security import get_current_user, require_staff

router = APIRouter(prefix="/api/task-categories", tags=["task-categories"])


@router.get("", response_model=list[TaskCategoryOut])
def list_categories(siteid: str = Query(None),
                    use_stat: str = Query(None),
                    db: Session = Depends(get_db)):
    """업무유형 목록 (siteid·use_stat 필터)."""
    q = (db.query(TaskCategory, Site.site_name)
         .outerjoin(Site, Site.siteid == TaskCategory.siteid))
    if siteid:
        q = q.filter(TaskCategory.siteid == siteid)
    if use_stat:
        q = q.filter(TaskCategory.use_stat == use_stat)
    rows = q.order_by(TaskCategory.siteid, TaskCategory.task_category_cd).all()
    return [{**{col.name: getattr(c, col.name)
                for col in TaskCategory.__table__.columns},
             "site_name": site_name} for c, site_name in rows]


@router.post("", response_model=TaskCategoryOut, status_code=201)
def create_category(body: TaskCategoryIn, db: Session = Depends(get_db),
                    me: User = Depends(require_staff)):
    """업무유형 등록 — 코드 중복 불가, 사이트는 등록된 사이트만."""
    cd = body.task_category_cd.strip()
    if db.get(TaskCategory, cd):
        raise HTTPException(409, f"이미 등록된 업무유형코드입니다 ({cd})")
    if not db.get(Site, body.siteid):
        raise HTTPException(400, "등록되지 않은 사이트입니다")
    obj = TaskCategory(
        task_category_cd=cd,
        task_category_nm=body.task_category_nm.strip(),
        siteid=body.siteid,
        use_stat=body.use_stat or "Y",
        create_date=datetime.now().replace(microsecond=0),
    )
    db.add(obj)
    db.commit()
    return TaskCategoryOut.model_validate(obj)


@router.put("/{cd}", response_model=TaskCategoryOut)
def update_category(cd: str, body: TaskCategoryUpdate,
                    db: Session = Depends(get_db),
                    me: User = Depends(require_staff)):
    """업무유형 수정 (코드는 변경 불가)."""
    obj = db.get(TaskCategory, cd)
    if not obj:
        raise HTTPException(404, "업무유형을 찾을 수 없습니다")
    data = body.model_dump(exclude_unset=True)
    if data.get("siteid") and not db.get(Site, data["siteid"]):
        raise HTTPException(400, "등록되지 않은 사이트입니다")
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    return TaskCategoryOut.model_validate(obj)


@router.delete("/{cd}", status_code=204)
def delete_category(cd: str, db: Session = Depends(get_db),
                    me: User = Depends(require_staff)):
    """업무유형 삭제 — 작업에 적용된 유형은 삭제 불가."""
    obj = db.get(TaskCategory, cd)
    if not obj:
        raise HTTPException(404, "업무유형을 찾을 수 없습니다")
    n = db.query(Task).filter(Task.task_category_cd == cd).count()
    if n:
        raise HTTPException(409, f"이 업무유형이 적용된 작업이 {n}건 있어 삭제할 수 없습니다")
    db.delete(obj)
    db.commit()
