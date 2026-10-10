from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import User, Site
from ..schemas import UserCreate, UserUpdate, UserOut
from ..security import (
    hash_password, verify_password, get_current_user,
)
from ..scheduler import recalculate

router = APIRouter(prefix="/api/users", tags=["users"])

ADMIN_USERID = "admin"

# 등급별 관리 가능한 대상 등급
# 0-관리자: 전체 / 1-수석개발자: 관리자(0) 외 전체
# 3-개발매니저: 일반개발자(4)만 / 5-IT업무담당자: 하위등급(7·9)
MANAGED_GRADES = {
    0: {0, 1, 3, 4, 5, 7, 9},
    1: {1, 3, 4, 5, 7, 9},
    3: {4},
    5: {7, 9},
}

# 관리 대상이 아닐 때 본인 계정에 허용되는 항목 (개인정보 + 하루작업시간 + 비밀번호)
PERSONAL_FIELDS = {"user_name", "dept_name", "job_title", "user_tel",
                   "user_email", "work_hours_day", "password"}


def _check_work_hours(data: dict):
    """하루 개발시간 값 검증 — 2~8 사이 정수. None/미설정이면 근무구간 기본값."""
    v = data.get("work_hours_day")
    if v is not None and not (float(v).is_integer() and 2 <= v <= 8):
        raise HTTPException(400, "하루 개발시간은 2~8 사이의 정수로 입력하세요")


def _managed(me: User) -> set:
    return MANAGED_GRADES.get(me.user_grade, set())


def _can_manage(me: User, obj: User) -> bool:
    """me 가 obj 사용자의 정보를 변경할 수 있는지."""
    return obj.user_grade in _managed(me)


def _check_staff(me: User):
    """사용자 관리 권한: 관리자(0)/수석개발자(1)."""
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
    if body.user_grade not in _managed(me):
        raise HTTPException(403, "해당 등급의 사용자를 생성할 수 없습니다")
    if db.get(User, body.userid):
        raise HTTPException(409, "이미 존재하는 사용자ID입니다")
    if body.default_siteid and not db.get(Site, body.default_siteid):
        raise HTTPException(400, "존재하지 않는 사이트ID입니다")
    data = body.model_dump()
    _check_work_hours(data)
    # 하루작업시간은 개발자 등급(수석1·일반4)만 사용 — 그 외 등급은 저장하지 않음
    if data.get("user_grade") not in (1, 4):
        data["work_hours_day"] = None
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
    if _can_manage(me, obj):
        # 관리 대상: 등급 변경은 자신이 관리할 수 있는 등급 범위 내로만
        if ("user_grade" in data and data["user_grade"] is not None
                and data["user_grade"] not in _managed(me)):
            raise HTTPException(403, "해당 등급으로 변경할 수 없습니다")
    else:
        # 관리 대상 아님: 본인 계정의 개인정보 항목만 수정 가능
        # (등급/기본사이트/상태/비밀번호는 관리자만 변경 가능)
        if userid != me.userid:
            raise HTTPException(403, "권한이 없습니다")
        data = {k: v for k, v in data.items() if k in PERSONAL_FIELDS}
        if not data:
            raise HTTPException(400, "수정할 수 있는 항목이 없습니다")
    _check_work_hours(data)
    # 하루작업시간은 개발자 등급(수석1·일반4)만 설정 가능
    eff_grade = data.get("user_grade") if data.get("user_grade") is not None else obj.user_grade
    if "work_hours_day" in data and eff_grade not in (1, 4):
        raise HTTPException(
            400, "하루작업시간은 개발자(수석/일반)만 설정할 수 있습니다")
    # 개발자 외 등급으로 변경되면 하루작업시간을 초기화
    if data.get("user_grade") is not None and data["user_grade"] not in (1, 4):
        data["work_hours_day"] = None
    if data.get("default_siteid") and not db.get(Site, data["default_siteid"]):
        raise HTTPException(400, "존재하지 않는 사이트ID입니다")
    # 비밀번호는 본인만 직접 변경 가능 — 타인은 초기화(1234)만 가능
    if data.get("password") and userid != me.userid:
        raise HTTPException(
            403, "다른 사용자의 비밀번호는 변경할 수 없습니다 (초기화만 가능합니다)")
    # password는 값이 있을 때만 해시해서 반영 (빈 값은 무시)
    if "password" in data:
        pw = data.pop("password")
        if pw:
            obj.password = hash_password(pw)
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    # 하루 개발시간 변경 시 해당 작업자의 대기 작업 스케줄 자동 재계산
    if "work_hours_day" in data:
        recalculate(db, only_userid=userid)
    db.refresh(obj)
    return obj


@router.post("/{userid}/password-reset", status_code=204)
def reset_password(userid: str, db: Session = Depends(get_db),
                   me: User = Depends(get_current_user)):
    """관리 가능한 대상 사용자의 비밀번호를 초기값(1234)으로 초기화."""
    _check_not_admin_account(userid, me)
    obj = db.get(User, userid)
    if not obj:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if not _can_manage(me, obj):
        raise HTTPException(403, "권한이 없습니다")
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
    if not _can_manage(me, obj):
        raise HTTPException(403, "권한이 없습니다")
    if obj.user_grade == 0:
        raise HTTPException(400, "관리자 등급 사용자는 삭제할 수 없습니다")
    db.delete(obj)
    db.commit()
