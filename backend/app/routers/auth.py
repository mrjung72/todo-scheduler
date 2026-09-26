import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import User
from ..security import verify_password, make_token, hash_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    userid: str
    password: str


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.get(User, body.userid)
    if not user or not verify_password(body.password, user.password):
        raise HTTPException(401, "사용자ID 또는 비밀번호가 올바르지 않습니다")
    if user.user_stat == "A":
        raise HTTPException(401, "관리자 승인 대기 중입니다")
    if user.user_stat == "R":
        msg = "가입이 승인되지 않았습니다"
        if user.reject_remark:
            msg += f" (사유: {user.reject_remark})"
        raise HTTPException(401, msg)
    if user.user_stat != "Y":
        raise HTTPException(401, "비활성화된 계정입니다")
    return {
        "token": make_token(user.userid),
        "user": {
            "userid": user.userid,
            "user_name": user.user_name,
            "dept_name": user.dept_name,
            "user_grade": user.user_grade,
            "default_siteid": user.default_siteid,
        },
    }


_TEL_RE = re.compile(r"^[0-9]{2,4}-?[0-9]{3,4}-?[0-9]{4}$")
_ID_RE = re.compile(r"^[a-zA-Z0-9._-]+$")


class SignupBody(BaseModel):
    userid: str
    user_name: str
    password: str
    dept_name: str
    job_title: str
    user_tel: str
    user_email: str


@router.get("/check-userid")
def check_userid(userid: str, db: Session = Depends(get_db)):
    """회원ID 기가입 여부 — 회원가입 화면 실시간 중복 체크용."""
    u = db.get(User, userid)
    return {"exists": bool(u), "rejected": bool(u and u.user_stat == "R")}


@router.post("/signup", status_code=201)
def signup(body: SignupBody, db: Session = Depends(get_db)):
    """회원가입 — 관리자 승인(user_stat='A' -> 'Y') 후 로그인 가능."""
    body.userid = body.userid.strip().lower()
    if not _ID_RE.match(body.userid):
        raise HTTPException(400, "회원ID는 영문자, 숫자, _, -, . 만 사용할 수 있습니다")
    if len(body.userid) < 5:
        raise HTTPException(400, "회원ID는 5자 이상이어야 합니다")
    if len(body.userid) > 20:
        raise HTTPException(400, "회원ID는 20자 이하여야 합니다")
    if db.get(User, body.userid):
        raise HTTPException(409, "이미 가입된 사용자ID입니다")
    if not _TEL_RE.match(body.user_tel.strip()):
        raise HTTPException(400, "연락처 형식이 올바르지 않습니다 (예: 010-1234-5678)")
    obj = User(
        userid=body.userid, user_name=body.user_name,
        password=hash_password(body.password),
        dept_name=body.dept_name, job_title=body.job_title,
        user_tel=body.user_tel, user_email=body.user_email,
        user_grade=9, user_stat="A",   # 기타사용자 등급 + 승인대기
    )
    db.add(obj)
    db.commit()
    return {"detail": "가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다."}


class ReapplyBody(BaseModel):
    userid: str
    password: str
    user_name: str
    dept_name: str
    job_title: str
    user_tel: str
    user_email: str


class RejectedInfoBody(BaseModel):
    userid: str
    password: str


@router.post("/rejected-info")
def rejected_info(body: RejectedInfoBody, db: Session = Depends(get_db)):
    """승인불가('R') 회원 본인확인 후 현재 정보 반환 — 재신청 화면 미리 채우기용."""
    user = db.get(User, body.userid.strip().lower())
    if not user or user.user_stat != "R":
        raise HTTPException(400, "승인불가 상태의 회원만 조회할 수 있습니다")
    if not verify_password(body.password, user.password):
        raise HTTPException(401, "비밀번호가 올바르지 않습니다")
    return {
        "user_name": user.user_name, "dept_name": user.dept_name,
        "job_title": user.job_title, "user_tel": user.user_tel,
        "user_email": user.user_email,
    }


@router.post("/reapply")
def reapply(body: ReapplyBody, db: Session = Depends(get_db)):
    """승인불가('R') 회원 정보 수정 — 비밀번호 확인 후 다시 승인대기('A')로."""
    user = db.get(User, body.userid.strip().lower())
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if user.user_stat != "R":
        raise HTTPException(400, "승인불가 상태의 회원만 정보를 수정할 수 있습니다")
    if not verify_password(body.password, user.password):
        raise HTTPException(401, "비밀번호가 올바르지 않습니다")
    if not _TEL_RE.match(body.user_tel.strip()):
        raise HTTPException(400, "연락처 형식이 올바르지 않습니다 (예: 010-1234-5678)")
    user.user_name = body.user_name
    user.dept_name = body.dept_name
    user.job_title = body.job_title
    user.user_tel = body.user_tel
    user.user_email = body.user_email
    user.user_stat = "A"
    user.reject_remark = None
    db.commit()
    return {"detail": "정보가 수정되어 승인을 다시 요청했습니다. 관리자 승인 후 로그인할 수 있습니다."}
