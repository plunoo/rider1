from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, date

from app.database import SessionLocal
from app.models import DailyEarning, Store, User
from app.auth.deps import rider_only

router = APIRouter(prefix="/earnings", tags=["Earnings"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _default_rate_cents(db: Session, rider: User) -> int:
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


@router.get("/mine")
def list_my_earnings(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    rider: User = Depends(rider_only)
):
    try:
        from_date = date.fromisoformat(from_)
        to_date = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date range")

    if from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")

    rows = (
        db.query(DailyEarning)
        .filter(DailyEarning.rider_id == rider.id)
        .filter(DailyEarning.date >= from_date, DailyEarning.date <= to_date)
        .order_by(DailyEarning.date.desc(), DailyEarning.id.desc())
        .all()
    )

    items = []
    summary = {
        "orders_count": 0,
        "base_pay_cents": 0,
        "tip_cents": 0,
        "bonus_cents": 0,
        "total_cents": 0,
    }
    for row in rows:
        base_cents = int(row.orders_count or 0) * int(row.per_order_cents or 0)
        summary["orders_count"] += int(row.orders_count or 0)
        summary["base_pay_cents"] += base_cents
        summary["tip_cents"] += int(row.tip_cents or 0)
        summary["bonus_cents"] += int(row.bonus_cents or 0)
        summary["total_cents"] += int(row.total_cents or 0)
        items.append(
            {
                "id": row.id,
                "date": row.date.isoformat(),
                "orders_count": row.orders_count,
                "per_order_cents": row.per_order_cents,
                "tip_cents": row.tip_cents,
                "bonus_cents": row.bonus_cents,
                "total_cents": row.total_cents,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
        )

    return {
        "items": items,
        "summary": summary,
        "default_rate_cents": _default_rate_cents(db, rider),
    }


@router.post("/mine")
def upsert_my_earning(
    data: dict,
    db: Session = Depends(get_db),
    rider: User = Depends(rider_only)
):
    if "date" not in data:
        raise HTTPException(status_code=400, detail="date is required")

    try:
        entry_date = date.fromisoformat(str(data["date"]))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")

    try:
        orders_count = int(data.get("orders_count", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="orders_count must be a number")

    try:
        per_order_cents = int(data.get("per_order_cents", _default_rate_cents(db, rider)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="per_order_cents must be a number")

    try:
        tip_cents = int(data.get("tip_cents", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="tip_cents must be a number")

    try:
        bonus_cents = int(data.get("bonus_cents", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="bonus_cents must be a number")

    if orders_count < 0 or per_order_cents < 0 or tip_cents < 0 or bonus_cents < 0:
        raise HTTPException(status_code=400, detail="Values must be non-negative")

    total_cents = orders_count * per_order_cents + tip_cents + bonus_cents
    now = datetime.utcnow()

    existing = (
        db.query(DailyEarning)
        .filter(DailyEarning.rider_id == rider.id, DailyEarning.date == entry_date)
        .first()
    )
    if existing:
        existing.orders_count = orders_count
        existing.per_order_cents = per_order_cents
        existing.tip_cents = tip_cents
        existing.bonus_cents = bonus_cents
        existing.total_cents = total_cents
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        return {"message": "Daily earning updated", "id": existing.id}

    row = DailyEarning(
        rider_id=rider.id,
        date=entry_date,
        orders_count=orders_count,
        per_order_cents=per_order_cents,
        tip_cents=tip_cents,
        bonus_cents=bonus_cents,
        total_cents=total_cents,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"message": "Daily earning saved", "id": row.id}
