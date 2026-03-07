from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, datetime, time

from app.database import SessionLocal
from app.models import Delivery
from app.schemas import DeliveryCreate, DeliveryResponse
from app.auth.deps import rider_only, admin_only


router = APIRouter(prefix="/deliveries", tags=["Deliveries"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _parse_date_range(from_: str | None, to: str | None):
    start = None
    end = None
    from_date = None
    to_date = None
    if from_:
        try:
            from_date = date.fromisoformat(from_)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid from date")
        start = datetime.combine(from_date, time.min)
    if to:
        try:
            to_date = date.fromisoformat(to)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid to date")
        end = datetime.combine(to_date, time.max)
    if from_date and to_date and from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")
    return start, end


@router.post("", response_model=DeliveryResponse)
def create_delivery(
    data: DeliveryCreate,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    delivery = Delivery(
        rider_id=data.rider_id,
        assigned_at=data.start_time,
        delivered_at=data.end_time,
        distance_km=data.distance_km,
        base_pay_cents=data.base_pay_cents,
        tip_cents=data.tip_cents,
        bonus_cents=data.bonus_cents,
        status=data.status,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return {
        "id": delivery.id,
        "rider_id": delivery.rider_id,
        "start_time": delivery.assigned_at,
        "end_time": delivery.delivered_at,
        "distance_km": delivery.distance_km,
        "base_pay_cents": delivery.base_pay_cents,
        "tip_cents": delivery.tip_cents,
        "bonus_cents": delivery.bonus_cents,
        "status": delivery.status,
        "created_at": delivery.created_at,
    }


@router.get("/mine")
def list_my_deliveries(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    start, end = _parse_date_range(from_, to)
    end_expr = func.coalesce(Delivery.delivered_at, Delivery.canceled_at, Delivery.assigned_at, Delivery.created_at)
    base_q = db.query(Delivery).filter(Delivery.rider_id == rider.id)
    if start:
        base_q = base_q.filter(end_expr >= start)
    if end:
        base_q = base_q.filter(end_expr <= end)

    total = base_q.count()

    summary_row = (
        db.query(
            func.coalesce(func.sum(Delivery.base_pay_cents), 0),
            func.coalesce(func.sum(Delivery.tip_cents), 0),
            func.coalesce(func.sum(Delivery.bonus_cents), 0),
            func.coalesce(func.sum(Delivery.distance_km), 0.0),
        )
        .filter(Delivery.rider_id == rider.id)
    )
    if start:
        summary_row = summary_row.filter(end_expr >= start)
    if end:
        summary_row = summary_row.filter(end_expr <= end)
    base_pay, tips, bonus, distance = summary_row.first() or (0, 0, 0, 0.0)

    rows = (
        base_q.order_by(end_expr.desc(), Delivery.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "items": [
            {
                "id": d.id,
                "rider_id": d.rider_id,
                "start_time": (d.assigned_at or d.picked_up_at or d.created_at).isoformat() if (d.assigned_at or d.picked_up_at or d.created_at) else None,
                "end_time": (d.delivered_at or d.canceled_at or d.picked_up_at or d.assigned_at or d.created_at).isoformat() if (d.delivered_at or d.canceled_at or d.picked_up_at or d.assigned_at or d.created_at) else None,
                "distance_km": d.distance_km,
                "base_pay_cents": d.base_pay_cents,
                "tip_cents": d.tip_cents,
                "bonus_cents": d.bonus_cents,
                "status": d.status,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
        "summary": {
            "count": total,
            "base_pay_cents": base_pay or 0,
            "tip_cents": tips or 0,
            "bonus_cents": bonus or 0,
            "total_cents": (base_pay or 0) + (tips or 0) + (bonus or 0),
            "distance_km": distance or 0,
        },
    }
