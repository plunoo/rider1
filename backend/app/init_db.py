#!/usr/bin/env python3
"""
Database initialization script that:
1. Waits for database to be available
2. Creates all tables
3. Creates default admin user
4. Sets up basic configuration
"""

import logging
import time
from sqlalchemy import text
from database import wait_for_database, Base
from models import User, Store
from auth.passwords import hash_password

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_tables(engine):
    """Create all database tables"""
    try:
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully!")
        return True
    except Exception as e:
        logger.error(f"Failed to create tables: {str(e)}")
        return False

def create_admin_user(engine):
    """Create default admin user if it doesn't exist"""
    try:
        from sqlalchemy.orm import sessionmaker
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        
        # Check if admin user already exists
        existing_admin = db.query(User).filter(User.username == "admin").first()
        if existing_admin:
            logger.info("Admin user already exists")
            db.close()
            return True
        
        # Create admin user
        admin_user = User(
            username="admin",
            name="System Administrator",
            role="admin",
            password=hash_password("admin123"),
            is_active=True,
            store=None  # Admins don't belong to specific stores
        )
        
        db.add(admin_user)
        db.commit()
        logger.info("✅ Admin user created successfully!")
        logger.info("   Username: admin")
        logger.info("   Password: admin123")
        logger.info("   ⚠️  CHANGE THE PASSWORD AFTER FIRST LOGIN!")
        
        db.close()
        return True
        
    except Exception as e:
        logger.error(f"Failed to create admin user: {str(e)}")
        return False

def create_default_store(engine):
    """Create a default store for testing"""
    try:
        from sqlalchemy.orm import sessionmaker
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        
        # Check if default store exists
        existing_store = db.query(Store).filter(Store.name == "Main Store").first()
        if existing_store:
            logger.info("Default store already exists")
            db.close()
            return True
        
        # Create default store
        default_store = Store(
            name="Main Store",
            code="MAIN",
            is_active=True,
            rider_limit=50,
            default_base_pay_cents=1000  # $10.00
        )
        
        db.add(default_store)
        db.commit()
        logger.info("✅ Default store created successfully!")
        
        db.close()
        return True
        
    except Exception as e:
        logger.error(f"Failed to create default store: {str(e)}")
        return False

def main():
    """Main initialization function"""
    logger.info("🚀 Starting database initialization...")
    
    try:
        # Wait for database to be available
        engine = wait_for_database()
        
        # Create tables
        if not create_tables(engine):
            logger.error("Failed to create tables, exiting...")
            return False
        
        # Create admin user
        if not create_admin_user(engine):
            logger.error("Failed to create admin user, exiting...")
            return False
        
        # Create default store
        if not create_default_store(engine):
            logger.error("Failed to create default store, exiting...")
            return False
        
        logger.info("✅ Database initialization completed successfully!")
        return True
        
    except Exception as e:
        logger.error(f"Database initialization failed: {str(e)}")
        return False

if __name__ == "__main__":
    success = main()
    if not success:
        exit(1)
    exit(0)