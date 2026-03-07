from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import SessionLocal
from app.auth.deps import get_current_user
from app.models import Notification, User


router = APIRouter(prefix="/notifications", tags=["Notifications"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("")
def list_notifications(
    unread_only: bool = Query(False),
    kind: str | None = Query(None),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.is_read == False)  # noqa: E712
    if kind:
        q = q.filter(Notification.kind == kind)

    total = q.count()
    unread_total = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    unread_filtered = (
        q.filter(Notification.is_read == False)  # noqa: E712
        .count()
    )
    rows = (
        q.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "id": n.id,
                "title": n.title,
                "message": n.message,
                "kind": n.kind,
                "link": n.link,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in rows
        ],
        "total": total,
        "unread": unread_total,
        "unread_filtered": unread_filtered,
        "limit": limit,
        "offset": offset,
    }


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notif = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user.id)
        .first()
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    notif.is_read = True
    notif.read_at = datetime.utcnow()
    db.commit()
    return {"message": "Notification marked as read"}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True, "read_at": now}, synchronize_session=False)
    )
    db.commit()
    return {"message": "All notifications marked as read"}
