from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Site, User, Task, TaskCategory
from ..schemas import SiteCreate, SiteUpdate, SiteOut
from ..security import require_staff

router = APIRouter(prefix="/api/sites", tags=["sites"])


@router.get("", response_model=list[SiteOut])
def list_sites(db: Session = Depends(get_db)):
    return db.query(Site).order_by(Site.siteid).all()


@router.post("", response_model=SiteOut, status_code=201)
def create_site(body: SiteCreate, db: Session = Depends(get_db),
                me: User = Depends(require_staff)):
    if db.get(Site, body.siteid):
        raise HTTPException(409, "이미 존재하는 사이트ID입니다")
    obj = Site(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{siteid}", response_model=SiteOut)
def update_site(siteid: str, body: SiteUpdate, db: Session = Depends(get_db),
                me: User = Depends(require_staff)):
    obj = db.get(Site, siteid)
    if not obj:
        raise HTTPException(404, "사이트를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{siteid}", status_code=204)
def delete_site(siteid: str, db: Session = Depends(get_db),
                me: User = Depends(require_staff)):
    obj = db.get(Site, siteid)
    if not obj:
        raise HTTPException(404, "사이트를 찾을 수 없습니다")
    # 작업·업무유형·사용자 기본사이트에 적용된 사이트는 삭제 불가
    n = db.query(Task).filter(Task.siteid == siteid).count()
    if n:
        raise HTTPException(409, f"이 사이트에 등록된 작업이 {n}건 있어 삭제할 수 없습니다")
    n = db.query(TaskCategory).filter(TaskCategory.siteid == siteid).count()
    if n:
        raise HTTPException(409, f"이 사이트에 등록된 업무유형이 {n}건 있어 삭제할 수 없습니다")
    n = db.query(User).filter(User.default_siteid == siteid).count()
    if n:
        raise HTTPException(409, f"이 사이트를 기본사이트로 사용 중인 사용자가 {n}명 있어 삭제할 수 없습니다")
    db.delete(obj)
    db.commit()
