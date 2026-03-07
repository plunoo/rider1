from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import SessionLocal
from app.auth.deps import get_current_user
from app.models import PushSubscription, User
from app.config import VAPID_PUBLIC_KEY, PUSH_ENABLED

router = APIRouter(prefix="/push", tags=["Push"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/public-key")
def public_key(user: User = Depends(get_current_user)):
    return {"public_key": VAPID_PUBLIC_KEY or None, "enabled": bool(PUSH_ENABLED and VAPID_PUBLIC_KEY)}


def _extract_subscription(data: dict) -> dict:
    if "subscription" in data and isinstance(data.get("subscription"), dict):
        return data["subscription"]
    return data


@router.post("/subscribe")
def subscribe(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    payload = _extract_subscription(data)
    endpoint = str(payload.get("endpoint") or "").strip()
    keys = payload.get("keys") or {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Invalid subscription payload")

    device = str(data.get("device") or payload.get("device") or "").strip() or None
    user_agent = request.headers.get("user-agent")
    now = datetime.utcnow()

    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id, PushSubscription.endpoint == endpoint)
        .first()
    )
    if existing:
        existing.p256dh = p256dh
        existing.auth = auth
        existing.device = device
        existing.user_agent = user_agent
        existing.last_seen_at = now
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                device=device,
                user_agent=user_agent,
                created_at=now,
                updated_at=now,
                last_seen_at=now,
            )
        )
    db.commit()
    return {"message": "Subscribed"}


@router.post("/unsubscribe")
def unsubscribe(
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    payload = _extract_subscription(data)
    endpoint = str(payload.get("endpoint") or "").strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="endpoint is required")
    removed = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id, PushSubscription.endpoint == endpoint)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"removed": bool(removed)}
