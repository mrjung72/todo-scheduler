"""비밀번호 해시 (stdlib PBKDF2) + 로그인 토큰(HMAC 서명, 만료 포함).

저장 형식: pbkdf2$iterations$salt_hex$hash_hex
토큰 형식: base64url(userid|expiry_epoch|hmac_hex)
"""
import base64
import hashlib
import hmac
import os
import time

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .models import User

_ITER = 100_000
_TOKEN_TTL = 60 * 60 * 12          # 12시간
_SECRET = os.getenv("SECRET_KEY", "todo-scheduler-secret")


def hash_password(plain: str) -> str:
    salt = os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac("sha256", (plain or "").encode(), bytes.fromhex(salt), _ITER)
    return f"pbkdf2${_ITER}${salt}${dk.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        _, iters, salt, expected = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", (plain or "").encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), expected)
    except (ValueError, AttributeError):
        return False


def make_token(userid: str) -> str:
    exp = int(time.time()) + _TOKEN_TTL
    payload = f"{userid}|{exp}"
    sig = hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def parse_token(token: str):
    """유효하면 userid, 아니면 None."""
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        userid, exp, sig = raw.rsplit("|", 2)
        payload = f"{userid}|{exp}"
        expect = hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expect) or int(exp) < time.time():
            return None
        return userid
    except Exception:
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Authorization Bearer 토큰 -> 현재 User (권한 검사용 의존성)."""
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    uid = parse_token(token)
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(401, "로그인이 필요합니다")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.user_grade != 0:
        raise HTTPException(403, "관리자 권한이 필요합니다")
    return user


def require_planner(user: User = Depends(get_current_user)) -> User:
    """공통 휴일 관리: 관리자(0)/개발자(1)/IT업무담당자(2)."""
    if user.user_grade not in (0, 1, 2):
        raise HTTPException(403, "권한이 없습니다")
    return user


def check_owner_or_admin(user: User, work_userid):
    """비관리자는 자기 작업(work_userid == 본인)만 수정 가능."""
    if user.user_grade != 0 and work_userid != user.userid:
        raise HTTPException(403, "자신의 작업만 수정할 수 있습니다")
