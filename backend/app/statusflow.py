"""작업상태 전이 규칙 + 상태변경이력(work_schedule_his) 기록.

허용 전이:
  W(대기중) -> P(작업중), C(취소)     -- 시작일시가 현재시각 이전일 때만 P 가능
  C(취소)   -> W(대기중)
  P(작업중) -> D(작업보류), F(완료)   -- ->F 시 실제완료일시에 현재시각 적용
  D(보류)   -> P(작업중), C(취소)
  F(완료)   -> 변경 불가

공통 규칙:
  - ->P(W->P): 현재시각을 작업시작일시로 적용
  - ->F: 실제작업완료일시 = 현재시각, 실제작업시간 계산
  - 완료(F) 외 상태로 변경 시 실제작업종료일시는 NULL
  - 모든 상태 변경을 work_schedule_his 에 기록.
    work_hours 는 작업중(P) 구간이 끝날 때 해당 P 이력행에 기간을 기록한다.
"""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import WorkSchedule, WorkScheduleHis, Task
from .scheduler import (
    get_calendar_map, get_holiday_map, workday_cal, work_hours_between,
)

ALLOWED_STAT = {
    "W": {"P", "C"},
    "C": {"W"},
    "P": {"D", "F"},
    "D": {"P", "C"},
    "F": set(),
}
STAT_NAME = {"W": "대기중", "P": "작업중", "D": "작업보류",
             "F": "완료", "C": "취소"}


def _check(prev: str, new_stat: str):
    if new_stat not in ALLOWED_STAT.get(prev, set()):
        raise HTTPException(
            400,
            f"{STAT_NAME.get(prev, prev)} 상태에서는 "
            f"{STAT_NAME.get(new_stat, new_stat)} 상태로 변경할 수 없습니다",
        )


def apply_stat_change(db: Session, sched: WorkSchedule, task: Task,
                      new_stat: str, remark: str = None):
    """스케줄 work_stat 전이 규칙 적용 + 이력 기록 + tasks 테이블 동기화."""
    prev = sched.work_stat or "W"
    if prev == new_stat:
        return
    _check(prev, new_stat)
    now = datetime.now().replace(microsecond=0)

    if new_stat == "P":
        # 작업시작일시가 미래이면 작업중으로 변경 불가
        if sched.start_datetime and sched.start_datetime > now:
            raise HTTPException(
                400, "작업시작일시 이후에만 작업중으로 변경할 수 있습니다")
        # 대기중->작업중: 현재시각을 실제 시작일시로 적용.
        # 보류->작업중: 최초 실제 시작일시 유지 (구간별 기간은 이력에 기록)
        if prev == "W" or not sched.start_datetime:
            sched.start_datetime = now
    if new_stat == "F":
        if not sched.start_datetime:
            sched.start_datetime = now
        sched.end_datetime_real = now   # 실제작업완료일시 = 현재시각
    else:
        sched.end_datetime_real = None  # 완료 외 상태는 실제종료 해제
    sched.work_stat = new_stat

    # 작업중 구간이 끝나면 해당 P 이력행에 작업기간 기록
    if prev == "P":
        last_p = (db.query(WorkScheduleHis)
                  .filter(WorkScheduleHis.workschid == sched.workschid,
                          WorkScheduleHis.work_stat == "P")
                  .order_by(WorkScheduleHis.workschhisid.desc()).first())
        if last_p:
            stint_start = last_p.create_date or sched.start_datetime or now
            cal = workday_cal(get_calendar_map(db), stint_start.date())
            last_p.work_hours = work_hours_between(
                stint_start, now, cal, get_holiday_map(db),
                sched.work_userid or "")
    db.add(WorkScheduleHis(workschid=sched.workschid, work_stat=new_stat,
                           work_hours=0, remark=remark, create_date=now))

    # 작업 테이블 동기화
    if task:
        task.task_stat = new_stat
        if new_stat == "P":
            task.task_start_date = sched.start_datetime
            task.task_end_date = sched.end_datetime_estimated
        elif new_stat == "F":
            task.task_start_date = sched.start_datetime
            task.task_end_date = sched.end_datetime_real
            if sched.start_datetime:
                cal = workday_cal(get_calendar_map(db),
                                  sched.start_datetime.date())
                task.work_hours_real = work_hours_between(
                    sched.start_datetime, sched.end_datetime_real, cal,
                    get_holiday_map(db), sched.work_userid or "")
        else:
            task.task_end_date = None


def apply_task_stat_change(db: Session, task: Task, new_stat: str,
                           remark: str = None):
    """작업 task_stat 전이 규칙 적용 -> 연결된 모든 스케줄에 동일 적용."""
    prev = task.task_stat or "W"
    if prev == new_stat:
        return
    _check(prev, new_stat)
    scheds = (db.query(WorkSchedule)
              .filter(WorkSchedule.taskid == task.taskid)
              .order_by(WorkSchedule.workschid).all())
    if not scheds:
        # 스케줄 없는 작업: 규칙 검증 후 작업 상태만 반영
        now = datetime.now().replace(microsecond=0)
        task.task_stat = new_stat
        if new_stat == "P":
            task.task_start_date = task.task_start_date or now
        elif new_stat == "F":
            task.task_start_date = task.task_start_date or now
            task.task_end_date = now
        else:
            task.task_end_date = None
        return
    for sched in scheds:
        apply_stat_change(db, sched, task, new_stat, remark)
