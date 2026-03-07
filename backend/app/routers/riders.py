from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from datetime import datetime, timedelta, time
import math
from app.database import SessionLocal
from app.models import RiderStatus, User, Geofence, RiderCurrentLocation, RiderLocation, Delivery, Store
from app.schemas import RiderStatusUpdate
from app.auth.deps import rider_only
from app.config import MAX_LOCATION_ACCURACY_M, LOCATION_STALE_MINUTES, BREAKS_PER_DAY

router = APIRouter(prefix="/rider", tags=["Rider"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _get_latest_location(db: Session, rider_id: int):
    current = (
        db.query(RiderCurrentLocation)
        .filter(RiderCurrentLocation.rider_id == rider_id)
        .first()
    )
    if current:
        return current.lat, current.lng, current.accuracy_m, current.updated_at
    last = (
        db.query(RiderLocation)
        .filter(RiderLocation.rider_id == rider_id)
        .order_by(RiderLocation.updated_at.desc(), RiderLocation.id.desc())
        .first()
    )
    if last:
        return last.lat, last.lng, None, last.updated_at
    return None


def _breaks_today(db: Session, rider_id: int) -> int:
    today = datetime.utcnow().date()
    start = datetime.combine(today, time.min)
    end = datetime.combine(today + timedelta(days=1), time.min)
    return (
        db.query(RiderStatus)
        .filter(RiderStatus.rider_id == rider_id)
        .filter(RiderStatus.status == "break")
        .filter(RiderStatus.updated_at >= start, RiderStatus.updated_at < end)
        .count()
    )


def _default_base_pay_cents(db: Session, rider: User) -> int:
    store_name = (getattr(rider, "store", None) or "").strip()
    if not store_name:
        return 0
    store = (
        db.query(Store)
        .filter(func.lower(Store.name) == store_name.lower())
        .first()
    )
    if not store:
        return 0
    return int(store.default_base_pay_cents or 0)


def _create_delivery_record(db: Session, rider: User) -> None:
    store_name = (getattr(rider, "store", None) or "").strip()
    store = None
    if store_name:
        store = (
            db.query(Store)
            .filter(func.lower(Store.name) == store_name.lower())
            .first()
        )
    db.add(
        Delivery(
            rider_id=rider.id,
            store_id=store.id if store else None,
            status="delivery",
            assigned_at=datetime.utcnow(),
            base_pay_cents=_default_base_pay_cents(db, rider),
            tip_cents=0,
            bonus_cents=0,
        )
    )

@router.post("/status")
def update_status(
    data: RiderStatusUpdate,
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    latest = (
        db.query(RiderStatus)
        .filter(RiderStatus.rider_id == rider.id)
        .order_by(RiderStatus.updated_at.desc(), RiderStatus.id.desc())
        .first()
    )

    if data.status == "break":
        if latest and latest.status == "break":
            return {"status": "updated"}
        if _breaks_today(db, rider.id) >= BREAKS_PER_DAY:
            raise HTTPException(status_code=400, detail=f"Break limit reached ({BREAKS_PER_DAY} per day).")

    if data.status == "delivery":
        if not latest or latest.status != "delivery":
            _create_delivery_record(db, rider)

    if data.status == "available":
        store = (getattr(rider, "store", None) or "").strip()
        if not store:
            raise HTTPException(status_code=400, detail="Store not set for this rider")

        geofences = (
            db.query(Geofence)
            .filter(Geofence.store.isnot(None))
            .filter(or_(Geofence.is_active == True, Geofence.is_active.is_(None)))  # noqa: E712
            .all()
        )
        relevant = [g for g in geofences if (g.store or "").strip().lower() == store.lower()]
        if not relevant:
            raise HTTPException(status_code=400, detail="Store location not configured. Ask admin to add a geofence.")

        coords = _get_latest_location(db, rider.id)
        if not coords:
            raise HTTPException(status_code=400, detail="Location required to go available")
        lat, lng, accuracy_m, updated_at = coords
        if updated_at and datetime.utcnow() - updated_at > timedelta(minutes=LOCATION_STALE_MINUTES):
            raise HTTPException(status_code=400, detail="Location is too old. Please refresh your location.")
        if accuracy_m is not None and accuracy_m > MAX_LOCATION_ACCURACY_M:
            raise HTTPException(
                status_code=400,
                detail=f"Location accuracy too low ({int(round(accuracy_m))}m). Move to an open area and try again.",
            )

        closest = None
        for g in relevant:
            dist = _haversine_m(lat, lng, g.lat, g.lng)
            radius = g.radius_m or 0
            if closest is None or dist < closest["distance_m"]:
                closest = {"geofence": g, "distance_m": dist, "radius_m": radius}

        within = False
        if closest:
            within = closest["distance_m"] <= (closest["radius_m"] or 0)
        if not within:
            if closest:
                dist = int(round(closest["distance_m"]))
                radius = int(round(closest["radius_m"] or 0))
                label = closest["geofence"].name or store
                raise HTTPException(
                    status_code=403,
                    detail=f"You must be within {radius}m of {label} to go available (you are about {dist}m away).",
                )
            raise HTTPException(status_code=403, detail="You must be within your store geofence to go available")

    status = RiderStatus(
        rider_id=rider.id,
        status=data.status,
        updated_at=datetime.utcnow()
    )
    db.add(status)
    db.commit()
    return {"status": "updated"}


@router.get("/queue")
def rider_queue(
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    """
    Return the latest status for the current rider plus the available queue ordered by
    when riders became available (oldest first).
    """
    # Latest status per rider
    rows = (
        db.query(RiderStatus)
        .order_by(RiderStatus.rider_id, RiderStatus.updated_at.desc())
        .all()
    )
    latest: dict[int, RiderStatus] = {}
    previous: dict[int, RiderStatus] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r
        elif r.rider_id not in previous:
            previous[r.rider_id] = r

    rider_ids = list(latest.keys())
    users = (
        db.query(User)
        .filter(User.id.in_(rider_ids) if rider_ids else False)
        .all()
    )
    user_map = {u.id: u for u in users}
    current_store = getattr(rider, "store", None)

    queue = []
    for rider_id, status in latest.items():
        u = user_map.get(rider_id)
        store_matches = (getattr(u, "store", None) == current_store)
        if status.status == "available" and store_matches:
            prev = previous.get(rider_id)
            priority = 0 if (prev and prev.status == "break") else 1
            queue.append(
                {
                    "rider_id": rider_id,
                    "name": u.name if u else f"Rider {rider_id}",
                    "updated_at": status.updated_at,
                    "store": getattr(u, "store", None),
                    "priority": priority,
                }
            )

    # Break returners first, then oldest available
    queue.sort(key=lambda x: (x["priority"], x["updated_at"] or datetime.utcnow()))

    # Current rider status
    self_status = latest.get(rider.id).status if rider.id in latest else "offline"
    breaks_used = _breaks_today(db, rider.id)
    breaks_limit = BREAKS_PER_DAY
    breaks_remaining = max(0, breaks_limit - breaks_used)

    # Position in queue (1-based)
    position = None
    for idx, item in enumerate(queue):
        if item["rider_id"] == rider.id:
            position = idx + 1
            break

    # Serialize datetime
    for item in queue:
        item.pop("priority", None)
        if item["updated_at"]:
            item["updated_at"] = item["updated_at"].isoformat()

    return {
        "status": self_status,
        "queue": queue,
        "position": position,
        "total_waiting": len(queue),
        "breaks_used": breaks_used,
        "breaks_limit": breaks_limit,
        "breaks_remaining": breaks_remaining,
    }
