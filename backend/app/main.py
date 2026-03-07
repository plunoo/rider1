from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import inspect, text
from database import Base, engine
import models
from utils import push  # noqa: F401
from config import CORS_ORIGINS, ALLOWED_HOSTS, IS_PRODUCTION
from auth.router import router as auth_router
from routers import admin, riders, attendance, shifts, tracking, notifications, geo, deliveries, captain, messages, earnings, push

app = FastAPI(title="Rider Management API")

# Ensure tables exist for simple SQLite setups.
models  # noqa: F401
Base.metadata.create_all(bind=engine)

def _ensure_store_pricing_column() -> None:
    try:
        inspector = inspect(engine)
        if "stores" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("stores")}
        if "default_base_pay_cents" in columns:
            return
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE stores ADD COLUMN default_base_pay_cents INTEGER DEFAULT 0"))
    except Exception:
        # Best-effort migration for local SQLite.
        return

_ensure_store_pricing_column()

def _ensure_store_limit_column() -> None:
    try:
        inspector = inspect(engine)
        if "stores" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("stores")}
        if "rider_limit" in columns:
            return
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE stores ADD COLUMN rider_limit INTEGER"))
    except Exception:
        return

_ensure_store_limit_column()


def _ensure_message_attachment_columns() -> None:
    try:
        inspector = inspect(engine)
        if "messages" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("messages")}
        with engine.begin() as conn:
            if "image_url" not in columns:
                conn.execute(text("ALTER TABLE messages ADD COLUMN image_url VARCHAR(255)"))
            if "image_mime" not in columns:
                conn.execute(text("ALTER TABLE messages ADD COLUMN image_mime VARCHAR(80)"))
    except Exception:
        return


_ensure_message_attachment_columns()

uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Restrict hosts in production when configured.
if ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

# CORS: open for dev, restricted by config for production.
if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
elif not IS_PRODUCTION:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth_router)
app.include_router(admin.router)
app.include_router(riders.router)
app.include_router(attendance.router)
app.include_router(shifts.router)
app.include_router(tracking.router)
app.include_router(notifications.router)
app.include_router(geo.router)
app.include_router(deliveries.router)
app.include_router(earnings.router)
app.include_router(captain.router)
app.include_router(messages.router)
app.include_router(push.router)
