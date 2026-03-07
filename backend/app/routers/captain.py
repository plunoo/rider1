from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, date

from app.database import SessionLocal
from app.models import User, RiderStatus, Store, Notification, AuditLog, Attendance, Shift, RiderLocation
from app.auth.deps import captain_only

router = APIRouter(prefix="/captain", tags=["Captain"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


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


def _latest_status_map(db: Session):
    rows = (
        db.query(RiderStatus)
        .order_by(RiderStatus.rider_id, RiderStatus.updated_at.desc())
        .all()
    )
    latest: dict[int, RiderStatus] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r
    return latest


def _serialize_rider(rider: User, latest: dict[int, RiderStatus]):
    status_row = latest.get(rider.id)
    return {
        "id": rider.id,
        "username": rider.username,
        "name": rider.name,
        "store": getattr(rider, "store", None),
        "status": status_row.status if status_row else "offline",
        "updated_at": status_row.updated_at.isoformat() if status_row else None,
        "is_active": rider.is_active,
    }


def _get_store_or_400(db: Session, store: str):
    store_row = (
        db.query(Store)
        .filter(func.lower(Store.name) == store.lower())
        .first()
    )
    if not store_row:
        raise HTTPException(status_code=400, detail="Store not found")
    return store_row


def _find_rider(db: Session, data: dict):
    rider = None
    if "rider_id" in data or "id" in data:
        value = data.get("rider_id") if "rider_id" in data else data.get("id")
        try:
            rider_id = int(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="rider_id must be a number")
        rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    elif "username" in data:
        username = str(data.get("username", "")).strip()
        if not username:
            raise HTTPException(status_code=400, detail="username is required")
        rider = db.query(User).filter(User.username == username, User.role == "rider").first()
    else:
        raise HTTPException(status_code=400, detail="rider_id or username is required")
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    return rider


@router.get("/roster")
def roster(
    include_unassigned: bool = Query(False),
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    riders = (
        db.query(User)
        .filter(User.role == "rider")
        .filter(func.lower(User.store) == store.lower())
        .all()
    )
    latest = _latest_status_map(db)
    items = [_serialize_rider(r, latest) for r in riders]

    payload = {"items": items, "store": store}
    if include_unassigned:
        unassigned = (
            db.query(User)
            .filter(User.role == "rider")
            .filter(User.store.is_(None))
            .all()
        )
        payload["unassigned"] = [_serialize_rider(r, latest) for r in unassigned]
    payload["updated_at"] = datetime.utcnow().isoformat()
    return payload


@router.post("/roster/add")
def add_to_roster(
    data: dict,
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    rider = _find_rider(db, data)
    if rider.store and (rider.store or "").strip().lower() != store.lower():
        raise HTTPException(status_code=403, detail="Rider belongs to another store")

    rider.store = store
    _log_action(
        db,
        captain,
        action="Captain added rider to store",
        entity_type="user",
        entity_id=rider.id,
        details={"store": store},
    )
    _notify_user(
        db,
        rider.id,
        "Store assignment updated",
        f"You have been assigned to {store}.",
        kind="account",
        link="/rider",
    )
    db.commit()
    return {"message": "Rider added to store"}


@router.post("/roster/remove")
def remove_from_roster(
    data: dict,
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    rider = _find_rider(db, data)
    if not rider.store or (rider.store or "").strip().lower() != store.lower():
        raise HTTPException(status_code=403, detail="Rider is not in your store")

    rider.store = None
    _log_action(
        db,
        captain,
        action="Captain removed rider from store",
        entity_type="user",
        entity_id=rider.id,
        details={"store": store},
    )
    _notify_user(
        db,
        rider.id,
        "Store assignment updated",
        f"You have been removed from {store}.",
        kind="account",
        link="/rider",
    )
    db.commit()
    return {"message": "Rider removed from store"}


@router.post("/riders/{rider_id}/remove-from-queue")
def remove_from_queue(
    rider_id: int,
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if (rider.store or "").strip().lower() != store.lower():
        raise HTTPException(status_code=403, detail="Rider is not in your store")

    db.add(
        RiderStatus(
            rider_id=rider.id,
            status="offline",
            updated_at=datetime.utcnow(),
        )
    )
    _log_action(
        db,
        captain,
        action="Captain removed rider from queue",
        entity_type="rider_status",
        entity_id=rider.id,
        details={"status": "offline", "store": store},
    )
    _notify_user(
        db,
        rider.id,
        "Queue update",
        f"Your status was set to offline by your store captain for {store}.",
        kind="status",
        link="/rider",
    )
    db.commit()
    return {"message": "Rider removed from queue", "status": "offline"}


@router.patch("/riders/{rider_id}/activation")
def update_rider_activation(
    rider_id: int,
    data: dict,
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if (rider.store or "").strip().lower() != store.lower():
        raise HTTPException(status_code=403, detail="Rider is not in your store")
    if "is_active" not in data:
        raise HTTPException(status_code=400, detail="is_active is required")

    prev_active = rider.is_active
    rider.is_active = bool(data.get("is_active"))
    action = "Captain updated rider activation"
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
        captain,
        action=action,
        entity_type="user",
        entity_id=rider.id,
        details={"is_active": rider.is_active, "store": store},
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


@router.delete("/riders/{rider_id}")
def reject_rider(
    rider_id: int,
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if (rider.store or "").strip().lower() != store.lower():
        raise HTTPException(status_code=403, detail="Rider is not in your store")
    if rider.is_active is not False:
        raise HTTPException(status_code=400, detail="Only pending riders can be rejected")

    _log_action(
        db,
        captain,
        action="Rejected rider registration",
        entity_type="user",
        entity_id=rider.id,
        details={"store": store, "username": rider.username},
    )

    db.query(RiderStatus).filter(RiderStatus.rider_id == rider.id).delete(synchronize_session=False)
    db.query(Attendance).filter(Attendance.rider_id == rider.id).delete(synchronize_session=False)
    db.query(Shift).filter(Shift.rider_id == rider.id).delete(synchronize_session=False)
    db.query(RiderLocation).filter(RiderLocation.rider_id == rider.id).delete(synchronize_session=False)
    db.delete(rider)
    db.commit()
    return {"message": "Rider rejected"}


@router.get("/riders/approvals")
def rider_approvals(
    rider_ids: str = Query(..., description="Comma-separated rider IDs"),
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

    raw_ids = [s.strip() for s in rider_ids.split(",") if s.strip()]
    ids: list[int] = []
    for value in raw_ids:
        if value.isdigit():
            ids.append(int(value))
    ids = list(dict.fromkeys(ids))
    if not ids:
        return {"items": []}

    allowed = (
        db.query(User.id)
        .filter(User.role == "rider")
        .filter(func.lower(User.store) == store.lower())
        .filter(User.id.in_(ids))
        .all()
    )
    allowed_ids = [row[0] for row in allowed]
    if not allowed_ids:
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
        .filter(AuditLog.entity_type == "user", AuditLog.entity_id.in_(allowed_ids))
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
        for rid in allowed_ids
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


@router.get("/attendance")
def list_attendance(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

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
        .filter(User.role == "rider")
        .filter(func.lower(User.store) == store.lower())
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
def mark_attendance_captain(
    data: dict,
    db: Session = Depends(get_db),
    captain=Depends(captain_only)
):
    store = (getattr(captain, "store", None) or "").strip()
    if not store:
        raise HTTPException(status_code=400, detail="Store not set for this captain")
    _get_store_or_400(db, store)

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

    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if not rider:
        raise HTTPException(status_code=404, detail="Rider not found")
    if (rider.store or "").strip().lower() != store.lower():
        raise HTTPException(status_code=403, detail="Rider is not in your store")

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
        captain,
        action="Marked attendance",
        entity_type="attendance",
        entity_id=existing.id if existing else None,
        details={"rider_id": rider_id, "date": mark_date.isoformat(), "status": status, "store": store},
    )

    db.commit()
    return {"message": "Attendance marked"}
