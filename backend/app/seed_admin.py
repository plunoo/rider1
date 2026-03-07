from sqlalchemy.orm import Session
from database import SessionLocal
from models import User
from auth.passwords import hash_password


def create_admin():
    db: Session = SessionLocal()

    username = "admin"
    password = "admin123"   # 🔴 CHANGE THIS
    name = "System Admin"

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        print("Admin already exists")
        return

    admin = User(
        username=username,
        name=name,
        role="admin",
        password=hash_password(password),
        is_active=True
    )

    db.add(admin)
    db.commit()
    print("✅ Admin user created")


if __name__ == "__main__":
    create_admin()
