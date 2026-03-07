from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from datetime import datetime, date, time, timedelta
import math
import json
import asyncio
import csv
from io import StringIO
from fastapi.responses import StreamingResponse, Response

from app.database import SessionLocal
from app.models import RiderStatus, RiderLocation, RiderCurrentLocation, Geofence, LocationAlert, User, Notification, AuditLog, Delivery, Store
from app.schemas import RiderStatusUpdate
from app.auth.deps import rider_only, admin_only
from app.config import (
    LOCATION_RETENTION_DAYS,
    JWT_SECRET,
    JWT_ALGORITHM,
    MAX_LOCATION_ACCURACY_M,
    MAX_LOCATION_SPEED_MPS,
    LOCATION_STALE_MINUTES,
    BREAKS_PER_DAY,
    AUTO_DELIVERY_DISTANCE_M,
)
from jose import jwt, JWTError

router = APIRouter(prefix="/tracking", tags=["Tracking"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # Returns distance in meters between two lat/lng points.
    r = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _coords_valid(lat: float, lng: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lng <= 180


def _stale_info(value: datetime | None) -> tuple[int | None, bool]:
    if not value:
        return None, False
    age_min = int(max(0, (datetime.utcnow() - value).total_seconds() / 60))
    return age_min, age_min > LOCATION_STALE_MINUTES


def _closest_geofence(lat: float, lng: float, geofences: list[Geofence]):
    closest = None
    for g in geofences:
        dist = _haversine_m(lat, lng, g.lat, g.lng)
        radius = g.radius_m or 0
        if closest is None or dist < closest["distance_m"]:
            closest = {"geofence": g, "distance_m": dist, "radius_m": radius}
    return closest


def _latest_status_map(db: Session, rider_ids: list[int]):
    if not rider_ids:
        return {}
    rows = (
        db.query(RiderStatus)
        .filter(RiderStatus.rider_id.in_(rider_ids))
        .order_by(RiderStatus.rider_id, RiderStatus.updated_at.desc(), RiderStatus.id.desc())
        .all()
    )
    latest: dict[int, RiderStatus] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r
    return latest


def _user_map(db: Session, rider_ids: list[int]):
    if not rider_ids:
        return {}
    users = db.query(User).filter(User.id.in_(rider_ids)).all()
    return {u.id: u for u in users}


def _speed_map(db: Session, rider_ids: list[int]):
    if not rider_ids:
        return {}
    rows = (
        db.query(RiderLocation)
        .filter(RiderLocation.rider_id.in_(rider_ids))
        .order_by(RiderLocation.rider_id, RiderLocation.updated_at.desc(), RiderLocation.id.desc())
        .all()
    )
    latest: dict[int, RiderLocation] = {}
    speeds: dict[int, float] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r
        elif r.rider_id not in speeds:
            prev = latest[r.rider_id]
            if prev.updated_at and r.updated_at:
                dt = (prev.updated_at - r.updated_at).total_seconds()
                if dt > 0:
                    dist = _haversine_m(prev.lat, prev.lng, r.lat, r.lng)
                    speeds[r.rider_id] = round(dist / dt, 2)
    return speeds


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


# ---------- RIDER SET STATUS ----------
@router.post("/status")
def set_status(
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

        current = (
            db.query(RiderCurrentLocation)
            .filter(RiderCurrentLocation.rider_id == rider.id)
            .first()
        )
        if current is None:
            last = (
                db.query(RiderLocation)
                .filter(RiderLocation.rider_id == rider.id)
                .order_by(RiderLocation.updated_at.desc(), RiderLocation.id.desc())
                .first()
            )
            if not last:
                raise HTTPException(status_code=400, detail="Location required to go available")
            lat, lng = last.lat, last.lng
            accuracy_m = None
            updated_at = last.updated_at
        else:
            lat, lng = current.lat, current.lng
            accuracy_m = current.accuracy_m
            updated_at = current.updated_at

        if updated_at and datetime.utcnow() - updated_at > timedelta(minutes=LOCATION_STALE_MINUTES):
            raise HTTPException(status_code=400, detail="Location is too old. Please refresh your location.")
        if accuracy_m is not None and accuracy_m > MAX_LOCATION_ACCURACY_M:
            raise HTTPException(
                status_code=400,
                detail=f"Location accuracy too low ({int(round(accuracy_m))}m). Move to an open area and try again.",
            )

        closest = _closest_geofence(lat, lng, relevant)
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


# ---------- RIDER UPDATE LOCATION ----------
@router.post("/location")
def update_location(
    lat: float,
    lng: float,
    accuracy_m: float | None = None,
    speed_mps: float | None = None,
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    if not _coords_valid(lat, lng):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    accuracy_ok = accuracy_m is None or accuracy_m <= MAX_LOCATION_ACCURACY_M
    speed_ok = speed_mps is None or speed_mps <= MAX_LOCATION_SPEED_MPS
    if not accuracy_ok or not speed_ok:
        reason = "Location update ignored."
        if not accuracy_ok:
            reason = f"Location accuracy too low ({int(round(accuracy_m or 0))}m)."
        elif not speed_ok:
            reason = f"Location speed too high ({round(speed_mps or 0, 1)} m/s)."
        return {
            "location": "ignored",
            "accepted": False,
            "reason": reason,
            "accuracy_m": accuracy_m,
            "speed_mps": speed_mps,
        }

    now = datetime.utcnow()
    loc = RiderLocation(
        rider_id=rider.id,
        lat=lat,
        lng=lng,
        updated_at=now
    )
    db.add(loc)

    current = (
        db.query(RiderCurrentLocation)
        .filter(RiderCurrentLocation.rider_id == rider.id)
        .first()
    )
    if current:
        current.lat = lat
        current.lng = lng
        if accuracy_m is not None:
            current.accuracy_m = accuracy_m
        current.updated_at = now
    else:
        db.add(
            RiderCurrentLocation(
                rider_id=rider.id,
                lat=lat,
                lng=lng,
                accuracy_m=accuracy_m,
                updated_at=now,
            )
        )

    # Geofence entry/exit alerts per geofence (throttled).
    geofences = db.query(Geofence).filter(or_(Geofence.is_active == True, Geofence.is_active.is_(None))).all()  # noqa: E712
    if geofences:
        rider_store = (getattr(rider, "store", None) or "").strip().lower()
        relevant = [
            g
            for g in geofences
            if not g.store or (g.store or "").strip().lower() == rider_store
        ]
        store_geofences = [
            g
            for g in geofences
            if (g.store or "").strip().lower() == rider_store
        ]
        for g in relevant:
            inside = _haversine_m(lat, lng, g.lat, g.lng) <= g.radius_m
            last = (
                db.query(LocationAlert)
                .filter(LocationAlert.rider_id == rider.id, LocationAlert.geofence_id == g.id)
                .order_by(LocationAlert.created_at.desc(), LocationAlert.id.desc())
                .first()
            )
            last_state = None
            if last and last.message:
                msg = last.message.lower()
                if "entered" in msg:
                    last_state = "inside"
                elif "exited" in msg:
                    last_state = "outside"

            # Only log on state change (or first observation).
            should_log = False
            if last_state is None:
                should_log = True
            elif last_state == "inside" and not inside:
                should_log = True
            elif last_state == "outside" and inside:
                should_log = True

            if should_log:
                if last and last.created_at and now - last.created_at < timedelta(minutes=2):
                    continue
                message = f"Entered {g.name}" if inside else f"Exited {g.name}"
                alert = LocationAlert(
                    rider_id=rider.id,
                    geofence_id=g.id,
                    message=message,
                    lat=lat,
                    lng=lng,
                    created_at=now,
                )
                db.add(alert)
                db.flush()
                rider_label = rider.name or rider.username or f"Rider {rider.id}"
                action = "entered" if inside else "exited"
                notif_message = f"{rider_label} {action} {g.name}"
                admins = db.query(User).filter(User.role == "admin").all()
                for admin in admins:
                    db.add(
                        Notification(
                            user_id=admin.id,
                            title="Geofence alert",
                            message=notif_message,
                            kind="alert",
                            link="/admin/tracking",
                            created_at=now,
                        )
                    )

        # Auto-set to delivery when rider moves 500m+ away from store.
        if store_geofences:
            closest = _closest_geofence(lat, lng, store_geofences)
            if closest and closest["distance_m"] > AUTO_DELIVERY_DISTANCE_M:
                latest = (
                    db.query(RiderStatus)
                    .filter(RiderStatus.rider_id == rider.id)
                    .order_by(RiderStatus.updated_at.desc(), RiderStatus.id.desc())
                    .first()
                )
                if latest and latest.status == "available":
                    db.add(
                        RiderStatus(
                            rider_id=rider.id,
                            status="delivery",
                            updated_at=now,
                        )
                    )
                    _create_delivery_record(db, rider)
                db.add(
                    AuditLog(
                        actor_id=None,
                        action="Geofence alert",
                        entity_type="location_alert",
                        entity_id=alert.id,
                        details={
                            "rider_id": rider.id,
                            "rider_name": rider_label,
                            "geofence_id": g.id,
                            "geofence_name": g.name,
                            "message": message,
                            "lat": lat,
                            "lng": lng,
                        },
                        created_at=now,
                    )
                )

    # Retention cleanup
    if LOCATION_RETENTION_DAYS and LOCATION_RETENTION_DAYS > 0:
        cutoff = now - timedelta(days=LOCATION_RETENTION_DAYS)
        db.query(RiderLocation).filter(RiderLocation.updated_at < cutoff).delete(synchronize_session=False)

    db.commit()
    return {"location": "updated", "accepted": True}


# ---------- ADMIN VIEW LIVE RIDERS ----------
@router.get("/live")
def live_tracking(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    current = db.query(RiderCurrentLocation).all()
    if current:
        rider_ids = [l.rider_id for l in current]
        user_map = _user_map(db, rider_ids)
        status_map = _latest_status_map(db, rider_ids)
        speed_map = _speed_map(db, rider_ids)
        payload = []
        for l in current:
            age_min, stale = _stale_info(l.updated_at)
            payload.append(
                {
                    "rider_id": l.rider_id,
                    "rider_name": (user_map.get(l.rider_id).name if user_map.get(l.rider_id) else f"Rider {l.rider_id}"),
                    "store": getattr(user_map.get(l.rider_id), "store", None) if user_map.get(l.rider_id) else None,
                    "status": status_map.get(l.rider_id).status if status_map.get(l.rider_id) else "offline",
                    "status_updated_at": status_map.get(l.rider_id).updated_at.isoformat() if status_map.get(l.rider_id) and status_map.get(l.rider_id).updated_at else None,
                    "accuracy_m": getattr(l, "accuracy_m", None),
                    "speed_mps": speed_map.get(l.rider_id),
                    "lat": l.lat,
                    "lng": l.lng,
                    "updated_at": l.updated_at.isoformat() if l.updated_at else None,
                    "last_seen_minutes": age_min,
                    "is_stale": stale,
                }
            )
        return payload

    # Fallback to latest historical point per rider.
    rows = (
        db.query(RiderLocation)
        .order_by(RiderLocation.rider_id, RiderLocation.updated_at.desc())
        .all()
    )
    latest: dict[int, RiderLocation] = {}
    for r in rows:
        if r.rider_id not in latest:
            latest[r.rider_id] = r
    rider_ids = list(latest.keys())
    user_map = _user_map(db, rider_ids)
    status_map = _latest_status_map(db, rider_ids)
    speed_map = _speed_map(db, rider_ids)
    payload = []
    for l in latest.values():
        age_min, stale = _stale_info(l.updated_at)
        payload.append(
            {
                "rider_id": l.rider_id,
                "rider_name": (user_map.get(l.rider_id).name if user_map.get(l.rider_id) else f"Rider {l.rider_id}"),
                "store": getattr(user_map.get(l.rider_id), "store", None) if user_map.get(l.rider_id) else None,
                "status": status_map.get(l.rider_id).status if status_map.get(l.rider_id) else "offline",
                "status_updated_at": status_map.get(l.rider_id).updated_at.isoformat() if status_map.get(l.rider_id) and status_map.get(l.rider_id).updated_at else None,
                "accuracy_m": None,
                "speed_mps": speed_map.get(l.rider_id),
                "lat": l.lat,
                "lng": l.lng,
                "updated_at": l.updated_at.isoformat() if l.updated_at else None,
                "last_seen_minutes": age_min,
                "is_stale": stale,
            }
        )
    return payload


# ---------- ADMIN HISTORY ----------
@router.get("/history")
def history(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    rider_id: int | None = None,
    limit: int = Query(200, ge=1, le=1000),
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

    start = datetime.combine(from_date, time.min)
    end = datetime.combine(to_date, time.max)

    q = (
        db.query(RiderLocation, User)
        .join(User, RiderLocation.rider_id == User.id)
        .filter(RiderLocation.updated_at >= start, RiderLocation.updated_at <= end)
    )
    if rider_id is not None:
        q = q.filter(RiderLocation.rider_id == rider_id)

    total = q.count()
    rows = (
        q.order_by(RiderLocation.updated_at.desc(), RiderLocation.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "rider_id": r.rider_id,
                "rider_name": u.name if u else f"Rider {r.rider_id}",
                "store": getattr(u, "store", None) if u else None,
                "lat": r.lat,
                "lng": r.lng,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r, u in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/history/export")
def export_history(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    rider_id: int | None = None,
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

    start = datetime.combine(from_date, time.min)
    end = datetime.combine(to_date, time.max)

    q = (
        db.query(RiderLocation, User)
        .join(User, RiderLocation.rider_id == User.id)
        .filter(RiderLocation.updated_at >= start, RiderLocation.updated_at <= end)
    )
    if rider_id is not None:
        q = q.filter(RiderLocation.rider_id == rider_id)

    rows = q.order_by(RiderLocation.updated_at.asc(), RiderLocation.id.asc()).all()

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["rider_id", "rider_name", "store", "lat", "lng", "updated_at"])
    for r, u in rows:
        writer.writerow(
            [
                r.rider_id,
                u.name if u else f"Rider {r.rider_id}",
                getattr(u, "store", None) if u else None,
                r.lat,
                r.lng,
                r.updated_at.isoformat() if r.updated_at else None,
            ]
        )

    filename = f"tracking_history_{from_date.isoformat()}_to_{to_date.isoformat()}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------- ADMIN LIVE STREAM ----------
@router.get("/stream")
def stream(token: str = Query(...)):
    db = SessionLocal()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id: int | None = payload.get("id")
        role: str | None = payload.get("role")
        if not user_id or role != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    finally:
        db.close()

    async def event_gen():
        while True:
            db = SessionLocal()
            try:
                geofences = db.query(Geofence).all()
                geofence_map = {g.id: g.name for g in geofences}
                alerts = (
                    db.query(LocationAlert)
                    .order_by(LocationAlert.created_at.desc(), LocationAlert.id.desc())
                    .limit(50)
                    .all()
                )
                live = db.query(RiderCurrentLocation).all()
                alert_ids = [a.rider_id for a in alerts if a.rider_id is not None]
                rider_ids = list({l.rider_id for l in live}.union(alert_ids))
                user_map = _user_map(db, rider_ids)
                status_map = _latest_status_map(db, rider_ids)
                speed_map = _speed_map(db, rider_ids)
                payload = {
                    "live": [
                        {
                            "rider_id": l.rider_id,
                            "rider_name": (user_map.get(l.rider_id).name if user_map.get(l.rider_id) else f"Rider {l.rider_id}"),
                            "store": getattr(user_map.get(l.rider_id), "store", None) if user_map.get(l.rider_id) else None,
                            "status": status_map.get(l.rider_id).status if status_map.get(l.rider_id) else "offline",
                            "status_updated_at": status_map.get(l.rider_id).updated_at.isoformat() if status_map.get(l.rider_id) and status_map.get(l.rider_id).updated_at else None,
                            "accuracy_m": getattr(l, "accuracy_m", None),
                            "speed_mps": speed_map.get(l.rider_id),
                            "lat": l.lat,
                            "lng": l.lng,
                            "updated_at": l.updated_at.isoformat() if l.updated_at else None,
                            "last_seen_minutes": _stale_info(l.updated_at)[0],
                            "is_stale": _stale_info(l.updated_at)[1],
                        }
                        for l in live
                    ],
                    "alerts": [
                        {
                            "id": a.id,
                            "rider_id": a.rider_id,
                            "rider_name": (user_map.get(a.rider_id).name if a.rider_id in user_map else None),
                            "store": getattr(user_map.get(a.rider_id), "store", None) if a.rider_id in user_map else None,
                            "geofence_id": a.geofence_id,
                            "geofence_name": geofence_map.get(a.geofence_id),
                            "message": a.message,
                            "lat": a.lat,
                            "lng": a.lng,
                            "created_at": a.created_at.isoformat() if a.created_at else None,
                        }
                        for a in alerts
                    ],
                    "ts": datetime.utcnow().isoformat(),
                }
            finally:
                db.close()

            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(event_gen(), media_type="text/event-stream")
