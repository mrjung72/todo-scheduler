import os
from datetime import date, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .database import Base, engine, SessionLocal
from .models import User, Site, Task, CalendarDefine, WorkScheduleLog
from .routers import (users, sites, tasks, calendar, schedules,
                      user_holidays, auth, attach_files)
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
app.include_router(attach_files.router)

# --- API 인증 가드: /api/* 는 로그인 토큰 필요 (login/health/config 제외) ---
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

_AUTH_OPEN = {"/api/auth/login", "/api/health", "/api/config",
              "/api/auth/signup", "/api/auth/check-userid",
              "/api/auth/reapply", "/api/auth/rejected-info"}


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
                 job_title="대리", user_grade=5, password=pw, user_stat="Y"),
            User(userid="req01", user_name="박현업", dept_name="영업팀",
                 job_title="과장", user_grade=7, password=pw, user_stat="Y"),
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
    if "reject_remark" not in cols:
        db.execute(text("ALTER TABLE users ADD COLUMN reject_remark TEXT"))
    # 사용자 등급 체계 개편 마이그레이션 (schema_meta 의 grade_scheme 버전으로 1회만 실행)
    # v1: 2=IT담당자,3=현업담당자,4=일반개발자 -> v2: 2=일반개발자,5=IT,7=현업
    # v3(현재): 3=개발매니저,4=일반개발자,5=IT,7=현업
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)"))
    if not db.execute(text(
            "SELECT value FROM schema_meta WHERE key='grade_scheme'")).scalar():
        # v1 체계 판별: 3·4 등급이 있고 5·7 등급이 없어야 함 (v3에도 3·4가 있으므로)
        has_34 = db.execute(text(
            "SELECT 1 FROM users WHERE user_grade IN (3, 4) LIMIT 1")).first()
        has_57 = db.execute(text(
            "SELECT 1 FROM users WHERE user_grade IN (5, 7) LIMIT 1")).first()
        if has_34 and not has_57:
            # v1 -> v2
            db.execute(text("""
                UPDATE users SET user_grade = CASE user_grade
                    WHEN 2 THEN 5 WHEN 3 THEN 7 WHEN 4 THEN 2
                    ELSE user_grade END
                WHERE user_grade IN (2, 3, 4)
            """))
        # v2 -> v3: 일반개발자 2 -> 4 (신 체계에서 2는 미사용)
        db.execute(text("UPDATE users SET user_grade = 4 WHERE user_grade = 2"))
        db.execute(text(
            "INSERT INTO schema_meta (key, value) VALUES ('grade_scheme', '3')"))
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(tasks)"))}
    if "work_userid" not in cols:
        db.execute(text("ALTER TABLE tasks ADD COLUMN work_userid TEXT"))
    if "task_req_filepath" in cols:   # 첨부파일은 task_attach_files 테이블로 이관
        db.execute(text("ALTER TABLE tasks DROP COLUMN task_req_filepath"))
    if "task_end_date_estimated" not in cols:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN task_end_date_estimated DATETIME"))
    if "start_fixed" not in cols:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN start_fixed INTEGER DEFAULT 0"))
    if "req_date" not in cols:
        db.execute(text("ALTER TABLE tasks ADD COLUMN req_date DATETIME"))
        db.execute(text("UPDATE tasks SET req_date = create_date "
                        "WHERE req_date IS NULL"))
    if "task_type" not in cols:
        db.execute(text("ALTER TABLE tasks ADD COLUMN task_type TEXT"))
    if "holiday_work" not in cols:
        db.execute(text(
            "ALTER TABLE tasks ADD COLUMN holiday_work INTEGER DEFAULT 0"))
    # task_chg_log.work_userid 추가 (기존 이력은 작업의 현재 작업자로 백필)
    if "task_chg_log" in {r[0] for r in db.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'"))}:
        cols = {r[1] for r in db.execute(
            text("PRAGMA table_info(task_chg_log)"))}
        if "work_userid" not in cols:
            db.execute(text(
                "ALTER TABLE task_chg_log ADD COLUMN work_userid TEXT"))
            db.execute(text("""
                UPDATE task_chg_log SET work_userid =
                  (SELECT t.work_userid FROM tasks t
                   WHERE t.taskid = task_chg_log.taskid)
                WHERE work_userid IS NULL
            """))

    tables = {r[0] for r in db.execute(
        text("SELECT name FROM sqlite_master WHERE type='table'"))}
    # work_schedule -> work_schedule_log : 일정/상태는 tasks 로 흡수,
    # 스케줄 레코드는 작업이력(작업내용 로그)으로 축소
    if "work_schedule" in tables:
        # 대표 스케줄(taskid별 최소 workschid)의 일시/고정값을 tasks 로 이관
        db.execute(text("""
            UPDATE tasks SET
              task_start_date = (SELECT w.start_datetime FROM work_schedule w
                WHERE w.taskid = tasks.taskid ORDER BY w.workschid LIMIT 1),
              task_end_date_estimated = (SELECT w.end_datetime_estimated
                FROM work_schedule w WHERE w.taskid = tasks.taskid
                ORDER BY w.workschid LIMIT 1),
              task_end_date = COALESCE(task_end_date,
                (SELECT w.end_datetime_real FROM work_schedule w
                 WHERE w.taskid = tasks.taskid ORDER BY w.workschid LIMIT 1)),
              start_fixed = (SELECT w.start_fixed FROM work_schedule w
                WHERE w.taskid = tasks.taskid ORDER BY w.workschid LIMIT 1)
            WHERE taskid IN (SELECT taskid FROM work_schedule)
        """))
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS work_schedule_log (
                workschid INTEGER PRIMARY KEY,
                taskid INTEGER REFERENCES tasks(taskid),
                work_remark TEXT,
                work_userid TEXT,
                create_date DATETIME
            )
        """))
        db.execute(text("""
            INSERT OR IGNORE INTO work_schedule_log
                (workschid, taskid, work_remark, work_userid, create_date)
            SELECT workschid, taskid, work_remark, work_userid, create_date
            FROM work_schedule
        """))
        # work_schedule_his -> task_chg_log (workschid -> taskid 매핑은
        # work_schedule 이 삭제되기 전의 값 사용)
        if "work_schedule_his" in tables:
            db.execute(text("""
                CREATE TABLE IF NOT EXISTS task_chg_log (
                    taskchgid INTEGER PRIMARY KEY,
                    taskid INTEGER REFERENCES tasks(taskid),
                    task_stat TEXT,
                    work_hours REAL DEFAULT 0,
                    remark TEXT,
                    work_userid TEXT,
                    create_date DATETIME
                )
            """))
            db.execute(text("""
                INSERT OR IGNORE INTO task_chg_log
                    (taskchgid, taskid, task_stat, work_hours, remark,
                     work_userid, create_date)
                SELECT h.workschhisid,
                       (SELECT w.taskid FROM work_schedule w
                        WHERE w.workschid = h.workschid),
                       CASE h.work_stat WHEN 'C' THEN 'X' WHEN 'D' THEN 'H'
                            ELSE h.work_stat END,
                       h.work_hours, h.remark,
                       (SELECT w.work_userid FROM work_schedule w
                        WHERE w.workschid = h.workschid),
                       h.create_date
                FROM work_schedule_his h
            """))
            db.execute(text("DROP TABLE work_schedule_his"))
        db.execute(text("DROP TABLE work_schedule"))

    # 작업상태 코드 체계 변경: 구 C(취소)->X(작업반려), D(보류)->H(작업중단)
    db.execute(text("UPDATE tasks SET task_stat = 'X' WHERE task_stat = 'C'"))
    db.execute(text("UPDATE tasks SET task_stat = 'H' WHERE task_stat = 'D'"))
    # task_attach_files 의 workschid FK 대상을 work_schedule_log 로 재구성
    cols = {r[1] for r in db.execute(
        text("PRAGMA table_info(task_attach_files)"))}
    if cols:
        fk = db.execute(text(
            "SELECT sql FROM sqlite_master WHERE name='task_attach_files'")
        ).scalar() or ""
        if "work_schedule" in fk and "work_schedule_log" not in fk:
            db.execute(text("""
                CREATE TABLE task_attach_files_new (
                    fileid INTEGER PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    taskid INTEGER REFERENCES tasks(taskid),
                    workschid INTEGER REFERENCES work_schedule_log(workschid),
                    task_filepath TEXT,
                    create_date DATETIME
                )
            """))
            db.execute(text("""
                INSERT INTO task_attach_files_new
                SELECT fileid, file_name, taskid, workschid, task_filepath,
                       create_date FROM task_attach_files
            """))
            db.execute(text("DROP TABLE task_attach_files"))
            db.execute(text(
                "ALTER TABLE task_attach_files_new RENAME TO task_attach_files"))
    db.commit()


@app.on_event("startup")
async def startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        migrate(db)
        seed(db)
    finally:
        db.close()
    _start_auto_transition()


def _start_auto_transition():
    """예정 시작일시가 지난 대기중 작업을 60초 주기로 자동 작업중 전이."""
    import asyncio
    from .statusflow import auto_start_due_tasks

    async def loop():
        while True:
            await asyncio.sleep(60)
            db = SessionLocal()
            try:
                auto_start_due_tasks(db)
            except Exception:
                db.rollback()
            finally:
                db.close()

    asyncio.get_event_loop().create_task(loop())


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
