from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import User
from ..security import verify_password, make_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    userid: str
    password: str


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.get(User, body.userid)
    if not user or user.user_stat != "Y" or not verify_password(body.password, user.password):
        raise HTTPException(401, "사용자ID 또는 비밀번호가 올바르지 않습니다")
    return {
        "token": make_token(user.userid),
        "user": {
            "userid": user.userid,
            "user_name": user.user_name,
            "dept_name": user.dept_name,
            "user_grade": user.user_grade,
        },
    }
