"""비밀번호 해시 (stdlib PBKDF2) + 로그인 토큰(HMAC 서명, 만료 포함).

저장 형식: pbkdf2$iterations$salt_hex$hash_hex
토큰 형식: base64url(userid|expiry_epoch|hmac_hex)
"""
import base64
import hashlib
import hmac
import os
import time

_ITER = 100_000
_TOKEN_TTL = 60 * 60 * 12          # 12시간
_SECRET = os.getenv("SECRET_KEY", "todo-scheduler-secret")


def hash_password(plain: str) -> str:
    salt = os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac("sha256", (plain or "").encode(), bytes.fromhex(salt), _ITER)
    return f"pbkdf2${_ITER}${salt}${dk.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        _, iters, salt, expected = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", (plain or "").encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), expected)
    except (ValueError, AttributeError):
        return False


def make_token(userid: str) -> str:
    exp = int(time.time()) + _TOKEN_TTL
    payload = f"{userid}|{exp}"
    sig = hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode()


def parse_token(token: str):
    """유효하면 userid, 아니면 None."""
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        userid, exp, sig = raw.rsplit("|", 2)
        payload = f"{userid}|{exp}"
        expect = hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expect) or int(exp) < time.time():
            return None
        return userid
    except Exception:
        return None
