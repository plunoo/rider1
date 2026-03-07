from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime, date, time
import pandas as pd

from app.database import SessionLocal
from app.models import Shift
from app.schemas import ShiftCreate, ShiftResponse, ExportRequest
from app.auth.deps import admin_only, rider_only

router = APIRouter(prefix="/shifts", tags=["Shifts"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------- CREATE SHIFT (ADMIN) ----------
@router.post("/create", response_model=ShiftResponse)
def create_shift(
    data: ShiftCreate,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    shift = Shift(
        rider_id=data.rider_id,
        start_time=data.start_time,
        end_time=data.end_time
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift


# ---------- LIST SHIFTS (ADMIN) ----------
@router.get("/list", response_model=list[ShiftResponse])
def list_shifts(
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    return db.query(Shift).all()


# ---------- LIST SHIFTS (RIDER) ----------
@router.get("/mine", response_model=list[ShiftResponse])
def list_my_shifts(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    db: Session = Depends(get_db),
    rider=Depends(rider_only)
):
    q = db.query(Shift).filter(Shift.rider_id == rider.id)
    if from_:
        try:
            from_date = date.fromisoformat(from_)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid from date")
        q = q.filter(Shift.start_time >= datetime.combine(from_date, time.min))
    if to:
        try:
            to_date = date.fromisoformat(to)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid to date")
        q = q.filter(Shift.end_time <= datetime.combine(to_date, time.max))
    if from_ and to and from_date > to_date:
        raise HTTPException(status_code=400, detail="Invalid date range")
    return q.order_by(Shift.start_time.asc(), Shift.id.asc()).all()


# ---------- EXPORT SHIFTS TO EXCEL ----------
@router.post("/export")
def export_shifts(
    data: ExportRequest,
    db: Session = Depends(get_db),
    admin=Depends(admin_only)
):
    shifts = db.query(Shift).filter(
        Shift.start_time >= data.from_date,
        Shift.end_time <= data.to_date
    ).all()

    rows = [{
        "rider_id": s.rider_id,
        "start_time": s.start_time,
        "end_time": s.end_time
    } for s in shifts]

    df = pd.DataFrame(rows)
    file_path = "/tmp/shifts.xlsx"
    df.to_excel(file_path, index=False)

    return {
        "message": "Shifts exported",
        "file": file_path
    }
