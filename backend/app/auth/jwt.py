from datetime import datetime, timedelta
from jose import jwt
from app.config import JWT_SECRET, JWT_ALGORITHM

def create_access_token(data: dict, minutes: int):
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=minutes)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
