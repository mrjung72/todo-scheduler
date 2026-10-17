"""오프라인 라이선스 키 검증 (Ed25519 비대칭 서명).

키 형식: TDL-<base64url(JSON 페이로드)>.<base64url(Ed25519 서명)>
페이로드: {"name": 발급대상, "exp": "YYYY-MM-DD"(선택, 없으면 무기한),
           "type": "free"|"ent", "seats": 사용자수 상한(선택)}

- 이 모듈에는 검증용 **공개키**만 들어있습니다.
- 서명용 **개인키**(license_private.pem)는 발급자만 보관하며,
  배포물에 포함되지 않습니다. 앱을 디컴파일해도 키를 위조할 수 없습니다.

키 파일: 개발판은 backend/license.key, 배포판은 app/license.key (한 줄)
발급   : 별도 프로젝트 todo-license 의 make_license.py 에서 발급
         (개인키는 발급자 프로젝트에만 존재 — 이 앱에는 포함되지 않음)
키쌍 재생성: todo-license 에서 --genkey 후 새 공개키를 PUBLIC_KEY_B64에 교체

주의: 검증 코드 자체를 패치하는 우회는 남아 있으므로,
배포 시 실행 파일 빌드(PyInstaller 등)와 함께 쓰는 것을 권장합니다.
"""
import base64
import json
import os
from datetime import date

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

# 검증용 공개키 — 발급 프로젝트(todo-license)의 개인키와 짝이 맞아야 함
PUBLIC_KEY_B64 = "HkfFmGNgSoA8KMgHtGl2zgoeafyW9MAlqia-QfhxqtA="

# 라이선스 정책
# - 키는 배포판에 항상 포함 — 없으면 누락/변조로 보고 조회 전용 차단
# - 개인/기업 무료는 free 키로 배포 — 활성 사용자 FREE_SEATS명까지
#   (admin 계정은 사용자 수 집계에서 제외), 유효기간 최대 FREE_MAX_DAYS일
#   (갱신 키 발급으로 계속 사용 가능)
# - 기업용(ent)은 연 구독: 키에 seats(사용자 수 상한) + exp(만료일) 포함
# - free 키에 seats 미지정 시 FREE_SEATS 적용(지정해도 FREE_SEATS 상한),
#   ent 키 미지정 시 무제한
FREE_SEATS = 5
FREE_MAX_DAYS = 366   # 무료 키 최대 유효기간 1년

_PUB = Ed25519PublicKey.from_public_bytes(
    base64.urlsafe_b64decode(PUBLIC_KEY_B64))

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_APP_DIR)
# 개발판은 backend/license.key, 배포판은 app/license.key 에 둘 수 있음
KEY_FILES = [os.path.join(_BACKEND_DIR, "license.key"),
             os.path.join(_APP_DIR, "license.key")]


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s)


def parse_key(key: str) -> dict:
    """키 검증 + 페이로드 반환. 실패 시 ValueError."""
    key = key.strip()
    if not key.startswith("TDL-"):
        raise ValueError("키 형식이 올바르지 않습니다 (TDL- 로 시작해야 합니다)")
    payload, sep, sig = key[4:].rpartition(".")
    if not sep or not payload or not sig:
        raise ValueError("키 형식이 올바르지 않습니다")
    try:
        _PUB.verify(_b64d(sig), payload.encode())
    except (InvalidSignature, ValueError):
        raise ValueError("키 서명이 올바르지 않습니다")
    try:
        data = json.loads(_b64d(payload))
    except Exception:
        raise ValueError("키 내용을 읽을 수 없습니다")
    if not isinstance(data, dict):
        raise ValueError("키 내용이 올바르지 않습니다")
    return data


def status() -> dict:
    """현재 라이선스 상태. 매 호출마다 파일을 다시 읽어 재기동 없이 갱신됨.

    키는 배포판에 항상 포함 — 없음/만료/변조 → 읽기 전용."""
    key = ""
    for path in KEY_FILES:
        try:
            key = open(path, encoding="utf-8").read().strip()
        except OSError:
            continue
        if key:
            break
    if not key:
        return {"installed": False, "valid": False, "expired": True,
                "free_tier": False, "seats": 0,
                "name": "", "type": "", "expires": None,
                "days_left": None,
                "msg": "라이선스 키가 없습니다"}
    try:
        data = parse_key(key)
    except ValueError as e:
        return {"installed": True, "valid": False, "expired": True,
                "free_tier": False, "seats": 0,
                "msg": f"라이선스 키 오류: {e}"}
    # 만료일은 선택 — 없으면 무기한 (개인 무료 키)
    days = None
    expired = False
    if data.get("exp"):
        try:
            days = (date.fromisoformat(data["exp"]) - date.today()).days
            expired = days < 0
        except (TypeError, ValueError):
            return {"installed": True, "valid": False, "expired": True,
                    "free_tier": False, "seats": 0,
                    "msg": "라이선스 만료일 형식이 올바르지 않습니다"}
    ltype = data.get("type", "free")
    seats = data.get("seats")
    if ltype == "free":
        # 무료 키: 만료일 필수 + 최대 1년, 사용자 수는 5명 상한
        if not data.get("exp"):
            return {"installed": True, "valid": False, "expired": True,
                    "free_tier": False, "seats": 0,
                    "msg": "무료 라이선스는 만료일이 필요합니다"}
        if days is not None and days > FREE_MAX_DAYS:
            return {"installed": True, "valid": False, "expired": True,
                    "free_tier": False, "seats": 0,
                    "msg": "무료 라이선스는 최대 1년까지만 유효합니다"}
        if not isinstance(seats, int) or seats <= 0 or seats > FREE_SEATS:
            seats = FREE_SEATS
    elif not isinstance(seats, int) or seats <= 0:
        seats = None   # ent: 미지정 시 무제한
    return {"installed": True, "valid": not expired, "expired": expired,
            "free_tier": ltype == "free", "seats": seats,
            "name": data.get("name", ""), "type": ltype,
            "expires": data.get("exp"), "days_left": days,
            "msg": "라이선스가 만료되었습니다" if expired else ""}
