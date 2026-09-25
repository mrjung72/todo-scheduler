from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


# ---------- users ----------
class UserBase(BaseModel):
    user_name: str
    dept_name: Optional[str] = None
    job_title: Optional[str] = None
    user_tel: Optional[str] = None
    user_email: Optional[str] = None
    user_grade: Optional[int] = 3
    user_stat: Optional[str] = "Y"


class UserCreate(UserBase):
    userid: str


class UserUpdate(UserBase):
    user_name: Optional[str] = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    userid: str
    create_date: Optional[datetime] = None


# ---------- sites ----------
class SiteBase(BaseModel):
    site_name: str
    site_stat: Optional[str] = "Y"
    site_remark: Optional[str] = None
    itos_userid: Optional[str] = None


class SiteCreate(SiteBase):
    siteid: str


class SiteUpdate(BaseModel):
    site_name: Optional[str] = None
    site_stat: Optional[str] = None
    site_remark: Optional[str] = None
    itos_userid: Optional[str] = None


class SiteOut(SiteBase):
    model_config = ConfigDict(from_attributes=True)
    siteid: str
    create_date: Optional[datetime] = None


# ---------- tasks ----------
class TaskBase(BaseModel):
    task_name: str
    siteid: Optional[str] = None
    priority: Optional[int] = 0
    work_hours_estimated: Optional[float] = 0
    work_hours_real: Optional[float] = 0
    task_stat: Optional[str] = "W"
    task_csrid: Optional[str] = None
    task_req_remark: Optional[str] = None
    task_req_filepath: Optional[str] = None
    req_userid: Optional[str] = None
    itos_userid: Optional[str] = None
    task_start_date: Optional[datetime] = None
    task_end_date: Optional[datetime] = None


class TaskCreate(TaskBase):
    work_userid: Optional[str] = None  # work_schedule 생성 시 사용


class TaskUpdate(BaseModel):
    task_name: Optional[str] = None
    siteid: Optional[str] = None
    priority: Optional[int] = None
    work_hours_estimated: Optional[float] = None
    work_hours_real: Optional[float] = None
    task_stat: Optional[str] = None
    task_csrid: Optional[str] = None
    task_req_remark: Optional[str] = None
    task_req_filepath: Optional[str] = None
    req_userid: Optional[str] = None
    itos_userid: Optional[str] = None
    task_start_date: Optional[datetime] = None
    task_end_date: Optional[datetime] = None


class TaskOut(TaskBase):
    model_config = ConfigDict(from_attributes=True)
    taskid: int
    create_date: Optional[datetime] = None


# ---------- calendar_define ----------
class CalendarBase(BaseModel):
    date_name: str
    date_stat: Optional[str] = "W"
    holiday_remark: Optional[str] = None


class CalendarCreate(CalendarBase):
    dateid: str  # yyyymmdd


class CalendarUpdate(BaseModel):
    date_stat: Optional[str] = None
    holiday_remark: Optional[str] = None


class CalendarOut(CalendarBase):
    model_config = ConfigDict(from_attributes=True)
    dateid: str


# ---------- work_schedule ----------
class ScheduleBase(BaseModel):
    taskid: Optional[int] = None
    work_stat: Optional[str] = "W"
    work_remark: Optional[str] = None
    work_filepath: Optional[str] = None
    work_userid: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime_estimated: Optional[datetime] = None
    end_datetime_real: Optional[datetime] = None
    start_fixed: Optional[int] = 0


class ScheduleCreate(ScheduleBase):
    pass


class ScheduleUpdate(BaseModel):
    taskid: Optional[int] = None
    work_stat: Optional[str] = None
    work_remark: Optional[str] = None
    work_filepath: Optional[str] = None
    work_userid: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime_estimated: Optional[datetime] = None
    end_datetime_real: Optional[datetime] = None
    start_fixed: Optional[int] = None


class ScheduleOut(ScheduleBase):
    model_config = ConfigDict(from_attributes=True)
    workschid: int
    create_date: Optional[datetime] = None


# ---------- 조회용 확장 ----------
class TaskDetail(TaskOut):
    req_user_name: Optional[str] = None
    itos_user_name: Optional[str] = None
    site_name: Optional[str] = None
    workschid: Optional[int] = None
    work_userid: Optional[str] = None
    work_user_name: Optional[str] = None
    work_stat: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime_estimated: Optional[datetime] = None
    end_datetime_real: Optional[datetime] = None
    start_fixed: Optional[int] = 0
