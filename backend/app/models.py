from datetime import datetime
from sqlalchemy import Column, Integer, REAL, Text, DateTime, ForeignKey
from .database import Base


class User(Base):
    __tablename__ = "users"
    userid = Column(Text, primary_key=True)
    user_name = Column(Text, nullable=False)
    dept_name = Column(Text)
    job_title = Column(Text)
    user_tel = Column(Text)
    user_email = Column(Text)
    user_grade = Column(Integer)          # 0-관리자, 1-수석개발자, 2-일반개발자, 5-IT업무담당자, 7-현업담당자, 9-기타사용자
    password = Column(Text, nullable=False, default='')   # 비밀번호(pbkdf2 해시)
    user_stat = Column(Text, default="Y")
    reject_remark = Column(Text)          # 승인불가 사유 (user_stat='R')
    default_siteid = Column(Text, ForeignKey("sites.siteid"))   # 기본사이트ID
    create_date = Column(DateTime, default=datetime.now)


class Site(Base):
    __tablename__ = "sites"
    siteid = Column(Text, primary_key=True)
    site_name = Column(Text, nullable=False)
    site_stat = Column(Text, default="Y")
    site_remark = Column(Text)
    itos_userid = Column(Text)
    create_date = Column(DateTime, default=datetime.now)


class Task(Base):
    __tablename__ = "tasks"
    taskid = Column(Integer, primary_key=True, autoincrement=True)
    task_name = Column(Text, nullable=False)
    siteid = Column(Text, ForeignKey("sites.siteid"))
    priority = Column(Integer, default=0)
    work_hours_estimated = Column(REAL, default=0)
    work_hours_real = Column(REAL, default=0)
    # R-작업요청, C-검토중, W-대기중, P-작업중, H-작업중단, F-작업완료, X-작업반려
    task_stat = Column(Text, default="R")
    # SQ-단순문의, FI-기능개선, BF-오류수정, DE-데이터추출, DM-데이터변경
    task_type = Column(Text)
    task_csrid = Column(Text)
    task_req_remark = Column(Text)
    req_userid = Column(Text, ForeignKey("users.userid"))
    itos_userid = Column(Text, ForeignKey("users.userid"))
    work_userid = Column(Text, ForeignKey("users.userid"))  # 작업자(개발자)
    task_start_date = Column(DateTime)          # 작업시작일자 (자동계산 또는 수동설정)
    task_end_date = Column(DateTime)            # 작업완료일자 (실제)
    task_end_date_estimated = Column(DateTime)  # 작업 예상 종료 일시 (자동계산)
    start_fixed = Column(Integer, default=0)    # 시작일시 수동 고정 여부
    holiday_work = Column(Integer, default=0)   # 휴일작업 여부 (상태전이·스케줄 제약 없음)
    req_date = Column(DateTime)                 # 요청일자
    create_date = Column(DateTime, default=datetime.now)


class CalendarDefine(Base):
    __tablename__ = "calendar_define"
    dateid = Column(Text, primary_key=True)   # yyyymmdd
    date_name = Column(Text, nullable=False)  # yyyy-mm-dd
    date_stat = Column(Text, default="W")     # W-근무일, H-휴일
    holiday_remark = Column(Text)


class UserHoliday(Base):
    __tablename__ = "user_holiday"
    dateid = Column(Text, ForeignKey("calendar_define.dateid"), primary_key=True)
    work_userid = Column(Text, ForeignKey("users.userid"), primary_key=True)
    holiday_category = Column(Text, default="A")   # A-종일, P-일부
    holiday_hours = Column(Integer, default=0)     # P 일 때 휴가시간(시)
    holiday_remark = Column(Text)


class WorkScheduleLog(Base):
    """작업자 작업이력 (수동 기록). 작업의 일정/상태는 tasks 에서 관리."""
    __tablename__ = "work_schedule_log"
    workschid = Column(Integer, primary_key=True, autoincrement=True)
    taskid = Column(Integer, ForeignKey("tasks.taskid"))
    work_remark = Column(Text)             # 작업내용
    work_userid = Column(Text)             # 작업자ID
    create_date = Column(DateTime, default=datetime.now)


class TaskChgLog(Base):
    """작업 상태변경이력. work_hours 는 작업중(P) 구간이 끝날 때 해당 P 행에 기록."""
    __tablename__ = "task_chg_log"
    taskchgid = Column(Integer, primary_key=True, autoincrement=True)
    taskid = Column(Integer, ForeignKey("tasks.taskid"))
    task_stat = Column(Text)               # 변경된 작업상태
    work_hours = Column(REAL, default=0)   # 작업기간(시간), 작업중 구간에만 적용
    remark = Column(Text)                  # 비고
    work_userid = Column(Text)             # 상태를 변경한 사용자ID
    create_date = Column(DateTime, default=datetime.now)


class TaskAttachFile(Base):
    __tablename__ = "task_attach_files"
    fileid = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(Text, nullable=False)
    taskid = Column(Integer, ForeignKey("tasks.taskid"))
    workschid = Column(Integer, ForeignKey("work_schedule_log.workschid"))
    task_filepath = Column(Text)
    create_date = Column(DateTime, default=datetime.now)
