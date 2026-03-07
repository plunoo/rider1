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

# Require an explicit DATABASE_URL; don't fall back to a test DB in prod.
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    if IS_PRODUCTION:
        raise RuntimeError("DATABASE_URL is not set. Please configure it in the environment.")
    else:
        # Fallback for development
        DATABASE_URL = "sqlite:///./test.db"
        print("⚠️  Using SQLite fallback database for development")

# Clean up the DATABASE_URL if it contains encoded characters
if DATABASE_URL:
    # Handle URL-encoded passwords in PostgreSQL URLs
    import urllib.parse
    if "postgresql://" in DATABASE_URL or "postgres://" in DATABASE_URL:
        # Split the URL to handle encoded passwords properly
        try:
            parsed = urllib.parse.urlparse(DATABASE_URL)
            if parsed.password:
                # Decode the password if it's URL-encoded
                decoded_password = urllib.parse.unquote(parsed.password)
                # Reconstruct the URL with the decoded password
                DATABASE_URL = f"{parsed.scheme}://{parsed.username}:{decoded_password}@{parsed.hostname}:{parsed.port}/{parsed.path.lstrip('/')}"
        except Exception as e:
            print(f"⚠️  Could not parse DATABASE_URL, using as-is: {e}")

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
