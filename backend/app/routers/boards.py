"""게시판 — 글/댓글/첨부파일.

- 공개글: 로그인 사용자 전원 조회
- 비공개글: 작성자·스태프(관리자·수석)는 바로 열람, 그 외 사용자는
  게시글 비밀번호(passwd) 입력 시 열람 가능 — 비밀번호 미설정 비공개글은
  작성자·스태프만 열람
- 수정·삭제: 작성자 또는 스태프
- 첨부파일: /api/attach-files 에 boardid 로 업로드 (board_attach_files)
"""
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Board, BoardComment, BoardAttachFile, User
from ..security import get_current_user, hash_password, verify_password
from .attach_files import _file_path, _file_size

router = APIRouter(prefix="/api/boards", tags=["boards"])

STAFF_GRADES = (0, 1)


def _staff(me) -> bool:
    return me.user_grade in STAFF_GRADES


def _can_view(b: Board, me) -> bool:
    """비밀번호 없이 직접 열람 가능 여부 — 공개글, 또는 작성자·스태프."""
    return bool(b.is_public) or b.user_id == me.userid or _staff(me)


def _pw_ok(b: Board, passwd: str | None) -> bool:
    return bool(b.passwd) and verify_password(passwd or "", b.passwd)


def _check_view(b: Board, me, passwd: str | None = None):
    if not _can_view(b, me) and not _pw_ok(b, passwd):
        raise HTTPException(403, "비공개 게시글입니다")


def _get_board(db: Session, boardid: int) -> Board:
    b = db.get(Board, boardid)
    if not b:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    return b


def _can_edit(b: Board, me) -> bool:
    return b.user_id == me.userid or _staff(me)


def _board_out(b: Board, user_name=None, n_comments=None, n_files=None):
    return {
        "boardid": b.boardid, "title": b.title, "content": b.content,
        "is_public": b.is_public, "has_passwd": bool(b.passwd),
        "user_id": b.user_id, "user_name": user_name,
        "create_date": b.create_date, "update_date": b.update_date,
        "comment_count": n_comments, "file_count": n_files,
    }


def _file_out(f: BoardAttachFile):
    return {"fileid": f.fileid, "file_name": f.file_name, "boardid": f.boardid,
            "file_size": _file_size(f.file_filepath),
            "create_date": f.create_date}


def _detail_out(db: Session, b: Board, me):
    u = db.get(User, b.user_id)
    files = (db.query(BoardAttachFile)
             .filter(BoardAttachFile.boardid == b.boardid)
             .order_by(BoardAttachFile.fileid).all())
    comments = (db.query(BoardComment, User.user_name)
                .outerjoin(User, User.userid == BoardComment.user_id)
                .filter(BoardComment.boardid == b.boardid)
                .order_by(BoardComment.commentid).all())
    out = _board_out(b, u.user_name if u else None)
    out["files"] = [_file_out(f) for f in files]
    out["comments"] = [
        {"commentid": c.commentid, "user_id": c.user_id, "user_name": name,
         "content": c.content, "create_date": c.create_date}
        for c, name in comments]
    out["can_edit"] = _can_edit(b, me)
    return out


@router.get("")
def list_boards(q: str | None = None, db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    """게시글 목록 (최신순). 비공개글도 목록에는 🔒 표시로 노출 — 열람은 비밀번호 필요.
    검색 시 비공개글은 제목만 대상 (내용은 열람 권한 필요)."""
    query = (db.query(Board, User.user_name)
             .outerjoin(User, User.userid == Board.user_id))
    if q:
        like = f"%{q}%"
        if _staff(me):
            query = query.filter(Board.title.like(like) | Board.content.like(like))
        else:
            query = query.filter(
                Board.title.like(like) |
                (Board.content.like(like) & (Board.is_public == 1)))
    rows = query.order_by(Board.boardid.desc()).all()
    cc = dict(db.query(BoardComment.boardid, func.count())
              .group_by(BoardComment.boardid).all())
    fc = dict(db.query(BoardAttachFile.boardid, func.count())
              .group_by(BoardAttachFile.boardid).all())
    return [_board_out(b, name, cc.get(b.boardid, 0), fc.get(b.boardid, 0))
            for b, name in rows]


@router.get("/{boardid}")
def board_detail(boardid: int, db: Session = Depends(get_db),
                 me: User = Depends(get_current_user)):
    b = _get_board(db, boardid)
    if not _can_view(b, me):
        # 비밀번호가 설정된 비공개글은 need_password 신호로 프롬프트 유도
        raise HTTPException(403, "need_password" if b.passwd else "비공개 게시글입니다")
    return _detail_out(db, b, me)


class BoardOpen(BaseModel):
    password: str | None = None


@router.post("/{boardid}/open")
def open_board(boardid: int, body: BoardOpen,
               db: Session = Depends(get_db),
               me: User = Depends(get_current_user)):
    """비공개글을 비밀번호로 열람."""
    b = _get_board(db, boardid)
    _check_view(b, me, body.password)
    return _detail_out(db, b, me)


class BoardCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str | None = None
    is_public: int = 1
    passwd: str | None = None          # 비공개 시 열람 비밀번호


class BoardUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = None
    is_public: int | None = None
    passwd: str | None = None          # 빈 문자열=해제, None=유지, 값=변경


@router.post("", status_code=201)
def create_board(body: BoardCreate, db: Session = Depends(get_db),
                 me: User = Depends(get_current_user)):
    b = Board(title=body.title, content=body.content,
              is_public=1 if body.is_public else 0, user_id=me.userid)
    if not b.is_public and body.passwd:
        b.passwd = hash_password(body.passwd)
    db.add(b)
    db.commit()
    db.refresh(b)
    return _board_out(b, me.user_name, 0, 0)


@router.put("/{boardid}")
def update_board(boardid: int, body: BoardUpdate,
                 db: Session = Depends(get_db),
                 me: User = Depends(get_current_user)):
    b = _get_board(db, boardid)
    if not _can_edit(b, me):
        raise HTTPException(403, "작성자만 수정할 수 있습니다")
    if body.title is not None:
        b.title = body.title
    if body.content is not None:
        b.content = body.content
    if body.is_public is not None:
        b.is_public = 1 if body.is_public else 0
        if b.is_public:
            b.passwd = None            # 공개로 전환 시 비밀번호 해제
    if not b.is_public and body.passwd is not None:
        b.passwd = hash_password(body.passwd) if body.passwd else None
    b.update_date = datetime.now()
    db.commit()
    return _board_out(b, me.user_name)


@router.delete("/{boardid}", status_code=204)
def delete_board(boardid: int, db: Session = Depends(get_db),
                 me: User = Depends(get_current_user)):
    b = _get_board(db, boardid)
    if not _can_edit(b, me):
        raise HTTPException(403, "작성자만 삭제할 수 있습니다")
    # 첨부파일 레코드 + 실제 파일 정리
    files = db.query(BoardAttachFile).filter(
        BoardAttachFile.boardid == boardid).all()
    for f in files:
        db.delete(f)
        if f.file_filepath:
            p = _file_path(f.file_filepath)
            if os.path.isfile(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
    db.query(BoardComment).filter(BoardComment.boardid == boardid).delete()
    db.flush()
    db.delete(b)
    db.commit()


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    passwd: str | None = None          # 비공개글 비밀번호 열람 중인 경우


@router.post("/{boardid}/comments", status_code=201)
def add_comment(boardid: int, body: CommentIn,
                db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    b = _get_board(db, boardid)
    _check_view(b, me, body.passwd)   # 비공개글은 비밀번호 열람자도 댓글 가능
    c = BoardComment(boardid=boardid, user_id=me.userid, content=body.content)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"commentid": c.commentid, "user_id": c.user_id,
            "user_name": me.user_name, "content": c.content,
            "create_date": c.create_date}


@router.delete("/{boardid}/comments/{commentid}", status_code=204)
def del_comment(boardid: int, commentid: int,
                db: Session = Depends(get_db),
                me: User = Depends(get_current_user)):
    _get_board(db, boardid)
    c = db.get(BoardComment, commentid)
    if not c or c.boardid != boardid:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    if c.user_id != me.userid and not _staff(me):
        raise HTTPException(403, "본인 댓글만 삭제할 수 있습니다")
    db.delete(c)
    db.commit()
