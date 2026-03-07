import json
from collections import defaultdict
from typing import Iterable

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.config import PUSH_ENABLED, VAPID_PRIVATE_KEY, VAPID_SUBJECT
from app.database import SessionLocal
from app.models import Notification, PushSubscription

try:
    from pywebpush import webpush, WebPushException
    _HAS_WEBPUSH = True
except Exception:  # pragma: no cover - optional dependency
    webpush = None
    WebPushException = Exception
    _HAS_WEBPUSH = False


def _can_send_push() -> bool:
    return bool(PUSH_ENABLED and _HAS_WEBPUSH and VAPID_PRIVATE_KEY and VAPID_SUBJECT)


def _build_subscription_payload(sub: PushSubscription) -> dict:
    return {
        "endpoint": sub.endpoint,
        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
    }


def _send_push_batch(items: Iterable[dict]) -> None:
    if not _can_send_push():
        return
    payloads = [item for item in items if item.get("user_id")]
    if not payloads:
        return
    user_ids = {int(item["user_id"]) for item in payloads if item.get("user_id")}
    if not user_ids:
        return

    with SessionLocal() as db:
        subs = (
            db.query(PushSubscription)
            .filter(PushSubscription.user_id.in_(user_ids))
            .all()
        )
        if not subs:
            return
        sub_map: dict[int, list[PushSubscription]] = defaultdict(list)
        for sub in subs:
            sub_map[sub.user_id].append(sub)

        stale_ids: list[int] = []
        for item in payloads:
            subs_for_user = sub_map.get(int(item["user_id"]), [])
            if not subs_for_user:
                continue
            data = json.dumps({
                "title": item.get("title") or "Notification",
                "message": item.get("message") or "",
                "kind": item.get("kind") or "info",
                "link": item.get("link") or None,
            })
            for sub in subs_for_user:
                try:
                    webpush(
                        subscription_info=_build_subscription_payload(sub),
                        data=data,
                        vapid_private_key=VAPID_PRIVATE_KEY,
                        vapid_claims={"sub": VAPID_SUBJECT},
                        ttl=3600,
                    )
                except WebPushException as exc:  # pragma: no cover - network exceptions
                    status = getattr(getattr(exc, "response", None), "status_code", None)
                    if status in {404, 410}:
                        stale_ids.append(sub.id)
                except Exception:
                    continue

        if stale_ids:
            db.query(PushSubscription).filter(PushSubscription.id.in_(stale_ids)).delete(synchronize_session=False)
            db.commit()


@event.listens_for(Session, "after_flush")
def _queue_notifications(session: Session, flush_context) -> None:
    queue = session.info.setdefault("push_queue", [])
    for obj in session.new:
        if isinstance(obj, Notification):
            queue.append(
                {
                    "user_id": obj.user_id,
                    "title": obj.title,
                    "message": obj.message,
                    "kind": obj.kind,
                    "link": obj.link,
                }
            )


@event.listens_for(Session, "after_commit")
def _send_notifications_after_commit(session: Session) -> None:
    queue = session.info.pop("push_queue", [])
    if not queue:
        return
    _send_push_batch(queue)


@event.listens_for(Session, "after_rollback")
def _clear_notifications_after_rollback(session: Session) -> None:
    session.info.pop("push_queue", None)
