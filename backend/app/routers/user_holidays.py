from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import UserHoliday, User
from ..schemas import UserHolidayCreate, UserHolidayUpdate, UserHolidayOut
from ..scheduler import WORK_HOURS_PER_DAY
from ..security import get_current_user, check_owner_or_admin

router = APIRouter(prefix="/api/user-holidays", tags=["user-holidays"])


def _query(db: Session):
    return (
        db.query(UserHoliday, User.user_name)
        .outerjoin(User, User.userid == UserHoliday.work_userid)
    )


def _to_out(row) -> UserHolidayOut:
    hol, user_name = row
    hrs = hol.holiday_hours or 0
    if hol.holiday_category == "P" and 0 < hrs < WORK_HOURS_PER_DAY:
        # 일부휴가는 하루 근무의 뒤쪽 hrs 시간을 차지 -> 뒤쪽 비율 구간
        span = [round(1 - hrs / WORK_HOURS_PER_DAY, 3), 1.0]
    else:
        span = [0.0, 1.0]
    return UserHolidayOut(
        dateid=hol.dateid,
        work_userid=hol.work_userid,
        holiday_category=hol.holiday_category,
        holiday_hours=hol.holiday_hours,
        holiday_remark=hol.holiday_remark,
        user_name=user_name,
        span=span,
    )


@router.get("", response_model=list[UserHolidayOut])
def list_holidays(
    work_userid: str = Query(None),
    start: str = Query(None, description="yyyymmdd"),
    end: str = Query(None, description="yyyymmdd"),
    db: Session = Depends(get_db),
):
    q = _query(db)
    if work_userid:
        q = q.filter(UserHoliday.work_userid == work_userid)
    if start:
        q = q.filter(UserHoliday.dateid >= start)
    if end:
        q = q.filter(UserHoliday.dateid <= end)
    rows = q.order_by(UserHoliday.dateid, UserHoliday.work_userid).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=UserHolidayOut, status_code=201)
def create_holiday(body: UserHolidayCreate, db: Session = Depends(get_db),
                   me: User = Depends(get_current_user)):
    check_owner_or_admin(me, body.work_userid)
    obj = db.get(UserHoliday, (body.dateid, body.work_userid))
    if obj:
        raise HTTPException(409, "해당 일자/작업자의 휴가가 이미 존재합니다")
    obj = UserHoliday(**body.model_dump())
    db.add(obj)
    db.commit()
    row = _query(db).filter(
        UserHoliday.dateid == body.dateid,
        UserHoliday.work_userid == body.work_userid,
    ).first()
    return _to_out(row)


@router.put("/{dateid}/{work_userid}", response_model=UserHolidayOut)
def update_holiday(dateid: str, work_userid: str, body: UserHolidayUpdate,
                   db: Session = Depends(get_db),
                   me: User = Depends(get_current_user)):
    check_owner_or_admin(me, work_userid)
    obj = db.get(UserHoliday, (dateid, work_userid))
    if not obj:
        raise HTTPException(404, "휴가를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    row = _query(db).filter(
        UserHoliday.dateid == dateid, UserHoliday.work_userid == work_userid
    ).first()
    return _to_out(row)


@router.delete("/{dateid}/{work_userid}", status_code=204)
def delete_holiday(dateid: str, work_userid: str, db: Session = Depends(get_db),
                   me: User = Depends(get_current_user)):
    check_owner_or_admin(me, work_userid)
    obj = db.get(UserHoliday, (dateid, work_userid))
    if not obj:
        raise HTTPException(404, "휴가를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
