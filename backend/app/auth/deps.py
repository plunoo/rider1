from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.config import JWT_SECRET, JWT_ALGORITHM
from app.database import SessionLocal
from app.models import User

security = HTTPBearer()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id: int = payload.get("id")
        role: str = payload.get("role")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="Account inactive")

    return user


def admin_only(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user


def rider_only(user: User = Depends(get_current_user)):
    if user.role != "rider":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Rider access required"
        )
    return user


def captain_only(user: User = Depends(get_current_user)):
    if user.role != "captain":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Captain access required"
        )
    return user
