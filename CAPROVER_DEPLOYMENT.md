# CapRover Production Deployment Guide

This guide will walk you through deploying the Rider Management System to CapRover using your existing PostgreSQL database.

## Prerequisites
- CapRover installed and accessible
- PostgreSQL database already deployed: `srv-captain--db:5432`
- Git repository at `https://github.com/plunoo/rider1.git`

## Database Information
Your PostgreSQL database is already deployed with these details:
```
Host: srv-captain--db
Port: 5432
Database: postgres
User: postgres
Password: d5aef14c8274f6be
```

## Step 1: Create the Main App

1. **Login to CapRover Dashboard**
   - Go to your CapRover URL

2. **Create New App**
   - Go to "Apps"
   - Click "Create a New App"
   - App name: `rider-app` (or your preferred name)
   - Leave "Has Persistent Data" unchecked (using external database)
   - Click "Create New App"

3. **Enable HTTPS (Optional but Recommended)**
   - Click on your app `rider-app`
   - Go to "HTTP Settings" tab
   - Enable "Force HTTPS"
   - Enable "Enable HTTPS" 
   - Enter your domain and click "Enable HTTPS"

## Step 2: Configure Environment Variables

1. **Navigate to App Settings**
   - Click on `rider-app`
   - Go to "App Configs" tab

2. **Add Environment Variables**
   Click "Add Key" and add these variables exactly:

   ```bash
   # Database Configuration (REQUIRED)
   DATABASE_URL=postgresql://postgres:d5aef14c8274f6be@srv-captain--db:5432/postgres
   
   # Security (REQUIRED)
   JWT_SECRET=6oLdHF8/W51aJFh6A3v0Mt1uJOM/cnbq6LTXAoCWvAc=
   
   # Production Environment
   ENVIRONMENT=production
   
   # Token Settings
   ACCESS_TOKEN_EXPIRE_MINUTES=1440
   
   # Data Retention
   LOCATION_RETENTION_DAYS=30
   ```

3. **Save Environment Variables**
   - Click "Save & Update"
   - Click "Save Configuration"

## Step 3: Deploy the Application

### Option A: Deploy via GitHub (Recommended)

1. **Connect GitHub Repository**
   - Go to "Deployment" tab
   - Select "Deploy via GitHub/GitLab/Bitbucket"
   - Authorize CapRover with GitHub
   - Repository: `plunoo/rider1`
   - Branch: `main`
   - Click "Save & Update"
   - Click "Force Build"

### Option B: Deploy via CapRover CLI

1. **Install CapRover CLI**
   ```bash
   npm install -g caprover
   ```

2. **Login to CapRover**
   ```bash
   caprover login
   ```

3. **Deploy from Project Directory**
   ```bash
   cd "/Users/jasper/Documents/dev11/rider app 2.0"
   caprover deploy -a rider-app
   ```

## Step 4: Initialize Database and Create Admin User

1. **Wait for Deployment to Complete**
   - Check that app status shows "Running" (green)
   - Check logs for any errors

2. **Access App Terminal**
   - In CapRover dashboard, go to your app
   - Go to "HTTP Settings" tab
   - Click "Open Web Terminal"

3. **Create Database Tables**
   ```bash
   cd /app
   python -c "
   from app.database import Base, engine
   from app import models
   Base.metadata.create_all(bind=engine)
   print('✅ Database tables created successfully!')
   "
   ```

4. **Create Admin User**
   ```bash
   python seed_admin.py
   ```
   
   This creates an admin user with:
   - **Username:** `admin`
   - **Password:** `admin123`
   - **⚠️ IMPORTANT:** Change password after first login!

## Step 5: Test the Application

1. **Get Your App URL**
   - Note your app URL from CapRover (e.g., `https://rider-app.yourdomain.com`)
   - Or use the default: `https://rider-app.captain.yourdomain.com`

2. **Test API Endpoints**
   ```bash
   # Test if API is working
   curl https://your-app-url.com/auth/stores
   # Should return: []
   ```

3. **Test Admin Login**
   ```bash
   # Test login endpoint
   curl -X POST https://your-app-url.com/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   # Should return JWT token
   ```

4. **Access Application**
   - Go to your app URL
   - The app runs on port 8000 and serves the FastAPI backend
   - Use API documentation at: `https://your-app-url.com/docs`

## Step 6: Post-Deployment Configuration

1. **Change Admin Password**
   - Use the API or create a script to change the default password
   - **Never leave default credentials in production!**

2. **Monitor Application**
   - Check CapRover logs regularly
   - Monitor database performance
   - Set up alerts if needed

## Application Architecture

This deployment creates:
- **Backend Only**: FastAPI application on port 8000
- **Database**: Uses your existing PostgreSQL at `srv-captain--db`
- **API Access**: All endpoints available at `/auth/*`, `/api/*`
- **Documentation**: Automatic API docs at `/docs`

## Troubleshooting

### App Won't Start
1. Check environment variables are set correctly
2. Review app logs in CapRover
3. Verify DATABASE_URL connection

### Database Connection Issues
```bash
# Test connection in app terminal
cd /app
python -c "
from app.database import engine
try:
    with engine.connect() as conn:
        result = conn.execute('SELECT version()')
        print('✅ Connected:', result.fetchone())
except Exception as e:
    print('❌ Failed:', e)
"
```

### Common Issues
- **502 Error**: App not starting - check logs
- **Database Error**: Verify DATABASE_URL format
- **Auth Error**: Ensure JWT_SECRET is set

## API Endpoints

Once deployed, your API will be available at:
- `GET /auth/stores` - List stores
- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `GET /docs` - API documentation
- And many more endpoints for the full rider management system

## Security Notes

- ✅ Database password is already secure
- ✅ JWT secret is properly configured
- ✅ Production environment is set
- ⚠️ **Remember to change admin password!**
- 🔒 Enable HTTPS for production use

## Next Steps

After successful deployment:
1. Change admin credentials
2. Create your first store
3. Set up rider registration
4. Configure any additional features needed
5. Set up monitoring and backups

Your Rider Management System is now ready for production use!