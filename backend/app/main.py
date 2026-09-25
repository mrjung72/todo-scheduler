from datetime import date, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .database import Base, engine, SessionLocal
from .models import User, Site, Task, CalendarDefine, WorkSchedule
from .routers import users, sites, tasks, calendar, schedules

app = FastAPI(title="TODO Scheduler API", version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(sites.router)
app.include_router(tasks.router)
app.include_router(calendar.router)
app.include_router(schedules.router)


def seed(db):
    """최초 실행 시 기본 마스터 데이터 + 올해/내년 달력 생성."""
    if db.query(User).count() == 0:
        db.add_all([
            User(userid="admin", user_name="관리자", dept_name="IT", job_title="팀장",
                 user_grade=0, user_stat="Y"),
            User(userid="itos01", user_name="김아이티", dept_name="IT운영팀",
                 job_title="대리", user_grade=1, user_stat="Y"),
            User(userid="req01", user_name="박현업", dept_name="영업팀",
                 job_title="과장", user_grade=2, user_stat="Y"),
            User(userid="dev01", user_name="이개발", dept_name="개발팀",
                 job_title="선임", user_grade=0, user_stat="Y"),
            User(userid="dev02", user_name="최코더", dept_name="개발팀",
                 job_title="주임", user_grade=0, user_stat="Y"),
        ])
    if db.query(Site).count() == 0:
        db.add_all([
            Site(siteid="SITE01", site_name="본사 시스템", site_stat="Y",
                 itos_userid="itos01"),
            Site(siteid="SITE02", site_name="물류센터", site_stat="Y",
                 itos_userid="itos01"),
        ])
    if db.query(CalendarDefine).count() == 0:
        today = date.today()
        for year in (today.year, today.year + 1):
            d = date(year, 1, 1)
            while d.year == year:
                stat = "W" if d.weekday() < 5 else "H"
                db.add(CalendarDefine(
                    dateid=d.strftime("%Y%m%d"),
                    date_name=d.strftime("%Y-%m-%d"),
                    date_stat=stat,
                    holiday_remark="주말" if stat == "H" else None,
                ))
                d += timedelta(days=1)
    db.commit()


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    from .scheduler import WORK_SEGMENTS, WORK_HOURS_PER_DAY, DAY_SEGMENTS
    return {
        "version": __version__,
        "work_segments": WORK_SEGMENTS,
        "work_hours_per_day": WORK_HOURS_PER_DAY,
        "segments": [
            {"start": s.strftime("%H:%M"), "end": e.strftime("%H:%M")}
            for s, e in DAY_SEGMENTS
        ],
    }
