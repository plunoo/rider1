import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent

# Load the .env that lives next to this file so it works regardless of where
# uvicorn is started from.
load_dotenv(BASE_DIR / ".env")

# Environment flags
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT in {"production", "prod"}

# Simple DATABASE_URL handling
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    if IS_PRODUCTION:
        raise RuntimeError("DATABASE_URL is not set. Please configure it in the environment.")
    else:
        # Fallback for development
        DATABASE_URL = "sqlite:///./test.db"

JWT_SECRET = os.getenv("JWT_SECRET")
if IS_PRODUCTION and (not JWT_SECRET or JWT_SECRET == "CHANGE_ME"):
    raise RuntimeError("JWT_SECRET must be set to a secure value in production.")
if not JWT_SECRET:
    JWT_SECRET = "CHANGE_ME"
JWT_ALGORITHM = "HS256"

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com").strip() or "mailto:admin@example.com"
PUSH_ENABLED = bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)

def _parse_csv_env(name: str) -> list[str]:
    raw = os.getenv(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]

def _get_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default

ACCESS_TOKEN_EXPIRE_MINUTES = _get_int_env("ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24)

CORS_ORIGINS = _parse_csv_env("CORS_ORIGINS")
ALLOWED_HOSTS = _parse_csv_env("ALLOWED_HOSTS")

LOCATION_RETENTION_DAYS = _get_int_env("LOCATION_RETENTION_DAYS", 30)
ATTENDANCE_RESET_HOURS = _get_int_env("ATTENDANCE_RESET_HOURS", 12)
ATTENDANCE_EDIT_GRACE_MINUTES = _get_int_env("ATTENDANCE_EDIT_GRACE_MINUTES", 30)
MAX_LOCATION_ACCURACY_M = _get_int_env("MAX_LOCATION_ACCURACY_M", 150)
MAX_LOCATION_SPEED_MPS = _get_int_env("MAX_LOCATION_SPEED_MPS", 50)
LOCATION_STALE_MINUTES = _get_int_env("LOCATION_STALE_MINUTES", 15)
BREAKS_PER_DAY = _get_int_env("BREAKS_PER_DAY", 2)
AUTO_DELIVERY_DISTANCE_M = _get_int_env("AUTO_DELIVERY_DISTANCE_M", 500)
MAX_MESSAGE_IMAGE_MB = _get_int_env("MAX_MESSAGE_IMAGE_MB", 5)