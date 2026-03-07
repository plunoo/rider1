from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from datetime import datetime, date, time, timedelta
import math
from app.database import SessionLocal
from app.models import (
    User,
    RiderStatus,
    Attendance,
    Shift,
    RiderLocation,
    RiderCurrentLocation,
    Geofence,
    LocationAlert,
    Store,
    Notification,
    AuditLog,
    RiderNote,
    QueuePin,
    Delivery,
)
from app.auth.deps import admin_only
from app.auth.passwords import hash_password
from app.config import LOCATION_STALE_MINUTES

router = APIRouter(prefix="/admin", tags=["Admin"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _parse_date_range(from_: str, to: str):
    try:
        from_date = date.fromisoformat(from_)
        to_date = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date range")

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")

    start = datetime.combine(from_date, time.min)
    end = datetime.combine(to_date, time.max)
    return from_date, to_date, start, end


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = int(math.ceil((pct / 100.0) * len(ordered)) - 1)
    k = max(0, min(k, len(ordered) - 1))
    return float(ordered[k])

def _log_action(
    db: Session,
    actor: User | None,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    details: dict | None = None,
):
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
            created_at=datetime.utcnow(),
        )
    )


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


def _hash_password_or_400(password: str | None) -> str:
    if not password:
        raise HTTPException(status_code=400, detail="password is required")
    try:
        return hash_password(password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _store_rider_count(db: Session, store_name: str, exclude_id: int | None = None) -> int:
    q = (
        db.query(func.count(User.id))
        .filter(User.role == "rider")
        .filter(func.lower(User.store) == store_name.lower())
    )
    if exclude_id is not None:
        q = q.filter(User.id != exclude_id)
    return int(q.scalar() or 0)


def _enforce_store_rider_limit(db: Session, store: Store, exclude_id: int | None = None) -> None:
    limit = store.rider_limit
    if limit is None:
        return
    try:
        limit_value = int(limit)
    except (TypeError, ValueError):
        return
    if limit_value < 0:
        return
    count = _store_rider_count(db, store.name, exclude_id=exclude_id)
    if count >= limit_value:
        raise HTTPException(status_code=400, detail=f"Rider limit reached for {store.name} ({limit_value}).")

@router.post("/add-rider")
def add_rider(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    store = data.get("store")
    if store is None:
        raise HTTPException(status_code=400, detail="Store is required")
    store = str(store).strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store is required")
    store_row = (
        db.query(Store)
        .filter(func.lower(Store.name) == store.lower())
        .first()
    )
    if not store_row:
        raise HTTPException(status_code=400, detail="Store not found")
    _enforce_store_rider_limit(db, store_row)

    rider = User(
        username=data["username"],
        name=data["name"],
        store=store,
        role="rider",
        password=_hash_password_or_400(data.get("password"))
    )
    db.add(rider)
    db.flush()
    _log_action(
        db,
        admin,
        action="Created rider",
        entity_type="user",
        entity_id=rider.id,
        details={"username": rider.username, "store": rider.store},
    )
    db.commit()
    return {"message": "Rider added"}


@router.get("/store-captains")
def list_store_captains(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    captains = (
        db.query(User)
        .filter(User.role == "captain")
        .order_by(User.name.asc())
        .all()
    )
    return [
        {
            "id": c.id,
            "username": c.username,
            "name": c.name,
            "store": getattr(c, "store", None),
            "is_active": c.is_active,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in captains
    ]


@router.post("/store-captains")
def add_store_captain(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    name = str(data.get("name", "")).strip()
    username = str(data.get("username", "")).strip()
    password = data.get("password")
    store = str(data.get("store", "")).strip()

    if not name or not username or not password or not store:
        raise HTTPException(status_code=400, detail="name, username, password, and store are required")

    store_row = (
        db.query(Store)
        .filter(func.lower(Store.name) == store.lower())
        .first()
    )
    if not store_row:
        raise HTTPException(status_code=400, detail="Store not found")

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    captain = User(
        username=username,
        name=name,
        store=store_row.name,
        role="captain",
        password=_hash_password_or_400(password)
    )
    db.add(captain)
    db.flush()
    _log_action(
        db,
        admin,
        action="Created store captain",
        entity_type="user",
        entity_id=captain.id,
        details={"username": captain.username, "store": captain.store},
    )
    db.commit()
    return {"message": "Store captain added"}


@router.delete("/store-captains/{captain_id}")
def delete_store_captain(
    captain_id: int,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    captain = db.query(User).filter(User.id == captain_id, User.role == "captain").first()
    if not captain:
        raise HTTPException(status_code=404, detail="Captain not found")

    _log_action(
        db,
        admin,
        action="Deleted store captain",
        entity_type="user",
        entity_id=captain.id,
        details={"username": captain.username, "store": captain.store},
    )
    db.delete(captain)
    db.commit()
    return {"message": "Store captain deleted"}


@router.delete("/delete-rider")
def delete_rider(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    """Delete a rider by username or id."""
    rider = None
    if "id" in data:
        rider = db.query(User).filter(User.id == data["id"], User.role == "rider").first()
    elif "username" in data:
        rider = db.query(User).filter(User.username == data["username"], User.role == "rider").first()

    if not rider:
        return {"message": "Rider not found"}

    _log_action(
        db,
        admin,
        action="Deleted rider",
        entity_type="user",
        entity_id=rider.id,
        details={"username": rider.username, "store": rider.store},
    )

    # Remove related data explicitly to ensure cleanup on databases without ON DELETE CASCADE enforcement
    db.query(RiderStatus).filter(RiderStatus.rider_id == rider.id).delete(synchronize_session=False)
    db.query(Attendance).filter(Attendance.rider_id == rider.id).delete(synchronize_session=False)
    db.query(Shift).filter(Shift.rider_id == rider.id).delete(synchronize_session=False)
    db.query(RiderLocation).filter(RiderLocation.rider_id == rider.id).delete(synchronize_session=False)

    db.delete(rider)
    db.commit()
    return {"message": "Rider deleted"}


@router.get("/rider-status")
def rider_status(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    """Return latest status per rider for the admin view."""
    rows = (
        db.query(RiderStatus)
        .order_by(RiderStatus.rider_id, RiderStatus.updated_at.desc())
        .all()
    )

    latest: dict[int, RiderStatus] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r

    data = []
    for rider_id, status in latest.items():
        user = db.query(User).filter(User.id == rider_id).first()
        data.append(
            {
                "rider_id": rider_id,
                "name": user.name if user else f"Rider {rider_id}",
                "status": status.status,
                "updated_at": status.updated_at.isoformat() if isinstance(status.updated_at, datetime) else None,
            }
        )

    return {"items": data}


@router.get("/riders")
def list_riders(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    """
    Return all rider accounts with their latest status (if any).
    Falls back to 'offline' when no status exists yet.
    """
    riders = db.query(User).filter(User.role == "rider").all()

    rows = (
        db.query(RiderStatus)
        .order_by(RiderStatus.rider_id, RiderStatus.updated_at.desc())
        .all()
    )
    latest: dict[int, RiderStatus] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r

    items = []
    for rider in riders:
        status_row = latest.get(rider.id)
        items.append(
            {
                "id": rider.id,
                "username": rider.username,
                "name": rider.name,
                "store": getattr(rider, "store", None),
                "status": status_row.status if status_row else "offline",
                "updated_at": status_row.updated_at.isoformat() if status_row else None,
                "is_active": rider.is_active,
            }
        )

    return {"items": items}


@router.get("/riders/approvals")
def rider_approvals(
    rider_ids: str = Query(..., description="Comma-separated rider IDs"),
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    raw_ids = [s.strip() for s in rider_ids.split(",") if s.strip()]
    ids: list[int] = []
    for value in raw_ids:
        if value.isdigit():
            ids.append(int(value))
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {"items": []}

    actions = {
        "Rider registration requested",
        "Approved rider registration",
        "Rejected rider registration",
        "Deactivated rider",
    }
    rows = (
        db.query(AuditLog, User)
        .outerjoin(User, AuditLog.actor_id == User.id)
        .filter(AuditLog.entity_type == "user", AuditLog.entity_id.in_(ids))
        .filter(AuditLog.action.in_(actions))
        .order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
        .all()
    )

    result: dict[int, dict] = {
        rid: {
            "rider_id": rid,
            "requested_at": None,
            "approved_at": None,
            "approved_by": None,
            "rejected_at": None,
            "rejected_by": None,
            "deactivated_at": None,
            "deactivated_by": None,
        }
        for rid in ids
    }
    for log, actor in rows:
        entry = result.get(log.entity_id)
        if not entry:
            continue
        if log.action == "Rider registration requested":
            entry["requested_at"] = log.created_at.isoformat() if log.created_at else None
        elif log.action == "Approved rider registration":
            entry["approved_at"] = log.created_at.isoformat() if log.created_at else None
            entry["approved_by"] = actor.name if actor else None
        elif log.action == "Rejected rider registration":
            entry["rejected_at"] = log.created_at.isoformat() if log.created_at else None
            entry["rejected_by"] = actor.name if actor else None
        elif log.action == "Deactivated rider":
            entry["deactivated_at"] = log.created_at.isoformat() if log.created_at else None
            entry["deactivated_by"] = actor.name if actor else None

    return {"items": list(result.values())}


@router.post("/riders/bulk-status")
def bulk_update_rider_status(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rider_ids = data.get("rider_ids") or []
    status_value = str(data.get("status", "")).strip().lower()
    allowed = {"available", "delivery", "break"}
    if status_value not in allowed:
        if status_value == "offline":
            raise HTTPException(status_code=403, detail="Only store captains can remove riders from the queue")
        raise HTTPException(status_code=400, detail="Invalid status")
    if not isinstance(rider_ids, list) or not rider_ids:
        raise HTTPException(status_code=400, detail="rider_ids is required")

    ids: list[int] = []
    for value in rider_ids:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="rider_ids must be numbers")

    riders = db.query(User).filter(User.id.in_(ids), User.role == "rider").all()
    found_ids = {r.id for r in riders}
    missing = [rid for rid in ids if rid not in found_ids]
    now = datetime.utcnow()
    for rider in riders:
        db.add(
            RiderStatus(
                rider_id=rider.id,
                status=status_value,
                updated_at=now,
            )
        )
        _notify_user(
            db,
            rider.id,
            "Status updated",
            f"Your status was set to {status_value} by an admin.",
            kind="status",
            link="/rider",
        )
        _log_action(
            db,
            admin,
            action="Bulk updated rider status",
            entity_type="rider_status",
            entity_id=None,
            details={"rider_id": rider.id, "status": status_value},
        )

    db.commit()
    return {"message": "Statuses updated", "count": len(riders), "missing": missing}


@router.patch("/riders/{rider_id}/status")
def update_rider_status(
    rider_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    status_value = str(data.get("status", "")).strip().lower()
    allowed = {"available", "delivery", "break"}
    if status_value not in allowed:
        if status_value == "offline":
            raise HTTPException(status_code=403, detail="Only store captains can remove riders from the queue")
        raise HTTPException(status_code=400, detail="Invalid status")

    status_row = RiderStatus(
        rider_id=rider.id,
        status=status_value,
        updated_at=datetime.utcnow()
    )
    db.add(status_row)
    _log_action(
        db,
        admin,
        action="Updated rider status",
        entity_type="rider_status",
        entity_id=None,
        details={"rider_id": rider.id, "status": status_value},
    )
    _notify_user(
        db,
        rider.id,
        "Status updated",
        f"Your status was set to {status_value} by an admin.",
        kind="status",
        link="/rider",
    )
    db.commit()
    return {"message": "Rider status updated", "status": status_value}


@router.get("/rider-notes")
def list_rider_notes(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rows = db.query(RiderNote).order_by(RiderNote.updated_at.desc(), RiderNote.id.desc()).all()
    return [
        {
            "rider_id": r.rider_id,
            "note": r.note,
            "updated_by": r.updated_by,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.post("/riders/{rider_id}/note")
def upsert_rider_note(
    rider_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    note = str(data.get("note", "")).strip()
    existing = db.query(RiderNote).filter(RiderNote.rider_id == rider_id).first()

    if not note:
        if existing:
            db.delete(existing)
            _log_action(
                db,
                admin,
                action="Cleared rider note",
                entity_type="rider_note",
                entity_id=existing.id,
                details={"rider_id": rider_id},
            )
            db.commit()
        return {"message": "Note cleared"}

    if existing:
        existing.note = note
        existing.updated_by = admin.id
        existing.updated_at = datetime.utcnow()
        note_id = existing.id
    else:
        new_note = RiderNote(
            rider_id=rider_id,
            note=note,
            updated_by=admin.id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(new_note)
        db.flush()
        note_id = new_note.id

    _log_action(
        db,
        admin,
        action="Updated rider note",
        entity_type="rider_note",
        entity_id=note_id,
        details={"rider_id": rider_id},
    )
    db.commit()
    return {"message": "Note saved"}


@router.delete("/riders/{rider_id}/note")
def delete_rider_note(
    rider_id: int,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    note = db.query(RiderNote).filter(RiderNote.rider_id == rider_id).first()
    if not note:
        return {"message": "Note not found"}
    _log_action(
        db,
        admin,
        action="Cleared rider note",
        entity_type="rider_note",
        entity_id=note.id,
        details={"rider_id": rider_id},
    )
    db.delete(note)
    db.commit()
    return {"message": "Note cleared"}


@router.get("/queue-pins")
def list_queue_pins(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rows = (
        db.query(QueuePin)
        .filter(QueuePin.admin_id == admin.id)
        .order_by(QueuePin.created_at.asc(), QueuePin.id.asc())
        .all()
    )
    return [
        {
            "rider_id": p.rider_id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in rows
    ]


@router.post("/queue-pins")
def add_queue_pin(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    if "rider_id" not in data:
        raise HTTPException(status_code=400, detail="rider_id is required")
    try:
        rider_id = int(data.get("rider_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="rider_id must be a number")

    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")

    existing = (
        db.query(QueuePin)
        .filter(QueuePin.admin_id == admin.id, QueuePin.rider_id == rider_id)
        .first()
    )
    if existing:
        return {"message": "Already pinned"}

    pin = QueuePin(admin_id=admin.id, rider_id=rider_id, created_at=datetime.utcnow())
    db.add(pin)
    _log_action(
        db,
        admin,
        action="Pinned rider in queue",
        entity_type="queue_pin",
        entity_id=None,
        details={"rider_id": rider_id},
    )
    db.commit()
    return {"message": "Pinned"}


@router.delete("/queue-pins/{rider_id}")
def remove_queue_pin(
    rider_id: int,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    pin = (
        db.query(QueuePin)
        .filter(QueuePin.admin_id == admin.id, QueuePin.rider_id == rider_id)
        .first()
    )
    if not pin:
        return {"message": "Not pinned"}
    _log_action(
        db,
        admin,
        action="Unpinned rider in queue",
        entity_type="queue_pin",
        entity_id=pin.id,
        details={"rider_id": rider_id},
    )
    db.delete(pin)
    db.commit()
    return {"message": "Unpinned"}


@router.post("/dispatch/assign")
def dispatch_assign(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    if "rider_id" not in data:
        raise HTTPException(status_code=400, detail="rider_id is required")
    try:
        rider_id = int(data.get("rider_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="rider_id must be a number")

    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")

    store_id = data.get("store_id")
    store_name = str(data.get("store", "")).strip()
    if store_id is not None:
        try:
            store_id = int(store_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="store_id must be a number")
        store_row = db.query(Store).filter(Store.id == store_id).first()
        if not store_row:
            raise HTTPException(status_code=400, detail="Store not found")
        store_name = store_row.name

    if store_id is None and store_name:
        store_row = db.query(Store).filter(func.lower(Store.name) == store_name.lower()).first()
        if store_row:
            store_id = store_row.id
            store_name = store_row.name
    if store_id is None and not store_name and rider.store:
        store_row = db.query(Store).filter(func.lower(Store.name) == rider.store.lower()).first()
        if store_row:
            store_id = store_row.id
            store_name = store_row.name

    base_pay_cents = None
    if "base_pay_cents" in data:
        base_pay_cents = data.get("base_pay_cents")
    base_pay = data.get("base_pay")
    if base_pay_cents is None and base_pay is not None:
        try:
            raw = str(base_pay).replace("$", "").replace(",", "").strip()
            amount = float(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="base_pay must be a number")
        if amount < 0:
            raise HTTPException(status_code=400, detail="base_pay must be >= 0")
        base_pay_cents = int(round(amount * 100))
    if base_pay_cents is None:
        if store_id:
            store_row = db.query(Store).filter(Store.id == store_id).first()
            if store_row:
                base_pay_cents = store_row.default_base_pay_cents or 0
        if base_pay_cents is None:
            base_pay_cents = 0
    try:
        base_pay_cents = int(base_pay_cents)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="base_pay_cents must be a number")
    if base_pay_cents < 0:
        raise HTTPException(status_code=400, detail="base_pay_cents must be >= 0")

    reference = str(data.get("reference", "")).strip() or None
    now = datetime.utcnow()
    delivery = Delivery(
        rider_id=rider.id,
        store_id=store_id,
        status="assigned",
        reference=reference,
        assigned_at=now,
        created_at=now,
        base_pay_cents=base_pay_cents,
    )
    db.add(delivery)
    db.add(
        RiderStatus(
            rider_id=rider.id,
            status="delivery",
            updated_at=now,
        )
    )
    _notify_user(
        db,
        rider.id,
        "New assignment",
        f"You have been assigned a delivery{f' ({reference})' if reference else ''}. Pay ${base_pay_cents / 100:.2f}.",
        kind="delivery",
        link="/rider/deliveries",
    )
    db.flush()
    _log_action(
        db,
        admin,
        action="Dispatched rider",
        entity_type="delivery",
        entity_id=delivery.id,
        details={"rider_id": rider.id, "store": store_name or rider.store, "reference": reference, "base_pay_cents": base_pay_cents},
    )
    db.commit()
    return {"message": "Dispatch assigned", "delivery_id": delivery.id}

@router.patch("/riders/{rider_id}/activation")
def update_rider_activation(
    rider_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if "is_active" not in data:
        raise HTTPException(status_code=400, detail="is_active is required")
    prev_active = rider.is_active
    rider.is_active = bool(data.get("is_active"))

    action = "Updated rider activation"
    if prev_active is False and rider.is_active is True:
        action = "Approved rider registration"
        db.add(
            RiderStatus(
                rider_id=rider.id,
                status="offline",
                updated_at=datetime.utcnow(),
            )
        )
        _notify_user(
            db,
            rider.id,
            "Welcome aboard",
            f"Your account has been approved for {rider.store or 'your store'}. Check in every 12 hours to stay active.",
            kind="onboarding",
            link="/rider/check-in",
        )
    elif prev_active is True and rider.is_active is False:
        action = "Deactivated rider"
    _log_action(
        db,
        admin,
        action=action,
        entity_type="user",
        entity_id=rider.id,
        details={"is_active": rider.is_active},
    )
    _notify_user(
        db,
        rider.id,
        "Account status updated",
        "Your account has been activated." if rider.is_active else "Your account has been deactivated.",
        kind="account",
        link="/rider",
    )
    db.commit()
    return {"message": "Rider activation updated", "is_active": rider.is_active}


@router.post("/riders/{rider_id}/reject")
def reject_rider_registration(
    rider_id: int,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if rider.is_active is not False:
        raise HTTPException(status_code=400, detail="Only pending riders can be rejected")

    _log_action(
        db,
        admin,
        action="Rejected rider registration",
        entity_type="user",
        entity_id=rider.id,
        details={"username": rider.username, "store": rider.store},
    )

    db.query(RiderStatus).filter(RiderStatus.rider_id == rider.id).delete(synchronize_session=False)
    db.query(Attendance).filter(Attendance.rider_id == rider.id).delete(synchronize_session=False)
    db.query(Shift).filter(Shift.rider_id == rider.id).delete(synchronize_session=False)
    db.query(RiderLocation).filter(RiderLocation.rider_id == rider.id).delete(synchronize_session=False)

    db.delete(rider)
    db.commit()
    return {"message": "Rider rejected"}


@router.patch("/riders/{rider_id}/store")
def update_rider_store(
    rider_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if "store" not in data:
        raise HTTPException(status_code=400, detail="store is required (use null to clear)")

    store_value = data.get("store")
    if store_value is None or str(store_value).strip() == "":
        rider.store = None
        _log_action(
            db,
            admin,
            action="Cleared rider store",
            entity_type="user",
            entity_id=rider.id,
            details={"store": None},
        )
        _notify_user(
            db,
            rider.id,
            "Store assignment updated",
            "Your store assignment has been cleared.",
            kind="account",
            link="/rider",
        )
        db.commit()
        return {"message": "Rider store cleared", "store": None}

    store_name = str(store_value).strip()
    store_row = (
        db.query(Store)
        .filter(func.lower(Store.name) == store_name.lower())
        .first()
    )
    if not store_row:
        raise HTTPException(status_code=400, detail="Store not found")
    if rider.store and rider.store.lower() == store_row.name.lower():
        return {"message": "Rider store updated", "store": rider.store}
    _enforce_store_rider_limit(db, store_row, exclude_id=rider.id)
    rider.store = store_row.name
    _log_action(
        db,
        admin,
        action="Updated rider store",
        entity_type="user",
        entity_id=rider.id,
        details={"store": rider.store},
    )
    _notify_user(
        db,
        rider.id,
        "Store assignment updated",
        f"You have been assigned to {rider.store}.",
        kind="account",
        link="/rider",
    )
    db.commit()
    return {"message": "Rider store updated", "store": rider.store}


@router.get("/dashboard-stats")
def dashboard_stats(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    """
    Summary counts for the admin dashboard, based on latest rider status and today's attendance.
    """
    total_riders = db.query(User).filter(User.role == "rider").count()

    rows = (
        db.query(RiderStatus)
        .order_by(RiderStatus.rider_id, RiderStatus.updated_at.desc())
        .all()
    )
    latest: dict[int, RiderStatus] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r

    active = sum(1 for s in latest.values() if s.status != "offline")
    delivery = sum(1 for s in latest.values() if s.status == "delivery")
    available = sum(1 for s in latest.values() if s.status == "available")
    on_break = sum(1 for s in latest.values() if s.status == "break")

    today = datetime.utcnow().date()
    absent = (
        db.query(Attendance)
        .filter(Attendance.date == today, Attendance.status.in_(["absent", "off_day"]))
        .count()
    )

    return {
        "total_riders": total_riders,
        "active": active,
        "delivery": delivery,
        "available": available,
        "on_break": on_break,
        "absent": absent,
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.get("/attendance")
def list_attendance(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    try:
        from_date = date.fromisoformat(from_)
        to_date = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date range")

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")

    rows = (
        db.query(Attendance, User)
        .join(User, Attendance.rider_id == User.id)
        .filter(Attendance.date >= from_date, Attendance.date <= to_date)
        .order_by(Attendance.date.desc(), Attendance.updated_at.desc(), Attendance.id.desc())
        .all()
    )

    items = []
    for attendance, user in rows:
        items.append(
            {
                "id": attendance.id,
                "rider_id": attendance.rider_id,
                "rider_name": user.name if user else f"Rider {attendance.rider_id}",
                "date": attendance.date.isoformat(),
                "status": attendance.status,
                "created_at": attendance.created_at.isoformat() if attendance.created_at else None,
                "updated_at": attendance.updated_at.isoformat() if attendance.updated_at else None,
            }
        )

    return items


@router.post("/attendance/mark")
def mark_attendance_admin(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    if "rider_id" not in data or "date" not in data or "status" not in data:
        raise HTTPException(status_code=400, detail="rider_id, date, and status are required")

    try:
        rider_id = int(data["rider_id"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="rider_id must be a number")

    try:
        mark_date = date.fromisoformat(str(data["date"]))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")

    status = str(data["status"]).strip().lower()
    allowed = {"present", "absent", "off_day", "late"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status")

    now = datetime.utcnow()
    existing = (
        db.query(Attendance)
        .filter(Attendance.rider_id == rider_id, Attendance.date == mark_date)
        .first()
    )

    if existing:
        existing.status = status
        existing.updated_at = now
    else:
        db.add(
            Attendance(
                rider_id=rider_id,
                date=mark_date,
                status=status,
                created_at=now,
                updated_at=now,
            )
        )

    rider = db.query(User).filter(User.id == rider_id).first()
    if rider:
        db.add(
            Notification(
                user_id=rider.id,
                title="Attendance updated",
                message=f"Attendance set to {status} for {mark_date.isoformat()}.",
                kind="attendance",
                link="/rider",
                created_at=now,
            )
        )

    _log_action(
        db,
        admin,
        action="Marked attendance",
        entity_type="attendance",
        entity_id=existing.id if existing else None,
        details={"rider_id": rider_id, "date": mark_date.isoformat(), "status": status},
    )

    db.commit()
    return {"message": "Attendance marked"}


@router.get("/geofences")
def list_geofences(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    geofences = db.query(Geofence).order_by(Geofence.name.asc()).all()
    return [
        {
            "id": g.id,
            "name": g.name,
            "store": g.store,
            "lat": g.lat,
            "lng": g.lng,
            "radius_m": g.radius_m,
            "is_active": g.is_active,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        }
        for g in geofences
    ]


@router.post("/geofences")
def create_geofence(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    required = ["name", "lat", "lng", "radius_m"]
    if not all(k in data for k in required):
        raise HTTPException(status_code=400, detail="name, lat, lng, and radius_m are required")

    try:
        lat = float(data["lat"])
        lng = float(data["lng"])
        radius_m = float(data["radius_m"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="lat, lng, and radius_m must be numbers")

    name = str(data["name"]).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    store = data.get("store")
    store = str(store).strip() if store is not None else None

    gf = Geofence(
        name=name,
        store=store or None,
        lat=lat,
        lng=lng,
        radius_m=radius_m,
        is_active=True,
    )
    db.add(gf)
    db.flush()
    _log_action(
        db,
        admin,
        action="Created geofence",
        entity_type="geofence",
        entity_id=gf.id,
        details={"name": gf.name, "store": gf.store, "radius_m": gf.radius_m},
    )
    db.commit()
    return {"id": gf.id, "message": "Geofence created"}


@router.delete("/geofences/{geofence_id}")
def delete_geofence(
    geofence_id: int,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    gf = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")
    _log_action(
        db,
        admin,
        action="Deleted geofence",
        entity_type="geofence",
        entity_id=gf.id,
        details={"name": gf.name, "store": gf.store},
    )
    db.delete(gf)
    db.commit()
    return {"message": "Geofence deleted"}


@router.patch("/geofences/{geofence_id}")
def update_geofence(
    geofence_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    gf = db.query(Geofence).filter(Geofence.id == geofence_id).first()
    if not gf:
        raise HTTPException(status_code=404, detail="Geofence not found")

    if "name" in data:
        name = str(data.get("name", "")).strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        gf.name = name

    if "store" in data:
        store = data.get("store")
        store = str(store).strip() if store is not None else None
        gf.store = store or None

    if "lat" in data:
        try:
            gf.lat = float(data["lat"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="lat must be a number")

    if "lng" in data:
        try:
            gf.lng = float(data["lng"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="lng must be a number")

    if "radius_m" in data:
        try:
            gf.radius_m = float(data["radius_m"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="radius_m must be a number")

    if "is_active" in data:
        gf.is_active = bool(data["is_active"])

    _log_action(
        db,
        admin,
        action="Updated geofence",
        entity_type="geofence",
        entity_id=gf.id,
        details={"name": gf.name, "store": gf.store, "radius_m": gf.radius_m, "is_active": gf.is_active},
    )
    db.commit()
    return {"message": "Geofence updated"}


@router.get("/location-alerts")
def list_location_alerts(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    try:
        from_date = date.fromisoformat(from_)
        to_date = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date range")

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")

    start = datetime.combine(from_date, datetime.min.time())
    end = datetime.combine(to_date, datetime.max.time())

    base_q = (
        db.query(LocationAlert, Geofence, User)
        .outerjoin(Geofence, LocationAlert.geofence_id == Geofence.id)
        .outerjoin(User, LocationAlert.rider_id == User.id)
        .filter(LocationAlert.created_at >= start, LocationAlert.created_at <= end)
    )
    total = base_q.count()
    rows = (
        base_q
        .order_by(LocationAlert.created_at.desc(), LocationAlert.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "id": a.id,
                "rider_id": a.rider_id,
                "rider_name": u.name if u else None,
                "store": getattr(u, "store", None) if u else None,
                "geofence_id": a.geofence_id,
                "geofence_name": g.name if g else None,
                "message": a.message,
                "lat": a.lat,
                "lng": a.lng,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a, g, u in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    entity_type: str | None = None,
    entity_id: int | None = None,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    q = (
        db.query(AuditLog, User)
        .outerjoin(User, AuditLog.actor_id == User.id)
    )
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        q = q.filter(AuditLog.entity_id == entity_id)

    rows = (
        q.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "actor_id": log.actor_id,
            "actor_name": u.name if u else None,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "details": log.details,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log, u in rows
    ]


@router.get("/status-history")
def status_history(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    rider_id: int | None = None,
    store: str | None = None,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    from_date, to_date, start, end = _parse_date_range(from_, to)
    q = (
        db.query(RiderStatus, User)
        .join(User, RiderStatus.rider_id == User.id)
        .filter(RiderStatus.updated_at >= start, RiderStatus.updated_at <= end)
    )
    if rider_id is not None:
        q = q.filter(RiderStatus.rider_id == rider_id)
    if store:
        q = q.filter(func.lower(User.store) == store.lower())

    rows = (
        q.order_by(RiderStatus.updated_at.desc(), RiderStatus.id.desc())
        .limit(5000)
        .all()
    )
    return {
        "items": [
            {
                "rider_id": s.rider_id,
                "rider_name": u.name if u else None,
                "store": getattr(u, "store", None) if u else None,
                "status": s.status,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
            for s, u in rows
        ]
    }


@router.get("/analytics")
def analytics(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    store: str | None = None,
    rider_id: int | None = None,
    status: str | None = None,
    active: str | None = None,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    from_date, to_date, start, end = _parse_date_range(from_, to)
    dates = []
    cursor = from_date
    while cursor <= to_date:
        dates.append(cursor)
        cursor += timedelta(days=1)

    if status:
        status_value = status.strip().lower()
        allowed_status = {"available", "delivery", "break", "offline"}
        if status_value not in allowed_status:
            raise HTTPException(status_code=400, detail="Invalid status filter")
        status = status_value

    if active:
        active_value = active.strip().lower()
        allowed_active = {"active", "inactive"}
        if active_value not in allowed_active:
            raise HTTPException(status_code=400, detail="Invalid active filter")
        active = active_value

    rider_q = db.query(User).filter(User.role == "rider")
    if store:
        rider_q = rider_q.filter(func.lower(User.store) == store.lower())
    if rider_id is not None:
        rider_q = rider_q.filter(User.id == rider_id)

    if active == "active":
        rider_q = rider_q.filter(User.is_active.is_(True))
    elif active == "inactive":
        rider_q = rider_q.filter(User.is_active.is_(False))

    base_riders = rider_q.all()
    base_ids = [r.id for r in base_riders]
    if status and base_ids:
        status_rows = (
            db.query(RiderStatus)
            .filter(RiderStatus.rider_id.in_(base_ids), RiderStatus.updated_at <= end)
            .order_by(RiderStatus.rider_id.asc(), RiderStatus.updated_at.desc(), RiderStatus.id.desc())
            .all()
        )
        latest_status: dict[int, str] = {}
        for row in status_rows:
            if row.rider_id not in latest_status:
                latest_status[row.rider_id] = row.status

        if status == "offline":
            filtered_ids = {rid for rid in base_ids if latest_status.get(rid, "offline") == "offline"}
        else:
            filtered_ids = {rid for rid, value in latest_status.items() if value == status}
        riders = [r for r in base_riders if r.id in filtered_ids]
    else:
        riders = base_riders

    rider_ids = [r.id for r in riders]
    rider_map = {r.id: r for r in riders}

    range_days = (to_date - from_date).days + 1
    prev_from = from_date - timedelta(days=range_days)
    prev_to = to_date - timedelta(days=range_days)
    prev_start = datetime.combine(prev_from, time.min)
    prev_end = datetime.combine(prev_to, time.max)

    def _empty_response():
        prev_dates = []
        cursor_prev = prev_from
        while cursor_prev <= prev_to:
            prev_dates.append(cursor_prev)
            cursor_prev += timedelta(days=1)
        return {
            "range": {"from": from_date.isoformat(), "to": to_date.isoformat()},
            "previous_range": {"from": prev_from.isoformat(), "to": prev_to.isoformat()},
            "kpis": {
                "total_deliveries": 0,
                "on_time_rate": 0,
                "avg_delivery_minutes": 0,
                "active_riders": 0,
                "attendance_rate": 0,
                "payout_total_cents": 0,
            },
            "previous": {
                "kpis": {
                    "total_deliveries": 0,
                    "on_time_rate": 0,
                    "avg_delivery_minutes": 0,
                    "active_riders": 0,
                    "attendance_rate": 0,
                    "payout_total_cents": 0,
                }
            },
            "trends": {
                "deliveries": [{"date": d.isoformat(), "count": 0} for d in dates],
                "attendance": [{"date": d.isoformat(), "present": 0, "late": 0, "absent": 0, "off_day": 0} for d in dates],
                "active_riders": [{"date": d.isoformat(), "count": 0} for d in dates],
                "late_checkins": [{"date": d.isoformat(), "count": 0} for d in dates],
            },
            "rider_performance": {"top": [], "bottom": []},
            "store_comparison": [],
            "captain_comparison": [],
            "queue_health": {
                "avg_available_minutes": 0,
                "p95_available_minutes": 0,
                "peak_waiting": 0,
                "stale_rider_rate": 0,
                "samples": 0,
            },
            "sla": {
                "delivery_breaches": 0,
                "delivery_total": 0,
                "queue_wait_breaches": 0,
            },
            "geofence": {"entries": 0, "exits": 0, "by_day": [{"date": d.isoformat(), "entries": 0, "exits": 0} for d in dates]},
            "payouts": {"base_cents": 0, "tip_cents": 0, "bonus_cents": 0, "total_cents": 0, "avg_per_delivery_cents": 0},
            "hourly": {
                "deliveries": [{"hour": h, "count": 0} for h in range(24)],
                "checkins": [{"hour": h, "count": 0} for h in range(24)],
            },
            "freshness": {
                "latest_status_at": None,
                "latest_location_at": None,
                "latest_delivery_at": None,
                "latest_attendance_at": None,
            },
        }

    if rider_id is not None:
        exists = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
        if not exists:
            raise HTTPException(status_code=404, detail="Rider not found")
        if rider_id not in rider_map:
            return _empty_response()

    if not riders and rider_id is None and (store or status or active):
        return _empty_response()

    def _compute_kpis_only(start_dt: datetime, end_dt: datetime, from_d: date, to_d: date):
        range_dates = []
        cursor_local = from_d
        while cursor_local <= to_d:
            range_dates.append(cursor_local)
            cursor_local += timedelta(days=1)

        attendance_q_local = (
            db.query(Attendance)
            .filter(Attendance.date >= from_d, Attendance.date <= to_d)
        )
        if rider_ids:
            attendance_q_local = attendance_q_local.filter(Attendance.rider_id.in_(rider_ids))
        attendance_rows_local = attendance_q_local.all()

        attendance_totals_local = {"present": 0, "late": 0, "absent": 0, "off_day": 0}
        for a in attendance_rows_local:
            status_value = a.status or ""
            if status_value in attendance_totals_local:
                attendance_totals_local[status_value] += 1

        total_attendance_local = sum(attendance_totals_local.values())
        attendance_rate_local = 0
        if total_attendance_local:
            attendance_rate_local = (attendance_totals_local["present"] + attendance_totals_local["late"]) / total_attendance_local

        end_expr_local = func.coalesce(Delivery.delivered_at, Delivery.canceled_at, Delivery.assigned_at, Delivery.created_at)
        deliveries_q_local = db.query(Delivery).filter(end_expr_local >= start_dt, end_expr_local <= end_dt)
        if rider_ids:
            deliveries_q_local = deliveries_q_local.filter(Delivery.rider_id.in_(rider_ids))
        deliveries_local = deliveries_q_local.all()

        total_deliveries_local = 0
        base_total_local = tip_total_local = bonus_total_local = 0
        on_time_count_local = 0
        delivered_with_duration_local = 0
        total_duration_local = 0.0

        for d in deliveries_local:
            total_deliveries_local += 1
            base_total_local += d.base_pay_cents or 0
            tip_total_local += d.tip_cents or 0
            bonus_total_local += d.bonus_cents or 0

            start_time = d.assigned_at or d.picked_up_at or d.created_at
            if start_time and d.delivered_at:
                delivered_with_duration_local += 1
                duration_min = (d.delivered_at - start_time).total_seconds() / 60
                if duration_min >= 0:
                    total_duration_local += duration_min
                    if duration_min <= 45:
                        on_time_count_local += 1

        avg_delivery_minutes_local = round(total_duration_local / delivered_with_duration_local, 2) if delivered_with_duration_local else 0
        on_time_rate_local = round(on_time_count_local / delivered_with_duration_local, 4) if delivered_with_duration_local else 0

        status_q_local = db.query(RiderStatus).filter(RiderStatus.updated_at <= end_dt)
        if rider_ids:
            status_q_local = status_q_local.filter(RiderStatus.rider_id.in_(rider_ids))
        status_rows_local = status_q_local.order_by(RiderStatus.updated_at.asc(), RiderStatus.id.asc()).all()

        active_by_day_local = {}
        current_status_local = {}
        idx_local = 0
        for day in range_dates:
            day_end = datetime.combine(day, time.max)
            while idx_local < len(status_rows_local) and status_rows_local[idx_local].updated_at <= day_end:
                current_status_local[status_rows_local[idx_local].rider_id] = status_rows_local[idx_local].status
                idx_local += 1
            active_by_day_local[day.isoformat()] = sum(1 for s in current_status_local.values() if s != "offline")

        payout_total_local = base_total_local + tip_total_local + bonus_total_local

        return {
            "total_deliveries": total_deliveries_local,
            "on_time_rate": on_time_rate_local,
            "avg_delivery_minutes": avg_delivery_minutes_local,
            "active_riders": active_by_day_local.get(to_d.isoformat(), 0),
            "attendance_rate": round(attendance_rate_local, 4),
            "payout_total_cents": payout_total_local,
        }

    # Attendance
    attendance_q = (
        db.query(Attendance, User)
        .join(User, Attendance.rider_id == User.id)
        .filter(Attendance.date >= from_date, Attendance.date <= to_date)
    )
    if rider_ids:
        attendance_q = attendance_q.filter(Attendance.rider_id.in_(rider_ids))
    attendance_rows = attendance_q.all()

    attendance_by_day = {d.isoformat(): {"present": 0, "late": 0, "absent": 0, "off_day": 0} for d in dates}
    attendance_totals = {"present": 0, "late": 0, "absent": 0, "off_day": 0}
    attendance_by_store: dict[str, dict[str, int]] = {}
    hourly_checkins = [0 for _ in range(24)]
    for a, u in attendance_rows:
        day = a.date.isoformat()
        if day not in attendance_by_day:
            continue
        status = a.status or ""
        if status not in attendance_by_day[day]:
            continue
        attendance_by_day[day][status] += 1
        attendance_totals[status] += 1
        if status in {"present", "late"} and a.created_at:
            hourly_checkins[a.created_at.hour] += 1
        store_key = (u.store or "Unassigned")
        if store_key not in attendance_by_store:
            attendance_by_store[store_key] = {"present": 0, "late": 0, "absent": 0, "off_day": 0}
        attendance_by_store[store_key][status] += 1

    total_attendance = sum(attendance_totals.values())
    attendance_rate = 0
    if total_attendance:
        attendance_rate = (attendance_totals["present"] + attendance_totals["late"]) / total_attendance

    # Deliveries
    end_expr = func.coalesce(Delivery.delivered_at, Delivery.canceled_at, Delivery.assigned_at, Delivery.created_at)
    deliveries_q = (
        db.query(Delivery, User)
        .join(User, Delivery.rider_id == User.id)
        .filter(end_expr >= start, end_expr <= end)
    )
    if rider_ids:
        deliveries_q = deliveries_q.filter(Delivery.rider_id.in_(rider_ids))
    deliveries = deliveries_q.all()

    deliveries_by_day = {d.isoformat(): 0 for d in dates}
    base_total = tip_total = bonus_total = 0
    total_deliveries = 0
    on_time_count = 0
    delivered_with_duration = 0
    total_duration = 0.0
    cancel_count = 0
    delivery_sla_breaches = 0
    delivery_sla_total = 0
    hourly_deliveries = [0 for _ in range(24)]

    per_rider = {}
    per_store = {}

    DELIVERY_SLA_MINUTES = 45
    AVAILABLE_SLA_MINUTES = 60
    for d, u in deliveries:
        total_deliveries += 1
        base_total += d.base_pay_cents or 0
        tip_total += d.tip_cents or 0
        bonus_total += d.bonus_cents or 0
        if d.status and "cancel" in d.status.lower():
            cancel_count += 1

        end_time = d.delivered_at or d.canceled_at or d.assigned_at or d.created_at
        if end_time:
            hourly_deliveries[end_time.hour] += 1
        day_key = end_time.date().isoformat() if end_time else None
        if day_key and day_key in deliveries_by_day:
            deliveries_by_day[day_key] += 1

        start_time = d.assigned_at or d.picked_up_at or d.created_at
        if start_time and d.delivered_at:
            delivery_sla_total += 1
            delivered_with_duration += 1
            duration_min = (d.delivered_at - start_time).total_seconds() / 60
            if duration_min >= 0:
                total_duration += duration_min
                if duration_min <= DELIVERY_SLA_MINUTES:
                    on_time_count += 1
                if duration_min > DELIVERY_SLA_MINUTES:
                    delivery_sla_breaches += 1

        rider_perf = per_rider.setdefault(d.rider_id, {"deliveries": 0, "durations": [], "on_time": 0, "delivered": 0, "cancel": 0})
        rider_perf["deliveries"] += 1
        if d.status and "cancel" in d.status.lower():
            rider_perf["cancel"] += 1
        if start_time and d.delivered_at:
            duration_min = max(0, (d.delivered_at - start_time).total_seconds() / 60)
            rider_perf["durations"].append(duration_min)
            rider_perf["delivered"] += 1
            if duration_min <= DELIVERY_SLA_MINUTES:
                rider_perf["on_time"] += 1

        store_key = (u.store or "Unassigned")
        store_perf = per_store.setdefault(store_key, {"deliveries": 0, "durations": []})
        store_perf["deliveries"] += 1
        if start_time and d.delivered_at:
            store_perf["durations"].append(max(0, (d.delivered_at - start_time).total_seconds() / 60))

    avg_delivery_minutes = round(total_duration / delivered_with_duration, 2) if delivered_with_duration else 0
    on_time_rate = round(on_time_count / delivered_with_duration, 4) if delivered_with_duration else 0

    # Status history and queue health
    status_q = (
        db.query(RiderStatus)
        .filter(RiderStatus.updated_at <= end)
    )
    if rider_ids:
        status_q = status_q.filter(RiderStatus.rider_id.in_(rider_ids))
    status_rows = status_q.order_by(RiderStatus.updated_at.asc(), RiderStatus.id.asc()).all()

    # active riders per day (end-of-day snapshot)
    active_by_day = {}
    current_status = {}
    idx = 0
    for day in dates:
        day_end = datetime.combine(day, time.max)
        while idx < len(status_rows) and status_rows[idx].updated_at <= day_end:
            current_status[status_rows[idx].rider_id] = status_rows[idx].status
            idx += 1
        active_by_day[day.isoformat()] = sum(1 for s in current_status.values() if s != "offline")

    # queue health
    available_durations = []
    current_status = {}
    last_time = {}
    available_count = 0
    max_available = 0
    for s in status_rows:
        rid = s.rider_id
        t = s.updated_at or datetime.utcnow()
        prev_status = current_status.get(rid)
        prev_time = last_time.get(rid)

        if prev_status == "available" and prev_time:
            dur_start = max(prev_time, start)
            dur_end = min(t, end)
            if dur_end > dur_start:
                available_durations.append((dur_end - dur_start).total_seconds() / 60)

        if t < start:
            if prev_status == "available":
                available_count -= 1
            current_status[rid] = s.status
            last_time[rid] = t
            if s.status == "available":
                available_count += 1
            continue

        if t > end:
            break

        if prev_status == "available":
            available_count -= 1
        current_status[rid] = s.status
        last_time[rid] = t
        if s.status == "available":
            available_count += 1
        if available_count > max_available:
            max_available = available_count

    for rid, status in current_status.items():
        if status == "available":
            start_time = last_time.get(rid)
            if start_time:
                dur_start = max(start_time, start)
                dur_end = end
                if dur_end > dur_start:
                    available_durations.append((dur_end - dur_start).total_seconds() / 60)

    avg_available = round(sum(available_durations) / len(available_durations), 2) if available_durations else 0
    p95_available = round(_percentile(available_durations, 95), 2) if available_durations else 0
    queue_wait_breaches = sum(1 for d in available_durations if d > AVAILABLE_SLA_MINUTES)

    # stale rider rate (current)
    location_q = db.query(RiderCurrentLocation)
    if rider_ids:
        location_q = location_q.filter(RiderCurrentLocation.rider_id.in_(rider_ids))
    locations = location_q.all()
    stale_count = 0
    now = datetime.utcnow()
    for loc in locations:
        if loc.updated_at and now - loc.updated_at > timedelta(minutes=LOCATION_STALE_MINUTES):
            stale_count += 1
    stale_rate = (stale_count / len(locations)) if locations else 0

    # geofence alerts
    alert_q = db.query(LocationAlert).filter(LocationAlert.created_at >= start, LocationAlert.created_at <= end)
    if rider_ids:
        alert_q = alert_q.filter(LocationAlert.rider_id.in_(rider_ids))
    alerts = alert_q.all()
    entries = exits = 0
    geofence_by_day = {d.isoformat(): {"entries": 0, "exits": 0} for d in dates}
    for a in alerts:
        msg = (a.message or "").lower()
        day_key = a.created_at.date().isoformat() if a.created_at else None
        if "entered" in msg:
            entries += 1
            if day_key in geofence_by_day:
                geofence_by_day[day_key]["entries"] += 1
        if "exited" in msg:
            exits += 1
            if day_key in geofence_by_day:
                geofence_by_day[day_key]["exits"] += 1

    # Rider performance
    perf_rows = []
    for rid, perf in per_rider.items():
        r = rider_map.get(rid)
        if not r:
            continue
        delivered = perf["delivered"]
        avg_time = round(sum(perf["durations"]) / delivered, 2) if delivered else 0
        on_time_rate_r = round((perf["on_time"] / delivered), 4) if delivered else 0
        cancel_rate_r = round((perf["cancel"] / perf["deliveries"]), 4) if perf["deliveries"] else 0
        perf_rows.append(
            {
                "rider_id": rid,
                "name": r.name,
                "store": r.store,
                "deliveries": perf["deliveries"],
                "on_time_rate": on_time_rate_r,
                "avg_delivery_minutes": avg_time,
                "cancel_rate": cancel_rate_r,
            }
        )

    top_perf = sorted(perf_rows, key=lambda x: (-x["deliveries"], -x["on_time_rate"]))[:5]
    bottom_perf = [p for p in perf_rows if p["deliveries"] > 0]
    bottom_perf = sorted(bottom_perf, key=lambda x: (x["on_time_rate"], -x["deliveries"]))[:5]

    # Store comparison
    store_rows = []
    store_keys = set(per_store.keys()) | set(attendance_by_store.keys())
    for store_name in sorted(store_keys):
        stats = per_store.get(store_name, {"deliveries": 0, "durations": []})
        dur_list = stats["durations"]
        avg_time = round(sum(dur_list) / len(dur_list), 2) if dur_list else 0
        attendance_stats = attendance_by_store.get(store_name, {"present": 0, "late": 0, "absent": 0, "off_day": 0})
        total_att = sum(attendance_stats.values())
        rate = ((attendance_stats["present"] + attendance_stats["late"]) / total_att) if total_att else 0
        active_riders = 0
        for rid, r in rider_map.items():
            if (r.store or "Unassigned") == store_name:
                status_val = current_status.get(rid)
                if status_val and status_val != "offline":
                    active_riders += 1
        store_rows.append(
            {
                "store": store_name,
                "deliveries": stats["deliveries"],
                "avg_delivery_minutes": avg_time,
                "active_riders": active_riders,
                "attendance_rate": round(rate, 4) if total_att else 0,
            }
        )

    payout_total = base_total + tip_total + bonus_total
    avg_per_delivery = int(round(payout_total / total_deliveries)) if total_deliveries else 0

    store_stats_map = {row["store"]: row for row in store_rows}
    captain_q = db.query(User).filter(User.role == "captain")
    if store:
        captain_q = captain_q.filter(func.lower(User.store) == store.lower())
    captains = captain_q.order_by(User.name.asc()).all()
    captain_rows = []
    for c in captains:
        store_key = c.store or "Unassigned"
        stats = store_stats_map.get(
            store_key,
            {
                "deliveries": 0,
                "avg_delivery_minutes": 0,
                "active_riders": 0,
                "attendance_rate": 0,
            },
        )
        captain_rows.append(
            {
                "captain": c.name,
                "store": store_key,
                "deliveries": stats["deliveries"],
                "avg_delivery_minutes": stats["avg_delivery_minutes"],
                "active_riders": stats["active_riders"],
                "attendance_rate": stats["attendance_rate"],
            }
        )

    previous_kpis = _compute_kpis_only(prev_start, prev_end, prev_from, prev_to)

    latest_status_at = None
    latest_location_at = None
    latest_delivery_at = None
    latest_attendance_at = None
    status_max_q = db.query(func.max(RiderStatus.updated_at))
    location_max_q = db.query(func.max(RiderCurrentLocation.updated_at))
    delivery_max_q = db.query(func.max(end_expr))
    attendance_max_q = db.query(func.max(Attendance.created_at))
    if rider_ids:
        status_max_q = status_max_q.filter(RiderStatus.rider_id.in_(rider_ids))
        location_max_q = location_max_q.filter(RiderCurrentLocation.rider_id.in_(rider_ids))
        delivery_max_q = delivery_max_q.filter(Delivery.rider_id.in_(rider_ids))
        attendance_max_q = attendance_max_q.filter(Attendance.rider_id.in_(rider_ids))
    latest_status_at = status_max_q.scalar()
    latest_location_at = location_max_q.scalar()
    latest_delivery_at = delivery_max_q.scalar()
    latest_attendance_at = attendance_max_q.scalar()

    return {
        "range": {"from": from_date.isoformat(), "to": to_date.isoformat()},
        "previous_range": {"from": prev_from.isoformat(), "to": prev_to.isoformat()},
        "kpis": {
            "total_deliveries": total_deliveries,
            "on_time_rate": on_time_rate,
            "avg_delivery_minutes": avg_delivery_minutes,
            "active_riders": active_by_day.get(to_date.isoformat(), 0),
            "attendance_rate": round(attendance_rate, 4),
            "payout_total_cents": payout_total,
        },
        "previous": {"kpis": previous_kpis},
        "trends": {
            "deliveries": [{"date": d, "count": deliveries_by_day[d]} for d in deliveries_by_day],
            "attendance": [{"date": d, **attendance_by_day[d]} for d in attendance_by_day],
            "active_riders": [{"date": d, "count": active_by_day[d]} for d in active_by_day],
            "late_checkins": [{"date": d, "count": attendance_by_day[d]["late"]} for d in attendance_by_day],
        },
        "rider_performance": {"top": top_perf, "bottom": bottom_perf},
        "store_comparison": store_rows,
        "captain_comparison": captain_rows,
        "queue_health": {
            "avg_available_minutes": avg_available,
            "p95_available_minutes": p95_available,
            "peak_waiting": max_available,
            "stale_rider_rate": round(stale_rate, 4),
            "samples": len(available_durations),
        },
        "sla": {
            "delivery_breaches": delivery_sla_breaches,
            "delivery_total": delivery_sla_total,
            "queue_wait_breaches": queue_wait_breaches,
        },
        "geofence": {
            "entries": entries,
            "exits": exits,
            "by_day": [{"date": d, **geofence_by_day[d]} for d in geofence_by_day],
        },
        "payouts": {
            "base_cents": base_total,
            "tip_cents": tip_total,
            "bonus_cents": bonus_total,
            "total_cents": payout_total,
            "avg_per_delivery_cents": avg_per_delivery,
        },
        "hourly": {
            "deliveries": [{"hour": idx, "count": hourly_deliveries[idx]} for idx in range(24)],
            "checkins": [{"hour": idx, "count": hourly_checkins[idx]} for idx in range(24)],
        },
        "freshness": {
            "latest_status_at": latest_status_at.isoformat() if latest_status_at else None,
            "latest_location_at": latest_location_at.isoformat() if latest_location_at else None,
            "latest_delivery_at": latest_delivery_at.isoformat() if latest_delivery_at else None,
            "latest_attendance_at": latest_attendance_at.isoformat() if latest_attendance_at else None,
        },
    }


@router.get("/stores")
def list_stores(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    counts = dict(
        db.query(func.lower(User.store), func.count(User.id))
        .filter(User.store.isnot(None))
        .filter(User.role == "rider")
        .group_by(func.lower(User.store))
        .all()
    )
    stores = db.query(Store).order_by(Store.name.asc()).all()
    store_ids = [s.id for s in stores]
    store_names = [s.name.lower() for s in stores if s.name]
    geofences = []
    conditions = []
    if store_ids:
        conditions.append(Geofence.store_id.in_(store_ids))
    if store_names:
        conditions.append(func.lower(Geofence.store).in_(store_names))
    if conditions:
        geofences = db.query(Geofence).filter(or_(*conditions)).all()
    gf_by_store_id = {g.store_id: g for g in geofences if g.store_id}
    gf_by_name = {g.store.lower(): g for g in geofences if g.store}
    return [
        {
            "id": s.id,
            "name": s.name,
            "code": s.code,
            "is_active": s.is_active,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "rider_count": counts.get(s.name.lower(), 0) if s.name else 0,
            "rider_limit": s.rider_limit,
            "default_base_pay_cents": s.default_base_pay_cents or 0,
            "geofence_id": (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower())).id
            if s.name and (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower()))
            else None,
            "lat": (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower())).lat
            if s.name and (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower()))
            else None,
            "lng": (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower())).lng
            if s.name and (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower()))
            else None,
            "radius_m": (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower())).radius_m
            if s.name and (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower()))
            else None,
            "geofence_active": (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower())).is_active
            if s.name and (gf_by_store_id.get(s.id) or gf_by_name.get(s.name.lower()))
            else None,
        }
        for s in stores
    ]


@router.post("/stores")
def create_store(
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    name = str(data.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Store name is required")

    code = data.get("code")
    code = str(code).strip() if code is not None and str(code).strip() else None

    existing_name = (
        db.query(Store)
        .filter(func.lower(Store.name) == name.lower())
        .first()
    )
    if existing_name:
        raise HTTPException(status_code=409, detail="Store name already exists")

    if code:
        existing_code = db.query(Store).filter(Store.code == code).first()
        if existing_code:
            raise HTTPException(status_code=409, detail="Store code already exists")

    default_base_pay_cents = data.get("default_base_pay_cents")
    default_base_pay = data.get("default_base_pay")
    if default_base_pay_cents is None and default_base_pay is not None:
        try:
            raw = str(default_base_pay).replace("$", "").replace(",", "").strip()
            amount = float(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="default_base_pay must be a number")
        if amount < 0:
            raise HTTPException(status_code=400, detail="default_base_pay must be >= 0")
        default_base_pay_cents = int(round(amount * 100))
    if default_base_pay_cents is None:
        default_base_pay_cents = 0
    try:
        default_base_pay_cents = int(default_base_pay_cents)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="default_base_pay_cents must be a number")
    if default_base_pay_cents < 0:
        raise HTTPException(status_code=400, detail="default_base_pay_cents must be >= 0")

    rider_limit = data.get("rider_limit")
    if rider_limit is None or str(rider_limit).strip() == "":
        rider_limit_value = None
    else:
        try:
            rider_limit_value = int(rider_limit)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="rider_limit must be a number")
        if rider_limit_value < 0:
            raise HTTPException(status_code=400, detail="rider_limit must be >= 0")

    store = Store(
        name=name,
        code=code,
        is_active=True,
        default_base_pay_cents=default_base_pay_cents,
        rider_limit=rider_limit_value,
    )
    db.add(store)
    db.flush()

    geofence_id = None
    if any(k in data for k in ["lat", "lng", "radius_m"]):
        if "lat" not in data or "lng" not in data:
            raise HTTPException(status_code=400, detail="lat and lng are required for store location")
        try:
            lat = float(data["lat"])
            lng = float(data["lng"])
            radius_m = float(data.get("radius_m", 1000))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="lat, lng, and radius_m must be numbers")
        if radius_m <= 0:
            raise HTTPException(status_code=400, detail="radius_m must be greater than 0")

        gf = Geofence(
            name=f"{name} Store",
            store=name,
            store_id=store.id,
            lat=lat,
            lng=lng,
            radius_m=radius_m,
            is_active=True,
        )
        db.add(gf)
        db.flush()
        geofence_id = gf.id
        _log_action(
            db,
            admin,
            action="Created geofence",
            entity_type="geofence",
            entity_id=gf.id,
            details={"name": gf.name, "store": gf.store, "radius_m": gf.radius_m},
        )

    _log_action(
        db,
        admin,
        action="Created store",
        entity_type="store",
        entity_id=store.id,
        details={
            "name": store.name,
            "code": store.code,
            "geofence_id": geofence_id,
            "default_base_pay_cents": default_base_pay_cents,
            "rider_limit": rider_limit_value,
        },
    )
    db.commit()
    return {"id": store.id, "geofence_id": geofence_id, "message": "Store created"}


@router.patch("/stores/{store_id}/location")
def update_store_location(
    store_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")

    if "lat" not in data or "lng" not in data:
        raise HTTPException(status_code=400, detail="lat and lng are required for store location")
    try:
        lat = float(data["lat"])
        lng = float(data["lng"])
        radius_m = float(data.get("radius_m", 1000))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="lat, lng, and radius_m must be numbers")
    if radius_m <= 0:
        raise HTTPException(status_code=400, detail="radius_m must be greater than 0")

    gf = (
        db.query(Geofence)
        .filter(Geofence.store_id == store.id)
        .first()
    )
    if not gf and store.name:
        gf = (
            db.query(Geofence)
            .filter(func.lower(Geofence.store) == store.name.lower())
            .first()
        )

    if gf:
        gf.lat = lat
        gf.lng = lng
        gf.radius_m = radius_m
        gf.store_id = store.id
        gf.store = store.name
        gf.is_active = True
    else:
        gf = Geofence(
            name=f"{store.name} Store",
            store=store.name,
            store_id=store.id,
            lat=lat,
            lng=lng,
            radius_m=radius_m,
            is_active=True,
        )
        db.add(gf)

    _log_action(
        db,
        admin,
        action="Updated store location",
        entity_type="store",
        entity_id=store.id,
        details={"lat": lat, "lng": lng, "radius_m": radius_m, "geofence_id": gf.id},
    )
    db.commit()
    return {"message": "Store location updated", "geofence_id": gf.id}


@router.patch("/stores/{store_id}/pricing")
def update_store_pricing(
    store_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    base_pay_cents = data.get("default_base_pay_cents")
    base_pay = data.get("default_base_pay")
    if base_pay_cents is None and base_pay is not None:
        try:
            raw = str(base_pay).replace("$", "").replace(",", "").strip()
            amount = float(raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="default_base_pay must be a number")
        if amount < 0:
            raise HTTPException(status_code=400, detail="default_base_pay must be >= 0")
        base_pay_cents = int(round(amount * 100))
    if base_pay_cents is None:
        raise HTTPException(status_code=400, detail="default_base_pay_cents is required")
    try:
        base_pay_cents = int(base_pay_cents)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="default_base_pay_cents must be a number")
    if base_pay_cents < 0:
        raise HTTPException(status_code=400, detail="default_base_pay_cents must be >= 0")

    store.default_base_pay_cents = base_pay_cents
    _log_action(
        db,
        admin,
        action="Updated store pricing",
        entity_type="store",
        entity_id=store.id,
        details={"default_base_pay_cents": base_pay_cents},
    )
    db.commit()
    return {"message": "Store pricing updated", "default_base_pay_cents": base_pay_cents}


@router.patch("/stores/{store_id}/limit")
def update_store_limit(
    store_id: int,
    data: dict,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    if "rider_limit" not in data:
        raise HTTPException(status_code=400, detail="rider_limit is required (use null to clear)")

    limit_value = data.get("rider_limit")
    if limit_value is None or str(limit_value).strip() == "":
        store.rider_limit = None
    else:
        try:
            parsed = int(limit_value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="rider_limit must be a number")
        if parsed < 0:
            raise HTTPException(status_code=400, detail="rider_limit must be >= 0")
        store.rider_limit = parsed

    _log_action(
        db,
        admin,
        action="Updated store rider limit",
        entity_type="store",
        entity_id=store.id,
        details={"rider_limit": store.rider_limit},
    )
    db.commit()
    return {"message": "Store rider limit updated", "rider_limit": store.rider_limit}


@router.delete("/stores/{store_id}")
def delete_store(
    store_id: int,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    store = db.query(Store).filter(Store.id == store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")

    _log_action(
        db,
        admin,
        action="Deleted store",
        entity_type="store",
        entity_id=store.id,
        details={"name": store.name},
    )
    affected = (
        db.query(User)
        .filter(func.lower(User.store) == store.name.lower())
        .update({User.store: None}, synchronize_session=False)
    )

    geofences_deleted = (
        db.query(Geofence)
        .filter(func.lower(Geofence.store) == store.name.lower())
        .delete(synchronize_session=False)
    )

    db.delete(store)
    db.commit()
    return {"message": "Store deleted", "riders_cleared": affected, "geofences_deleted": geofences_deleted}
