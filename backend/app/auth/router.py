from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
import os
import json
import re
import time as time_module
import urllib.request
from app.database import SessionLocal
from app.models import User, Attendance, Notification, Store, AuditLog
from app.auth.jwt import create_access_token
from app.auth.passwords import hash_password, password_too_long, verify_password
from app.config import ACCESS_TOKEN_EXPIRE_MINUTES
from datetime import datetime, timedelta, time as dt_time

router = APIRouter(prefix="/auth", tags=["Auth"])

USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,24}$")
REGISTER_MAX = 5
REGISTER_WINDOW_SEC = 15 * 60
_REGISTER_EVENTS: dict[str, list[float]] = {}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _notify_user(
    db: Session,
    user_id: int,
    title: str,
    message: str,
    kind: str = "info",
    link: str | None = None,
):
    db.add(
        Notification(
            user_id=user_id,
            title=title,
            message=message,
            kind=kind,
            link=link,
            created_at=datetime.utcnow(),
        )
    )


def _check_register_rate(ip: str | None) -> int | None:
    if not ip:
        return None
    now = time_module.time()
    window_start = now - REGISTER_WINDOW_SEC
    events = [t for t in _REGISTER_EVENTS.get(ip, []) if t >= window_start]
    if len(events) >= REGISTER_MAX:
        retry_in = int(max(1, REGISTER_WINDOW_SEC - (now - min(events))))
        return retry_in
    events.append(now)
    _REGISTER_EVENTS[ip] = events
    return None


def _validate_password(password: str) -> str | None:
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if not any(c.isalpha() for c in password):
        return "Password must contain at least one letter."
    if not any(c.isdigit() for c in password):
        return "Password must contain at least one number."
    if password_too_long(password):
        return "Password must be 72 bytes or fewer."
    return None


def _store_rider_count(db: Session, store_name: str) -> int:
    return int(
        db.query(func.count(User.id))
        .filter(User.role == "rider")
        .filter(func.lower(User.store) == store_name.lower())
        .scalar()
        or 0
    )


def _enforce_store_rider_limit(db: Session, store_row: Store) -> None:
    limit = store_row.rider_limit
    if limit is None:
        return
    try:
        limit_value = int(limit)
    except (TypeError, ValueError):
        return
    if limit_value < 0:
        return
    count = _store_rider_count(db, store_row.name)
    if count >= limit_value:
        raise HTTPException(status_code=400, detail=f"Rider limit reached for {store_row.name} ({limit_value}).")


def _send_webhook(payload: dict) -> None:
    url = os.getenv("CAPTAIN_ALERT_WEBHOOK_URL")
    if not url:
        return
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=4)
    except Exception:
        return

@router.post("/login")
def login(data: dict, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data["username"]).first()
    if not user or not verify_password(data["password"], user.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="Account pending approval")

    if user.role == "rider":
        now = datetime.utcnow()
        last = (
            db.query(Attendance)
            .filter(Attendance.rider_id == user.id)
            .order_by(Attendance.created_at.desc(), Attendance.id.desc())
            .first()
        )
        last_ts = None
        if last:
            last_ts = last.updated_at or last.created_at
            if not last_ts and last.date:
                last_ts = datetime.combine(last.date, dt_time.min)

        if not last_ts or now - last_ts >= timedelta(hours=12):
            today = now.date()
            existing = (
                db.query(Attendance)
                .filter(Attendance.rider_id == user.id, Attendance.date == today)
                .first()
            )
            if existing:
                existing.status = "present"
                existing.updated_at = now
            else:
                db.add(
                    Attendance(
                        rider_id=user.id,
                        date=today,
                        status="present",
                        created_at=now,
                        updated_at=now,
                    )
                )
            db.add(
                Notification(
                    user_id=user.id,
                    title="Attendance marked",
                    message=f"Your attendance was marked present for {today.isoformat()}.",
                    kind="attendance",
                    link="/rider",
                    created_at=now,
                )
            )
            db.commit()

    token = create_access_token(
        {"sub": user.username, "role": user.role, "id": user.id},
        ACCESS_TOKEN_EXPIRE_MINUTES
    )

    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "role": user.role,
            "store": getattr(user, "store", None),
        }
    }


@router.get("/stores")
def public_stores(db: Session = Depends(get_db)):
    rows = (
        db.query(Store)
        .filter(Store.is_active == True)  # noqa: E712
        .order_by(Store.name.asc())
        .all()
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "code": s.code,
        }
        for s in rows
    ]


@router.post("/register")
def register_rider(data: dict, request: Request, db: Session = Depends(get_db)):
    retry = _check_register_rate(request.client.host if request.client else None)
    if retry is not None:
        raise HTTPException(status_code=429, detail=f"Too many registration attempts. Try again in {retry} seconds.")

    name = str(data.get("name", "")).strip()
    username = str(data.get("username", "")).strip()
    password = data.get("password")
    store_id = data.get("store_id")
    store_name = str(data.get("store", "")).strip()

    if not name or not username or not password:
        raise HTTPException(status_code=400, detail="name, username, password are required")
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username must be 3-24 characters (letters, numbers, . _ -).")
    password_error = _validate_password(str(password))
    if password_error:
        raise HTTPException(status_code=400, detail=password_error)

    store_row = None
    if store_id is not None:
        try:
            store_id = int(store_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="store_id must be a number")
        store_row = db.query(Store).filter(Store.id == store_id, Store.is_active == True).first()  # noqa: E712
    elif store_name:
        store_row = (
            db.query(Store)
            .filter(func.lower(Store.name) == store_name.lower())
            .filter(Store.is_active == True)  # noqa: E712
            .first()
        )

    if not store_row:
        raise HTTPException(status_code=400, detail="Store not found")

    _enforce_store_rider_limit(db, store_row)

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    rider = User(
        username=username,
        name=name,
        store=store_row.name,
        role="rider",
        password=hash_password(password),
        is_active=False,
    )
    db.add(rider)
    db.flush()
    db.add(
        AuditLog(
            actor_id=None,
            action="Rider registration requested",
            entity_type="user",
            entity_id=rider.id,
            details={"username": rider.username, "store": rider.store},
            created_at=datetime.utcnow(),
        )
    )

    # Notify admins and store captains
    admins = db.query(User).filter(User.role == "admin", User.is_active == True).all()  # noqa: E712
    captains = (
        db.query(User)
        .filter(User.role == "captain", User.is_active == True)  # noqa: E712
        .filter(func.lower(User.store) == store_row.name.lower())
        .all()
    )
    title = "New rider registration"
    message = f"{rider.name} ({rider.username}) requested access for {store_row.name}."
    for admin in admins:
        _notify_user(db, admin.id, title, message, kind="approval", link="/admin/riders")
    for captain in captains:
        _notify_user(db, captain.id, title, message, kind="approval", link="/captain")

    _send_webhook(
        {
            "event": "rider_registration",
            "store": store_row.name,
            "rider_name": rider.name,
            "rider_username": rider.username,
        }
    )

    db.commit()
    return {"message": "Registration submitted. Await approval."}


@router.post("/registration-status")
def registration_status(data: dict, db: Session = Depends(get_db)):
    username = str(data.get("username", "")).strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")

    user = db.query(User).filter(User.username == username).first()
    if user:
        status = "approved" if user.is_active else "pending"
        logs = (
            db.query(AuditLog, User)
            .outerjoin(User, AuditLog.actor_id == User.id)
            .filter(AuditLog.entity_type == "user", AuditLog.entity_id == user.id)
            .filter(AuditLog.action.in_([
                "Rider registration requested",
                "Approved rider registration",
                "Rejected rider registration",
            ]))
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .all()
        )
        info = {"requested_at": None, "approved_at": None, "rejected_at": None, "approved_by": None, "rejected_by": None}
        for log, actor in logs:
            if log.action == "Rider registration requested" and not info["requested_at"]:
                info["requested_at"] = log.created_at.isoformat() if log.created_at else None
            if log.action == "Approved rider registration" and not info["approved_at"]:
                info["approved_at"] = log.created_at.isoformat() if log.created_at else None
                info["approved_by"] = actor.name if actor else None
            if log.action == "Rejected rider registration" and not info["rejected_at"]:
                info["rejected_at"] = log.created_at.isoformat() if log.created_at else None
                info["rejected_by"] = actor.name if actor else None
        return {"status": status, "store": user.store, **info}

    # If user doesn't exist, search recent audit logs for a rejection/request
    logs = (
        db.query(AuditLog, User)
        .outerjoin(User, AuditLog.actor_id == User.id)
        .filter(AuditLog.action.in_([
            "Rider registration requested",
            "Rejected rider registration",
        ]))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(500)
        .all()
    )
    requested_at = None
    rejected_at = None
    rejected_by = None
    for log, actor in logs:
        details = log.details or {}
        if str(details.get("username", "")).lower() != username.lower():
            continue
        if log.action == "Rider registration requested" and requested_at is None:
            requested_at = log.created_at.isoformat() if log.created_at else None
        if log.action == "Rejected rider registration" and rejected_at is None:
            rejected_at = log.created_at.isoformat() if log.created_at else None
            rejected_by = actor.name if actor else None
            break
    if rejected_at:
        return {"status": "rejected", "requested_at": requested_at, "rejected_at": rejected_at, "rejected_by": rejected_by}
    if requested_at:
        return {"status": "pending", "requested_at": requested_at}
    return {"status": "not_found"}
