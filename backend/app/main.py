import os
from datetime import date, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .database import Base, engine, SessionLocal
from .models import User, Site, Task, CalendarDefine, WorkSchedule
from .routers import users, sites, tasks, calendar, schedules, user_holidays, auth
from .security import hash_password, parse_token

app = FastAPI(title="TODO Scheduler API", version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(sites.router)
app.include_router(tasks.router)
app.include_router(calendar.router)
app.include_router(schedules.router)
app.include_router(user_holidays.router)

# --- API 인증 가드: /api/* 는 로그인 토큰 필요 (login/health/config 제외) ---
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

_AUTH_OPEN = {"/api/auth/login", "/api/health", "/api/config"}


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request, exc):
    return JSONResponse(
        {"detail": "참조 중인 데이터가 있거나 입력값이 올바르지 않아 처리할 수 없습니다"},
        status_code=409)


@app.middleware("http")
async def auth_guard(request, call_next):
    path = request.url.path
    # GET /api/tasks 는 홈 화면 공개 조회용으로 토큰 없이 허용
    if (request.method == "OPTIONS" or not path.startswith("/api")
            or path in _AUTH_OPEN
            or (request.method == "GET" and path == "/api/tasks")):
        return await call_next(request)
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not parse_token(token):
        return JSONResponse({"detail": "로그인이 필요합니다"}, status_code=401)
    return await call_next(request)


def seed(db):
    """최초 실행 시 기본 마스터 데이터 + 올해/내년 달력 생성."""
    if db.query(User).count() == 0:
        pw = hash_password("1234")
        db.add_all([
            User(userid="admin", user_name="관리자", dept_name="IT", job_title="팀장",
                 user_grade=0, password=pw, user_stat="Y"),
            User(userid="itos01", user_name="김아이티", dept_name="IT운영팀",
                 job_title="대리", user_grade=2, password=pw, user_stat="Y"),
            User(userid="req01", user_name="박현업", dept_name="영업팀",
                 job_title="과장", user_grade=3, password=pw, user_stat="Y"),
            User(userid="dev01", user_name="이개발", dept_name="개발팀",
                 job_title="선임", user_grade=1, password=pw, user_stat="Y"),
            User(userid="dev02", user_name="최코더", dept_name="개발팀",
                 job_title="주임", user_grade=1, password=pw, user_stat="Y"),
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


def migrate(db):
    """기존 DB에 나중에 추가된 컬럼을 보강 (SQLite ALTER TABLE)."""
    from sqlalchemy import text
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(users)"))}
    if "password" not in cols:
        db.execute(text(
            "ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''"))
        db.execute(text("UPDATE users SET password = :pw WHERE password = ''"),
                   {"pw": hash_password("1234")})
    if "default_siteid" not in cols:
        db.execute(text(
            "ALTER TABLE users ADD COLUMN default_siteid TEXT REFERENCES sites(siteid)"))
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(tasks)"))}
    if "work_userid" not in cols:
        db.execute(text("ALTER TABLE tasks ADD COLUMN work_userid TEXT"))
    if "task_req_filepath" in cols:   # 첨부파일은 task_attach_files 테이블로 이관
        db.execute(text("ALTER TABLE tasks DROP COLUMN task_req_filepath"))
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(work_schedule)"))}
    if "work_filepath" in cols:
        db.execute(text("ALTER TABLE work_schedule DROP COLUMN work_filepath"))
    db.commit()


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        migrate(db)
        seed(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "version": __version__}


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


# --- 프로덕션: 빌드된 프론트엔드 정적 서빙 (backend/static) ---
class SPAStaticFiles(StaticFiles):
    """존재하지 않는 경로는 index.html 로 fallback (React Router용).
    /api/* 경로는 fallback 대상에서 제외."""
    async def get_response(self, path, scope):
        if path.startswith("api/") or path == "api":
            raise StarletteHTTPException(404)
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as ex:
            if ex.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="static")
