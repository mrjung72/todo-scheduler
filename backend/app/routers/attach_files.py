"""작업관련첨부파일(task_attach_files) 관리.

- 파일 업로드: backend/uploads/<fileid>_<파일명> 에 저장, 경로를 task_filepath 에 기록
- 경로 직접등록: 실제 파일 없이 파일명/경로만 등록 (외부 경로 링크 용도)
- 삭제: DB 행 삭제 + uploads 내 실제 파일이 있으면 함께 삭제
"""
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TaskAttachFile, Task
from ..security import get_current_user, check_owner_or_admin

router = APIRouter(prefix="/api/attach-files", tags=["attach-files"])

UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _list_query(db: Session):
    return (db.query(TaskAttachFile, Task.task_name, Task.work_userid)
            .outerjoin(Task, Task.taskid == TaskAttachFile.taskid)
            .order_by(TaskAttachFile.fileid.desc()))


def _to_out(row):
    f, task_name, work_userid = row
    return {
        "fileid": f.fileid, "file_name": f.file_name, "taskid": f.taskid,
        "workschid": f.workschid, "task_filepath": f.task_filepath,
        "create_date": f.create_date, "task_name": task_name,
        "work_userid": work_userid,
    }


@router.get("")
def list_files(db: Session = Depends(get_db),
               me: object = Depends(get_current_user)):
    return [_to_out(r) for r in _list_query(db).all()]


class AttachMeta(BaseModel):
    file_name: str
    taskid: int | None = None
    workschid: int | None = None
    task_filepath: str | None = None


@router.post("", status_code=201)
def upload_file(file: UploadFile = File(...),
                taskid: int = Form(...),
                workschid: int = Form(None),
                db: Session = Depends(get_db),
                me=Depends(get_current_user)):
    """파일 업로드 -> uploads/ 에 저장하고 첨부파일 레코드 생성."""
    task = db.get(Task, taskid)
    if not task:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    check_owner_or_admin(me, task.work_userid)
    obj = TaskAttachFile(file_name=file.filename, taskid=taskid,
                         workschid=workschid, create_date=datetime.now())
    db.add(obj)
    db.flush()  # fileid 확보 -> 파일명에 붙여 중복 방지
    safe_name = f"{obj.fileid}_{os.path.basename(file.filename or 'file')}"
    path = os.path.join(UPLOAD_DIR, safe_name)
    with open(path, "wb") as out:
        out.write(file.file.read())
    obj.task_filepath = os.path.join("uploads", safe_name)
    db.commit()
    return _to_out((obj, task.task_name, task.work_userid))


@router.post("/meta", status_code=201)
def register_meta(body: AttachMeta, db: Session = Depends(get_db),
                  me=Depends(get_current_user)):
    """파일 없이 파일명/경로만 등록 (외부 경로 참조용)."""
    if body.taskid:
        task = db.get(Task, body.taskid)
        if not task:
            raise HTTPException(404, "작업을 찾을 수 없습니다")
        check_owner_or_admin(me, task.work_userid)
    obj = TaskAttachFile(file_name=body.file_name, taskid=body.taskid,
                         workschid=body.workschid,
                         task_filepath=body.task_filepath,
                         create_date=datetime.now())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _to_out((obj, None, None))


@router.put("/{fileid}")
def update_file(fileid: int, body: AttachMeta, db: Session = Depends(get_db),
                me=Depends(get_current_user)):
    obj = db.get(TaskAttachFile, fileid)
    if not obj:
        raise HTTPException(404, "첨부파일을 찾을 수 없습니다")
    if body.taskid:
        task = db.get(Task, body.taskid)
        if not task:
            raise HTTPException(404, "작업을 찾을 수 없습니다")
        check_owner_or_admin(me, task.work_userid)
    obj.file_name = body.file_name
    obj.taskid = body.taskid
    obj.workschid = body.workschid
    obj.task_filepath = body.task_filepath
    db.commit()
    db.refresh(obj)
    return _to_out((obj, None, None))


@router.get("/{fileid}/download")
def download_file(fileid: int, db: Session = Depends(get_db),
                  me=Depends(get_current_user)):
    obj = db.get(TaskAttachFile, fileid)
    if not obj:
        raise HTTPException(404, "첨부파일을 찾을 수 없습니다")
    if not obj.task_filepath:
        raise HTTPException(404, "저장된 파일이 없습니다 (경로만 등록된 레코드)")
    path = (obj.task_filepath if os.path.isabs(obj.task_filepath)
            else os.path.join(os.path.dirname(UPLOAD_DIR), obj.task_filepath))
    if not os.path.isfile(path):
        raise HTTPException(404, "파일을 찾을 수 없습니다")
    return FileResponse(path, filename=obj.file_name)


@router.delete("/{fileid}", status_code=204)
def delete_file(fileid: int, db: Session = Depends(get_db),
                me=Depends(get_current_user)):
    obj = db.get(TaskAttachFile, fileid)
    if not obj:
        raise HTTPException(404, "첨부파일을 찾을 수 없습니다")
    if obj.taskid:
        task = db.get(Task, obj.taskid)
        if task:
            check_owner_or_admin(me, task.work_userid)
    # uploads/ 아래에 저장된 실제 파일이면 함께 삭제
    if obj.task_filepath:
        path = (obj.task_filepath if os.path.isabs(obj.task_filepath)
                else os.path.join(os.path.dirname(UPLOAD_DIR), obj.task_filepath))
        if path.startswith(UPLOAD_DIR) and os.path.isfile(path):
            os.remove(path)
    db.delete(obj)
    db.commit()
