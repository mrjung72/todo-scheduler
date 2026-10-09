from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import User, Site
from ..schemas import UserCreate, UserUpdate, UserOut
from ..security import (
    hash_password, verify_password, get_current_user,
)

router = APIRouter(prefix="/api/users", tags=["users"])

ADMIN_USERID = "admin"


def _check_staff(me: User):
    """사용자 관리 권한: 관리자(0)/개발자(1)."""
    if me.user_grade not in (0, 1):
        raise HTTPException(403, "권한이 없습니다")


def _check_not_admin_account(userid: str, me: User):
    """admin 계정은 본인 외에는 어떤 수정도 불가."""
    if userid == ADMIN_USERID and me.userid != ADMIN_USERID:
        raise HTTPException(403, "admin 계정은 수정할 수 없습니다")


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
def create_user(body: UserCreate, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    _check_staff(me)
    if body.userid == ADMIN_USERID:
        raise HTTPException(400, "admin 계정은 생성할 수 없습니다")
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
def update_user(userid: str, body: UserUpdate, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    _check_not_admin_account(userid, me)
    data = body.model_dump(exclude_unset=True)
    if me.user_grade not in (0, 1):
        # 비스태프: 본인 계정의 개인정보 항목만 수정 가능
        # (등급/기본사이트/상태/비밀번호는 스태프만 변경 가능)
        if userid != me.userid:
            raise HTTPException(403, "권한이 없습니다")
        allowed = {"user_name", "dept_name", "job_title", "user_tel", "user_email"}
        data = {k: v for k, v in data.items() if k in allowed}
        if not data:
            raise HTTPException(400, "수정할 수 있는 항목이 없습니다")
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


@router.post("/{userid}/password-reset", status_code=204)
def reset_password(userid: str, db: Session = Depends(get_db),
                   me: User = Depends(get_current_user)):
    """관리자/개발자: 사용자 비밀번호를 초기값(1234)으로 초기화."""
    _check_not_admin_account(userid, me)
    _check_staff(me)
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    obj.password = hash_password("1234")
    db.commit()


@router.delete("/{userid}", status_code=204)
def delete_user(userid: str, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    _check_not_admin_account(userid, me)
    _check_staff(me)
    if obj.user_grade == 0:
        raise HTTPException(400, "관리자 등급 사용자는 삭제할 수 없습니다")
    db.delete(obj)
    db.commit()
