from fastapi import APIRouter, Depends, HTTPException, Query
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json

from app.auth.deps import get_current_user

router = APIRouter(prefix="/geo", tags=["Geo"])


@lru_cache(maxsize=2000)
def _reverse_cached(lat: float, lng: float) -> str:
    params = urlencode({"format": "jsonv2", "lat": lat, "lon": lng})
    url = f"https://nominatim.openstreetmap.org/reverse?{params}"
    req = Request(url, headers={"User-Agent": "RiderFlow/1.0"})
    with urlopen(req, timeout=6) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("display_name", "")


@router.get("/reverse")
def reverse_geocode(
    lat: float = Query(...),
    lng: float = Query(...),
    user=Depends(get_current_user),
):
    try:
        lat_r = round(float(lat), 5)
        lng_r = round(float(lng), 5)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid lat/lng")

    try:
        address = _reverse_cached(lat_r, lng_r)
    except Exception:
        address = ""
    return {"address": address}
