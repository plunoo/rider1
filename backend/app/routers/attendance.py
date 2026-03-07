from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import Attendance, Notification, User, AuditLog
from datetime import date, datetime, timedelta, time
from app.schemas import AttendanceMark
from app.auth.deps import rider_only
from app.config import ATTENDANCE_EDIT_GRACE_MINUTES

router = APIRouter(prefix="/attendance", tags=["Attendance"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/mark")
def mark_attendance(
    data: AttendanceMark,
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    now = datetime.utcnow()
    today = now.date()

    last = (
        db.query(Attendance)
        .filter(Attendance.rider_id == rider.id)
        .order_by(Attendance.created_at.desc(), Attendance.id.desc())
        .first()
    )
    last_ts = None
    if last:
        last_ts = last.updated_at or last.created_at
        if not last_ts and last.date:
            last_ts = datetime.combine(last.date, time.min)

    existing = (
        db.query(Attendance)
        .filter(Attendance.rider_id == rider.id, Attendance.date == today)
        .first()
    )

    next_day = datetime.combine(today + timedelta(days=1), time.min)
    can_edit = False

    attendance_row = existing
    if existing:
        if last_ts and (now - last_ts) <= timedelta(minutes=ATTENDANCE_EDIT_GRACE_MINUTES):
            existing.status = data.status
            note = (data.note or "").strip()
            existing.note = note or None
            existing.updated_at = now
            can_edit = True
        else:
            return {
                "message": "Attendance already marked today",
                "skipped": True,
                "last_marked_at": last_ts.isoformat() if last_ts else None,
                "next_available_at": next_day.isoformat(),
                "can_edit": False,
            }
    else:
        attendance_row = Attendance(
            rider_id=rider.id,
            date=today,
            status=data.status,
            note=(data.note or "").strip() or None,
            created_at=now,
            updated_at=now,
        )
        db.add(attendance_row)
        can_edit = True

    db.flush()
    db.add(
        AuditLog(
            actor_id=rider.id,
            action="Marked attendance",
            entity_type="attendance",
            entity_id=attendance_row.id if attendance_row else None,
            details={"status": data.status, "note": (data.note or "").strip() or None, "date": today.isoformat()},
            created_at=now,
        )
    )

    if data.status == "late":
        admins = db.query(User).filter(User.role == "admin").all()
        rider_label = rider.name or rider.username or f"Rider {rider.id}"
        for admin in admins:
            db.add(
                Notification(
                    user_id=admin.id,
                    title="Late check-in",
                    message=f"{rider_label} marked late for {today.isoformat()}.",
                    kind="attendance",
                    link="/admin/attendance",
                    created_at=now,
                )
            )

    db.commit()
    return {
        "message": "Attendance marked",
        "skipped": False,
        "marked_at": now.isoformat(),
        "last_marked_at": now.isoformat(),
        "next_available_at": next_day.isoformat(),
        "can_edit": can_edit,
    }


@router.get("/today")
def get_today_attendance(
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    today = date.today()
    existing = (
        db.query(Attendance)
        .filter(Attendance.rider_id == rider.id, Attendance.date == today)
        .first()
    )
    last = (
        db.query(Attendance)
        .filter(Attendance.rider_id == rider.id)
        .order_by(Attendance.created_at.desc(), Attendance.id.desc())
        .first()
    )
    last_ts = None
    if last:
        last_ts = last.updated_at or last.created_at
        if not last_ts and last.date:
            last_ts = datetime.combine(last.date, time.min)
    next_available = None
    can_edit = False
    if existing:
        next_available = datetime.combine(today + timedelta(days=1), time.min)
        if last_ts:
            can_edit = datetime.utcnow() - last_ts < timedelta(minutes=ATTENDANCE_EDIT_GRACE_MINUTES)
    return {
        "date": today.isoformat(),
        "status": existing.status if existing else None,
        "note": existing.note if existing else None,
        "last_marked_at": last_ts.isoformat() if last_ts else None,
        "next_available_at": next_available.isoformat() if next_available else None,
        "can_edit": can_edit,
    }


@router.get("/history")
def attendance_history(
    days: int = Query(30, ge=1, le=60),
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    today = date.today()
    start_date = today - timedelta(days=days - 1)
    rows = (
        db.query(Attendance)
        .filter(Attendance.rider_id == rider.id, Attendance.date >= start_date)
        .order_by(Attendance.date.desc())
        .all()
    )
    return [
        {
            "date": r.date.isoformat(),
            "status": r.status,
            "note": r.note,
            "updated_at": (r.updated_at or r.created_at).isoformat() if (r.updated_at or r.created_at) else None,
        }
        for r in rows
    ]
