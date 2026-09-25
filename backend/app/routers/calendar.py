from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CalendarDefine
from ..schemas import CalendarCreate, CalendarUpdate, CalendarOut

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


@router.get("", response_model=list[CalendarOut])
def list_calendar(
    start: str = Query(None, description="yyyymmdd"),
    end: str = Query(None, description="yyyymmdd"),
    db: Session = Depends(get_db),
):
    q = db.query(CalendarDefine)
    if start:
        q = q.filter(CalendarDefine.dateid >= start)
    if end:
        q = q.filter(CalendarDefine.dateid <= end)
    return q.order_by(CalendarDefine.dateid).all()


@router.post("/generate", status_code=201)
def generate_calendar(
    year: int = Query(..., description="생성할 연도 (예: 2026)"),
    db: Session = Depends(get_db),
):
    """해당 연도 전체 날짜를 생성. 월~금=W, 토/일=H. 기존 행은 유지."""
    d = date(year, 1, 1)
    end_d = date(year, 12, 31)
    created = 0
    while d <= end_d:
        dateid = d.strftime("%Y%m%d")
        if not db.get(CalendarDefine, dateid):
            stat = "W" if d.weekday() < 5 else "H"
            db.add(CalendarDefine(
                dateid=dateid,
                date_name=d.strftime("%Y-%m-%d"),
                date_stat=stat,
                holiday_remark="주말" if stat == "H" else None,
            ))
            created += 1
        d += timedelta(days=1)
    db.commit()
    return {"created": created}


@router.post("", response_model=CalendarOut, status_code=201)
def create_calendar_day(body: CalendarCreate, db: Session = Depends(get_db)):
    if db.get(CalendarDefine, body.dateid):
        raise HTTPException(409, "이미 존재하는 일자입니다")
    obj = CalendarDefine(**body.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{dateid}", response_model=CalendarOut)
def update_calendar_day(dateid: str, body: CalendarUpdate, db: Session = Depends(get_db)):
    obj = db.get(CalendarDefine, dateid)
    if not obj:
        raise HTTPException(404, "일자를 찾을 수 없습니다")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{dateid}", status_code=204)
def delete_calendar_day(dateid: str, db: Session = Depends(get_db)):
    obj = db.get(CalendarDefine, dateid)
    if not obj:
        raise HTTPException(404, "일자를 찾을 수 없습니다")
    db.delete(obj)
    db.commit()
