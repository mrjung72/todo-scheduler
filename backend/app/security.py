"""비밀번호 해시 (stdlib PBKDF2). 저장 형식: pbkdf2$iterations$salt_hex$hash_hex"""
import hashlib
import hmac
import os

_ITER = 100_000


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
