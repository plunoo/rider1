import time
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.exc import OperationalError
from app.config import DATABASE_URL

logger = logging.getLogger(__name__)

def create_database_engine():
    """Create database engine with retry logic"""
    max_retries = 5
    retry_delay = 2  # seconds
    
    for attempt in range(max_retries):
        try:
            logger.info(f"Attempting to connect to database (attempt {attempt + 1}/{max_retries})")
            
            # Create engine with connection pooling and retry settings
            engine = create_engine(
                DATABASE_URL,
                pool_size=5,
                pool_timeout=30,
                pool_recycle=3600,
                pool_pre_ping=True,  # Validates connections before use
                connect_args={
                    "connect_timeout": 10,
                    "application_name": "rider_management_app"
                }
            )
            
            # Test the connection
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
                logger.info("Database connection successful!")
                return engine
                
        except OperationalError as e:
            logger.warning(f"Database connection attempt {attempt + 1} failed: {str(e)}")
            if attempt < max_retries - 1:
                logger.info(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
            else:
                logger.error("All database connection attempts failed!")
                raise
        except Exception as e:
            logger.error(f"Unexpected database error: {str(e)}")
            raise

def wait_for_database():
    """Wait for database to be available"""
    max_wait_time = 60  # seconds
    check_interval = 2  # seconds
    elapsed_time = 0
    
    logger.info("Waiting for database to become available...")
    
    while elapsed_time < max_wait_time:
        try:
            engine = create_database_engine()
            logger.info("Database is ready!")
            return engine
        except Exception as e:
            logger.info(f"Database not ready yet ({elapsed_time}s elapsed): {str(e)}")
            time.sleep(check_interval)
            elapsed_time += check_interval
    
    raise Exception("Database did not become available within the timeout period")

# Initialize engine with auto-retry
engine = create_database_engine()
SessionLocal = sessionmaker(bind=engine)

Base = declarative_base()

def get_db():
    """Get database session with error handling"""
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database session error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()