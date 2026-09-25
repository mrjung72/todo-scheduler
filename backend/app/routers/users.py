from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserUpdate, UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.userid).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    if db.get(User, body.userid):
        raise HTTPException(409, "이미 존재하는 사용자ID입니다")
    obj = User(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{userid}", response_model=UserOut)
def update_user(userid: str, body: UserUpdate, db: Session = Depends(get_db)):
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{userid}", status_code=204)
def delete_user(userid: str, db: Session = Depends(get_db)):
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
