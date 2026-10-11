"""작업상태 전이 규칙 + 상태변경이력(task_chg_log) 기록.

상태 체계:
  R-작업요청, C-검토중, W-대기중, P-작업중, H-작업중단, F-작업완료,
  X-작업반려, Z-최종완료

허용 전이:
  R(작업요청) -> C(검토중), X(작업반려)
  C(검토중)   -> X(작업반려), W(대기중)
  W(대기중)   -> C(검토중), X(작업반려), P(작업중)
  P(작업중)   -> X(작업반려), H(작업중단), F(작업완료)
                -- P에서 벗어날 때 해당 구간의 작업기간을 task_chg_log.work_hours에
                   기록하고 tasks.work_hours_real에 누적
  H(작업중단) -> P(작업중), X(작업반려)
  F(작업완료) -> Z(최종완료)
  X(작업반려) -> 변경 불가 (종결)
  Z(최종완료) -> 변경 불가 (종결, 되돌리기도 불가 — 휴일작업 포함 모든 경로 차단)

공통 규칙:
  - ->P: 시작일자가 없거나 미래이면 불가(W->P). 최초 P 진입 시 task_start_date = 현재시각
         (H->P 재개 시에는 최초 시작일 유지, 구간별 기간은 이력에 기록)
  - ->F: task_end_date(실제완료일시) = 현재시각
  - ->Z: task_end_date 유지 (F에서 기록된 실제완료일시 그대로)
  - 완료(F)·최종완료(Z) 외 상태로 변경 시 task_end_date = NULL
  - 모든 상태 변경을 task_chg_log 에 기록.
"""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import TaskChgLog, Task
from .scheduler import (
    get_calendar_map, get_holiday_map, get_user_hours_map, workday_cal,
    work_hours_between,
)

ALLOWED_STAT = {
    "R": {"C", "X"},
    "C": {"X", "W"},
    "W": {"C", "X", "P"},
    "P": {"X", "H", "F"},
    "H": {"P", "X"},
    "F": {"Z"},
    "X": set(),
    "Z": set(),
}
STAT_NAME = {"R": "작업요청", "C": "검토중", "W": "대기중", "P": "작업중",
             "H": "작업중단", "F": "작업완료", "X": "작업반려", "Z": "최종완료"}


def _check(prev: str, new_stat: str):
    if new_stat not in ALLOWED_STAT.get(prev, set()):
        raise HTTPException(
            400,
            f"{STAT_NAME.get(prev, prev)} 상태에서는 "
            f"{STAT_NAME.get(new_stat, new_stat)} 상태로 변경할 수 없습니다",
        )


def apply_task_stat_change(db: Session, task: Task, new_stat: str,
                           remark: str = None, actor_userid: str = None,
                           allow_revert: bool = False):
    """작업 task_stat 전이 규칙 적용 + task_chg_log 이력 기록.
    work_userid = 상태를 실제로 변경한 사용자(actor), 미지정 시 작업자.
    allow_revert: 종결 상태(F/X)에서 직전 상태로 되돌리는 전이 허용."""
    prev = task.task_stat or "R"
    if prev == new_stat:
        return
    # 최종완료는 절대 종결 — 휴일작업·되돌리기 예외 없이 전이 불가.
    # 최종완료 진입도 작업완료(F)에서만 허용 (휴일작업도 동일)
    if prev == "Z" or (new_stat == "Z" and prev != "F"):
        raise HTTPException(
            400, "최종완료는 작업완료 상태에서만 변경 가능하며, "
                 "최종완료된 작업은 상태를 변경할 수 없습니다")
    # 휴일작업은 상태 전이 제약 없이 자유롭게 변경 가능
    if not task.holiday_work and not allow_revert:
        _check(prev, new_stat)
    now = datetime.now().replace(microsecond=0)

    if new_stat == "P":
        # 대기중->작업중: 스케줄된 작업시작일시가 없거나 미래이면 변경 불가
        # (휴일작업·되돌리기는 제약 없음)
        if not task.holiday_work and not allow_revert and prev == "W":
            if not task.task_start_date:
                raise HTTPException(
                    400, "작업시작일시가 스케줄링되지 않은 작업은 "
                         "작업중으로 변경할 수 없습니다")
            if task.task_start_date > now:
                raise HTTPException(
                    400, "작업시작일시 이후에 자동으로 작업중 상태로 변경됩니다.")
        # 최초 작업중 진입: 실제 시작일시 = 현재시각.
        # 중단->작업중 재개: 최초 시작일시 유지 (구간별 기간은 이력에 기록)
        if not task.task_start_date or prev == "W":
            task.task_start_date = now
    if new_stat == "F":
        if not task.task_start_date:
            task.task_start_date = now
        task.task_end_date = now      # 실제작업완료일시 = 현재시각
    elif new_stat != "Z":
        task.task_end_date = None     # 완료·최종완료 외 상태는 실제종료 해제
    task.task_stat = new_stat

    # 작업중 구간이 끝나면 해당 P 이력행에 작업기간 기록 + 실제작업시간 누적
    if prev == "P":
        last_p = (db.query(TaskChgLog)
                  .filter(TaskChgLog.taskid == task.taskid,
                          TaskChgLog.task_stat == "P")
                  .order_by(TaskChgLog.taskchgid.desc()).first())
        if last_p:
            stint_start = last_p.create_date or task.task_start_date or now
            cal = workday_cal(get_calendar_map(db), stint_start.date())
            hours = work_hours_between(
                stint_start, now, cal, get_holiday_map(db),
                task.work_userid or "", get_user_hours_map(db))
            last_p.work_hours = hours
            task.work_hours_real = round(
                (task.work_hours_real or 0) + hours, 2)
    db.add(TaskChgLog(taskid=task.taskid, task_stat=new_stat,
                      work_hours=0, remark=remark,
                      work_userid=actor_userid or task.work_userid,
                      create_date=now))


def auto_start_due_tasks(db: Session) -> int:
    """예정 시작일시가 지난 대기중(W) 작업을 작업중(P)으로 자동 전이.
    전이된 작업 수를 반환한다."""
    now = datetime.now().replace(microsecond=0)
    due = (db.query(Task)
           .filter(Task.task_stat == "W",
                   Task.task_start_date.isnot(None),
                   Task.task_start_date <= now)
           .all())
    for task in due:
        apply_task_stat_change(db, task, "P",
                               remark="예정시작 경과로 자동 시작")
    if due:
        db.commit()
    return len(due)
