from sqlalchemy import (
    Column,
    Integer,
    String,
    Date,
    DateTime,
    ForeignKey,
    Float,
    Boolean,
    JSON,
    UniqueConstraint
)
from sqlalchemy.orm import relationship
from datetime import datetime, date

from database import Base


# =========================
# USERS (ADMIN & RIDERS)
# =========================
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(String(20), nullable=False)  # admin | rider | captain
    store = Column(String(100), nullable=True)  # optional store/group name
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    statuses = relationship("RiderStatus", back_populates="rider")
    attendance = relationship("Attendance", back_populates="rider")
    shifts = relationship("Shift", back_populates="rider")
    deliveries = relationship("Delivery", back_populates="rider")
    daily_earnings = relationship("DailyEarning", back_populates="rider")
    locations = relationship("RiderLocation", back_populates="rider")
    notifications = relationship("Notification", back_populates="user")
    push_subscriptions = relationship("PushSubscription", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="actor")

    def __repr__(self):
        return f"<User id={self.id} username={self.username} role={self.role}>"


# =========================
# STORES
# =========================
class Store(Base):
    __tablename__ = "stores"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    code = Column(String(40), unique=True, nullable=True)
    is_active = Column(Boolean, default=True)
    default_base_pay_cents = Column(Integer, nullable=False, default=0)
    rider_limit = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Store id={self.id} name={self.name} code={self.code}>"



# =========================
# RIDER STATUS (LIVE)
# =========================
class RiderStatus(Base):
    __tablename__ = "rider_status"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    status = Column(String(50), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)

    rider = relationship("User", back_populates="statuses")

    def __repr__(self):
        return f"<RiderStatus rider_id={self.rider_id} status={self.status}>"



# =========================
# ATTENDANCE
# =========================
class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("rider_id", "date", name="unique_rider_attendance"),
    )

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    date = Column(Date, default=date.today)
    status = Column(String(20), nullable=False)  # present | absent | off_day | late
    note = Column(String(255), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    rider = relationship("User", back_populates="attendance")

    def __repr__(self):
        return f"<Attendance rider_id={self.rider_id} date={self.date} status={self.status}>"



# =========================
# SHIFTS
# =========================
class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    rider = relationship("User", back_populates="shifts")

    def __repr__(self):
        return f"<Shift rider_id={self.rider_id} {self.start_time} -> {self.end_time}>"



# =========================
# DELIVERIES
# =========================
class Delivery(Base):
    __tablename__ = "deliveries"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(30), nullable=False, default="completed")
    reference = Column(String(120), nullable=True)
    assigned_at = Column(DateTime, nullable=True)
    picked_up_at = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    canceled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    distance_km = Column(Float, nullable=True)
    base_pay_cents = Column(Integer, nullable=False, default=0)
    tip_cents = Column(Integer, nullable=False, default=0)
    bonus_cents = Column(Integer, nullable=False, default=0)

    rider = relationship("User", back_populates="deliveries")

    def __repr__(self):
        return f"<Delivery id={self.id} rider_id={self.rider_id} status={self.status}>"


# =========================
# DAILY EARNINGS (MANUAL)
# =========================
class DailyEarning(Base):
    __tablename__ = "daily_earnings"
    __table_args__ = (
        UniqueConstraint("rider_id", "date", name="unique_rider_daily_earnings"),
    )

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    date = Column(Date, default=date.today)
    orders_count = Column(Integer, nullable=False, default=0)
    per_order_cents = Column(Integer, nullable=False, default=0)
    tip_cents = Column(Integer, nullable=False, default=0)
    bonus_cents = Column(Integer, nullable=False, default=0)
    total_cents = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    rider = relationship("User", back_populates="daily_earnings")

    def __repr__(self):
        return f"<DailyEarning rider_id={self.rider_id} date={self.date} total_cents={self.total_cents}>"



# =========================
# LIVE GPS TRACKING
# =========================
class RiderLocation(Base):
    __tablename__ = "rider_locations"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)

    updated_at = Column(DateTime, default=datetime.utcnow)

    rider = relationship("User", back_populates="locations")

    def __repr__(self):
        return f"<RiderLocation rider_id={self.rider_id} lat={self.lat} lng={self.lng}>"


# =========================
# GEOFENCES
# =========================
class Geofence(Base):
    __tablename__ = "geofences"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    store = Column(String(100), nullable=True)
    store_id = Column(Integer, ForeignKey("stores.id", ondelete="SET NULL"), nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    radius_m = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Geofence id={self.id} name={self.name} store={self.store}>"


# =========================
# LOCATION ALERTS
# =========================
class LocationAlert(Base):
    __tablename__ = "location_alerts"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    geofence_id = Column(Integer, ForeignKey("geofences.id", ondelete="SET NULL"), nullable=True)
    message = Column(String(255), nullable=False)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<LocationAlert id={self.id} rider_id={self.rider_id} geofence_id={self.geofence_id}>"


# =========================
# CURRENT LOCATIONS
# =========================
class RiderCurrentLocation(Base):
    __tablename__ = "rider_current_locations"

    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    accuracy_m = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<RiderCurrentLocation rider_id={self.rider_id} lat={self.lat} lng={self.lng}>"


# =========================
# NOTIFICATIONS
# =========================
class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    title = Column(String(120), nullable=False)
    message = Column(String(255), nullable=False)
    kind = Column(String(30), nullable=False, default="info")
    link = Column(String(255), nullable=True)
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="notifications")

    def __repr__(self):
        return f"<Notification id={self.id} user_id={self.user_id} kind={self.kind}>"


# =========================
# PUSH SUBSCRIPTIONS
# =========================
class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", "endpoint", name="unique_user_push_endpoint"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    endpoint = Column(String(500), nullable=False)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    user_agent = Column(String(255), nullable=True)
    device = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="push_subscriptions")

    def __repr__(self):
        return f"<PushSubscription id={self.id} user_id={self.user_id}>"


# =========================
# MESSAGES
# =========================
class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body = Column(String(2000), nullable=False)
    image_url = Column(String(255), nullable=True)
    image_mime = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    read_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<Message id={self.id} sender_id={self.sender_id} recipient_id={self.recipient_id}>"


# =========================
# RIDER NOTES
# =========================
class RiderNote(Base):
    __tablename__ = "rider_notes"

    id = Column(Integer, primary_key=True, index=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    note = Column(String(255), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<RiderNote id={self.id} rider_id={self.rider_id}>"


# =========================
# QUEUE PINS
# =========================
class QueuePin(Base):
    __tablename__ = "queue_pins"
    __table_args__ = (
        UniqueConstraint("admin_id", "rider_id", name="unique_admin_rider_pin"),
    )

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rider_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<QueuePin id={self.id} admin_id={self.admin_id} rider_id={self.rider_id}>"


# =========================
# AUDIT LOGS
# =========================
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(160), nullable=False)
    entity_type = Column(String(80), nullable=True)
    entity_id = Column(Integer, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    actor = relationship("User", back_populates="audit_logs")

    def __repr__(self):
        return f"<AuditLog id={self.id} action={self.action} entity_type={self.entity_type} entity_id={self.entity_id}>"
