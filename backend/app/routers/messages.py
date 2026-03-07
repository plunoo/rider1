from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from datetime import datetime
from pathlib import Path
import uuid

from app.database import SessionLocal
from app.models import Message, User, Notification
from app.auth.deps import get_current_user
from app.config import MAX_MESSAGE_IMAGE_MB

router = APIRouter(prefix="/messages", tags=["Messages"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


ALLOWED_ROLES = {"admin", "rider", "captain"}
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

UPLOAD_ROOT = Path(__file__).resolve().parents[1] / "uploads"
MESSAGE_UPLOAD_ROOT = UPLOAD_ROOT / "messages"
MESSAGE_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_BYTES = max(1, MAX_MESSAGE_IMAGE_MB) * 1024 * 1024


def _allowed_recipient_roles(sender_role: str) -> set[str]:
    if sender_role == "rider":
        return {"admin", "captain"}
    if sender_role == "captain":
        return {"admin", "rider"}
    return {"admin", "rider", "captain"}


def _looks_like_image(head: bytes, content_type: str) -> bool:
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/gif":
        return head.startswith(b"GIF87a") or head.startswith(b"GIF89a")
    if content_type == "image/webp":
        return head.startswith(b"RIFF") and b"WEBP" in head[:16]
    return False


async def _save_message_image(file: UploadFile, owner_id: int) -> tuple[str, str]:
    content_type = (file.content_type or "").lower().strip()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    ext = ALLOWED_IMAGE_TYPES[content_type]
    target_dir = MESSAGE_UPLOAD_ROOT / str(owner_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    target_path = target_dir / filename

    size = 0
    head = await file.read(32)
    size += len(head)
    if not _looks_like_image(head, content_type):
        raise HTTPException(status_code=400, detail="Invalid image file")

    try:
        with target_path.open("wb") as out:
            out.write(head)
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="Image too large")
                out.write(chunk)
    except HTTPException:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        raise
    except Exception:
        if target_path.exists():
            target_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to save image")
    finally:
        try:
            await file.close()
        except Exception:
            pass

    return f"/uploads/messages/{owner_id}/{filename}", content_type


@router.get("/recipients")
def list_recipients(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    roles = _allowed_recipient_roles(user.role)
    rows = (
        db.query(User)
        .filter(User.id != user.id)
        .filter(User.role.in_(roles))
        .order_by(User.role.asc(), User.name.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "role": r.role,
            "store": getattr(r, "store", None),
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.get("/threads")
def list_threads(
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(Message)
        .filter(or_(Message.sender_id == user.id, Message.recipient_id == user.id))
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
        .all()
    )

    threads: dict[int, dict] = {}
    unread_counts: dict[int, int] = {}

    for msg in rows:
        other_id = msg.recipient_id if msg.sender_id == user.id else msg.sender_id
        if msg.recipient_id == user.id and msg.read_at is None:
            unread_counts[other_id] = unread_counts.get(other_id, 0) + 1
        if other_id not in threads:
            last_message = msg.body
            if not last_message and getattr(msg, "image_url", None):
                last_message = "Photo"
            threads[other_id] = {
                "user_id": other_id,
                "last_message": last_message,
                "last_at": msg.created_at.isoformat() if msg.created_at else None,
                "unread_count": unread_counts.get(other_id, 0),
            }

    if not threads:
        return []

    user_rows = db.query(User).filter(User.id.in_(threads.keys())).all()
    user_map = {u.id: u for u in user_rows}
    roles_allowed = _allowed_recipient_roles(user.role)

    results = []
    for user_id, entry in threads.items():
        u = user_map.get(user_id)
        entry["unread_count"] = unread_counts.get(user_id, 0)
        if not u or u.role not in roles_allowed:
            continue
        results.append(
            {
                **entry,
                "name": u.name,
                "role": u.role,
                "store": getattr(u, "store", None),
            }
        )

    results.sort(key=lambda x: x.get("last_at") or "", reverse=True)
    return results


@router.get("/with/{other_id}")
def get_conversation(
    other_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    mark_read: bool = Query(True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    other = db.query(User).filter(User.id == other_id).first()
    if not other or other.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if other.role not in _allowed_recipient_roles(user.role):
        raise HTTPException(status_code=403, detail="Messaging not allowed")

    q = db.query(Message).filter(
        or_(
            and_(Message.sender_id == user.id, Message.recipient_id == other_id),
            and_(Message.sender_id == other_id, Message.recipient_id == user.id),
        )
    )
    total = q.count()
    rows = (
        q.order_by(Message.created_at.desc(), Message.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    if mark_read:
        db.query(Message).filter(
            Message.sender_id == other_id,
            Message.recipient_id == user.id,
            Message.read_at.is_(None),
        ).update({Message.read_at: datetime.utcnow()}, synchronize_session=False)
        db.commit()

    items = [
        {
            "id": m.id,
            "sender_id": m.sender_id,
            "recipient_id": m.recipient_id,
            "body": m.body,
            "image_url": getattr(m, "image_url", None),
            "image_mime": getattr(m, "image_mime", None),
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "read_at": m.read_at.isoformat() if m.read_at else None,
        }
        for m in reversed(rows)
    ]

    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/send")
async def send_message(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    content_type = request.headers.get("content-type", "").lower()
    data: dict = {}
    image_file: UploadFile | None = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        data = dict(form)
        raw_image = form.get("image")
        if isinstance(raw_image, UploadFile):
            image_file = raw_image
    else:
        try:
            data = await request.json()
        except Exception:
            data = {}

    if "recipient_id" not in data:
        raise HTTPException(status_code=400, detail="recipient_id is required")
    try:
        recipient_id = int(data.get("recipient_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="recipient_id must be a number")
    if recipient_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")

    recipient = db.query(User).filter(User.id == recipient_id).first()
    if not recipient or recipient.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if recipient.role not in _allowed_recipient_roles(user.role):
        raise HTTPException(status_code=403, detail="Messaging not allowed")

    body = str(data.get("body", "")).strip()
    if body and len(body) > 2000:
        raise HTTPException(status_code=400, detail="Message too long")

    image_url = None
    image_mime = None
    if image_file is not None:
        image_url, image_mime = await _save_message_image(image_file, user.id)

    if not body and not image_url:
        raise HTTPException(status_code=400, detail="Message body or image is required")

    msg = Message(
        sender_id=user.id,
        recipient_id=recipient_id,
        body=body or "",
        image_url=image_url,
        image_mime=image_mime,
        created_at=datetime.utcnow(),
    )
    db.add(msg)
    sender_label = user.name or user.username or f"User {user.id}"
    snippet = body if len(body) <= 120 else f"{body[:117]}..."
    if not snippet and image_url:
        snippet = "Photo"
    link = "/admin/messages" if recipient.role == "admin" else "/captain/messages" if recipient.role == "captain" else "/rider/messages"
    db.add(
        Notification(
            user_id=recipient.id,
            title="New message",
            message=f"{sender_label}: {snippet}",
            kind="message",
            link=link,
            created_at=datetime.utcnow(),
        )
    )
    db.commit()
    db.refresh(msg)
    return {
        "id": msg.id,
        "sender_id": msg.sender_id,
        "recipient_id": msg.recipient_id,
        "body": msg.body,
        "image_url": getattr(msg, "image_url", None),
        "image_mime": getattr(msg, "image_mime", None),
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "read_at": msg.read_at.isoformat() if msg.read_at else None,
    }
