from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Site
from ..schemas import SiteCreate, SiteUpdate, SiteOut

router = APIRouter(prefix="/api/sites", tags=["sites"])


@router.get("", response_model=list[SiteOut])
def list_sites(db: Session = Depends(get_db)):
    return db.query(Site).order_by(Site.siteid).all()


@router.post("", response_model=SiteOut, status_code=201)
def create_site(body: SiteCreate, db: Session = Depends(get_db)):
    if db.get(Site, body.siteid):
        raise HTTPException(409, "이미 존재하는 사이트ID입니다")
    obj = Site(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{siteid}", response_model=SiteOut)
def update_site(siteid: str, body: SiteUpdate, db: Session = Depends(get_db)):
    obj = db.get(Site, siteid)
    if not obj:
        raise HTTPException(404, "사이트를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{siteid}", status_code=204)
def delete_site(siteid: str, db: Session = Depends(get_db)):
    obj = db.get(Site, siteid)
    if not obj:
        raise HTTPException(404, "사이트를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
