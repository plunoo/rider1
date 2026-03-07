import bcrypt

MAX_PASSWORD_BYTES = 72


def _to_bytes(password: str) -> bytes:
    if isinstance(password, bytes):
        return password
    return str(password).encode("utf-8")


def password_too_long(password: str) -> bool:
    return len(_to_bytes(password)) > MAX_PASSWORD_BYTES


def hash_password(password: str) -> str:
    raw = _to_bytes(password)
    if len(raw) > MAX_PASSWORD_BYTES:
        raise ValueError("Password must be 72 bytes or fewer.")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(raw, salt).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        raw = _to_bytes(password)
        if len(raw) > MAX_PASSWORD_BYTES:
            return False
        return bcrypt.checkpw(raw, hashed.encode("utf-8"))
    except Exception:
        return False
