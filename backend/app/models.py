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
    user_grade = Column(Integer)          # 0-관리자, 1-개발자, 2-IT업무담당자, 3-현업담당자, 9-기타
    password = Column(Text, nullable=False, default='')   # 비밀번호(pbkdf2 해시)
    user_stat = Column(Text, default="Y")
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
    task_stat = Column(Text, default="W")  # W-대기중, P-작업중, D-작업보류, F-완료, C-취소
    task_csrid = Column(Text)
    task_req_remark = Column(Text)
    req_userid = Column(Text, ForeignKey("users.userid"))
    itos_userid = Column(Text, ForeignKey("users.userid"))
    work_userid = Column(Text, ForeignKey("users.userid"))  # 작업자(개발자)
    task_start_date = Column(DateTime)
    task_end_date = Column(DateTime)
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


class WorkSchedule(Base):
    __tablename__ = "work_schedule"
    workschid = Column(Integer, primary_key=True, autoincrement=True)
    taskid = Column(Integer, ForeignKey("tasks.taskid"))
    work_stat = Column(Text, default="W")     # W-대기중, P-작업중, D-작업보류, F-완료, C-취소
    work_remark = Column(Text)
    work_userid = Column(Text)
    start_datetime = Column(DateTime)
    end_datetime_estimated = Column(DateTime)
    end_datetime_real = Column(DateTime)
    # 시작일시 수동 고정 여부 (1이면 재계산 시에도 start_datetime 유지)
    start_fixed = Column(Integer, default=0)
    create_date = Column(DateTime, default=datetime.now)


class WorkScheduleHis(Base):
    __tablename__ = "work_schedule_his"
    workschhisid = Column(Integer, primary_key=True, autoincrement=True)
    workschid = Column(Integer, ForeignKey("work_schedule.workschid"))
    work_stat = Column(Text)               # W-대기중, P-작업중, D-작업보류, F-완료, C-취소
    work_hours = Column(REAL, default=0)   # 작업기간(시간), 작업중 구간에만 적용
    remark = Column(Text)                  # 비고
    create_date = Column(DateTime, default=datetime.now)


class TaskAttachFile(Base):
    __tablename__ = "task_attach_files"
    fileid = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(Text, nullable=False)
    taskid = Column(Integer, ForeignKey("tasks.taskid"))
    workschid = Column(Integer, ForeignKey("work_schedule.workschid"))
    task_filepath = Column(Text)
    create_date = Column(DateTime, default=datetime.now)
