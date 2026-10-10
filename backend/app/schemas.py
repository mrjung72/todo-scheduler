from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


# ---------- users ----------
class UserBase(BaseModel):
    user_name: str
    dept_name: Optional[str] = None
    job_title: Optional[str] = None
    user_tel: Optional[str] = None
    user_email: Optional[str] = None
    user_grade: Optional[int] = 9
    user_stat: Optional[str] = "Y"
    reject_remark: Optional[str] = None    # 승인불가 사유
    default_siteid: Optional[str] = None   # 기본사이트ID
    work_hours_day: Optional[float] = None  # 하루 개발시간(시간). None 이면 근무구간 기본값


class UserCreate(UserBase):
    userid: str
    password: Optional[str] = None   # 미입력 시 기본값 '1234'


class UserUpdate(UserBase):
    user_name: Optional[str] = None
    password: Optional[str] = None   # 지정 시에만 변경 (해시는 응답에 노출 안 함)


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    userid: str
    duty_class: Optional[str] = None   # 담당분류코드(D-개발담당/B-업무담당) — 등급에서 자동 산출
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
    priority: Optional[int] = None    # 미지정 시 등록 후 taskid로 자동 부여
    work_hours_estimated: Optional[float] = 4    # 미지정 시 기본 4시간
    work_hours_real: Optional[float] = 0
    task_stat: Optional[str] = "R"
    task_type: Optional[str] = None
    task_csrid: Optional[str] = None
    task_req_remark: Optional[str] = None
    req_userid: Optional[str] = None
    itos_userid: Optional[str] = None
    work_userid: Optional[str] = None   # 작업자(개발자)
    task_start_date: Optional[datetime] = None
    task_end_date: Optional[datetime] = None
    task_end_date_estimated: Optional[datetime] = None
    req_date: Optional[datetime] = None
    holiday_work: Optional[int] = 0       # 휴일작업 여부 (전이/스케줄 제약 없음)


class TaskCreate(TaskBase):
    task_name: str = Field(max_length=100)
    urgent: Optional[bool] = False    # 긴급 체크 시 우선순위 0


class TaskUpdate(BaseModel):
    task_name: Optional[str] = Field(default=None, max_length=100)
    siteid: Optional[str] = None
    priority: Optional[int] = None
    work_hours_estimated: Optional[float] = None
    work_hours_real: Optional[float] = None
    task_stat: Optional[str] = None
    task_type: Optional[str] = None
    task_csrid: Optional[str] = None
    task_req_remark: Optional[str] = None
    req_userid: Optional[str] = None
    itos_userid: Optional[str] = None
    work_userid: Optional[str] = None
    task_start_date: Optional[datetime] = None
    task_end_date: Optional[datetime] = None
    task_end_date_estimated: Optional[datetime] = None
    req_date: Optional[datetime] = None
    holiday_work: Optional[int] = None
    stat_remark: Optional[str] = None   # 작업상태 변경 시 이력 비고


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


# ---------- user_holiday ----------
class UserHolidayBase(BaseModel):
    holiday_category: Optional[str] = "A"   # A-종일, P-일부
    holiday_hours: Optional[int] = 0
    holiday_remark: Optional[str] = None


class UserHolidayCreate(UserHolidayBase):
    dateid: str        # yyyymmdd
    work_userid: str


class UserHolidayUpdate(BaseModel):
    holiday_category: Optional[str] = None
    holiday_hours: Optional[int] = None
    holiday_remark: Optional[str] = None


class UserHolidayOut(UserHolidayBase):
    model_config = ConfigDict(from_attributes=True)
    dateid: str
    work_userid: str
    user_name: Optional[str] = None
    # 하루 근무시간 대비 휴가 구간 비율 [시작, 끝] (A=전체, P=뒤쪽)
    span: Optional[list] = None


# ---------- work_schedule_log (작업이력) ----------
class WorkLogBase(BaseModel):
    taskid: Optional[int] = None
    work_remark: Optional[str] = None
    work_userid: Optional[str] = None


class WorkLogCreate(WorkLogBase):
    pass


class WorkLogUpdate(BaseModel):
    taskid: Optional[int] = None
    work_remark: Optional[str] = None
    work_userid: Optional[str] = None


class WorkLogOut(WorkLogBase):
    model_config = ConfigDict(from_attributes=True)
    workschid: int
    create_date: Optional[datetime] = None
    work_user_name: Optional[str] = None   # 작업자명 (users 조인)


# ---------- task_chg_log (작업상태변경이력) ----------
class TaskChgLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    taskchgid: int
    taskid: Optional[int] = None
    task_stat: Optional[str] = None
    work_hours: Optional[float] = 0
    remark: Optional[str] = None
    work_userid: Optional[str] = None      # 이력 시점의 작업자
    work_user_name: Optional[str] = None   # 조회용 (users 조인)
    create_date: Optional[datetime] = None


class TaskAttachFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    fileid: int
    file_name: str
    taskid: Optional[int] = None
    workschid: Optional[int] = None
    task_filepath: Optional[str] = None
    create_date: Optional[datetime] = None


# ---------- 조회용 확장 ----------
class TaskDetail(TaskOut):
    req_user_name: Optional[str] = None
    req_user_dept: Optional[str] = None
    req_user_title: Optional[str] = None
    itos_user_name: Optional[str] = None
    site_name: Optional[str] = None
    work_user_name: Optional[str] = None
    work_user_dept: Optional[str] = None
    work_user_title: Optional[str] = None
    work_hours_day: Optional[float] = None   # 작업자의 하루 개발시간 (None=기본 근무구간)
    start_fixed: Optional[int] = 0
    weekday_included: Optional[bool] = False   # 휴일작업 기간에 근무일 포함 여부(경고)
