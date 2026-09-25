from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import User, Site
from ..schemas import UserCreate, UserUpdate, UserOut
from ..security import hash_password, verify_password, get_current_user

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.userid).all()


@router.get("/me", response_model=UserOut)
def get_me(me: User = Depends(get_current_user)):
    return me


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/me/password", status_code=204)
def change_my_password(body: PasswordChange, db: Session = Depends(get_db),
                       me: User = Depends(get_current_user)):
    """본인 비밀번호 재설정 (현재 비밀번호 확인 필요)."""
    if not verify_password(body.current_password, me.password):
        raise HTTPException(400, "현재 비밀번호가 일치하지 않습니다")
    if not body.new_password.strip():
        raise HTTPException(400, "새 비밀번호를 입력하세요")
    me.password = hash_password(body.new_password)
    db.commit()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    if db.get(User, body.userid):
        raise HTTPException(409, "이미 존재하는 사용자ID입니다")
    if body.default_siteid and not db.get(Site, body.default_siteid):
        raise HTTPException(400, "존재하지 않는 사이트ID입니다")
    data = body.model_dump()
    data["password"] = hash_password(data.pop("password") or "1234")
    obj = User(**data)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{userid}", response_model=UserOut)
def update_user(userid: str, body: UserUpdate, db: Session = Depends(get_db)):
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    data = body.model_dump(exclude_unset=True)
    if data.get("default_siteid") and not db.get(Site, data["default_siteid"]):
        raise HTTPException(400, "존재하지 않는 사이트ID입니다")
    # password는 값이 있을 때만 해시해서 반영 (빈 값은 무시)
    if "password" in data:
        pw = data.pop("password")
        if pw:
            obj.password = hash_password(pw)
    for k, v in data.items():
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
