# CapRover Production Deployment Guide

This guide will walk you through deploying the Rider Management System to CapRover with PostgreSQL database and all production configurations.

## Prerequisites
- CapRover installed and accessible
- Domain configured (optional but recommended)
- Git repository or ability to push code

## Step 1: Deploy PostgreSQL Database

1. **Login to CapRover Dashboard**
   - Go to your CapRover URL (e.g., `https://captain.yourdomain.com`)

2. **Deploy PostgreSQL from One-Click Apps**
   - Navigate to "Apps" → "One-Click Apps/Databases"
   - Search for "PostgreSQL"
   - Click "Deploy"
   - Set app name: `rider-db`
   - Configure:
     - PostgreSQL Root Password: `[GENERATE_STRONG_PASSWORD]`
     - PostgreSQL Database: `riderdb`
     - PostgreSQL User: `rideruser`
     - PostgreSQL Password: `[GENERATE_STRONG_PASSWORD]`
   - Click "Deploy"
   - Wait for deployment to complete

3. **Note Database Connection Details**
   ```
   Host: srv-captain--rider-db
   Port: 5432
   Database: riderdb
   User: rideruser
   Password: [YOUR_PASSWORD]
   ```

## Step 2: Create the Main App

1. **Create New App**
   - Go to "Apps"
   - Click "Create a New App"
   - App name: `rider-app`
   - Check "Has Persistent Data" (for uploaded files if needed)
   - Click "Create New App"

2. **Enable HTTPS (Recommended)**
   - Click on your app `rider-app`
   - Go to "HTTP Settings" tab
   - Enable "Force HTTPS"
   - Enable "Enable HTTPS" 
   - Enter your domain and click "Enable HTTPS"

## Step 3: Configure Environment Variables

1. **Navigate to App Settings**
   - Click on `rider-app`
   - Go to "App Configs" tab

2. **Add Environment Variables**
   Click "Add Key" and add these variables:

   ```bash
   # Database Configuration (REQUIRED)
   DATABASE_URL=postgresql://rideruser:[YOUR_PASSWORD]@srv-captain--rider-db:5432/riderdb
   
   # Security (REQUIRED - Generate a strong secret)
   JWT_SECRET=[GENERATE_STRONG_SECRET_KEY]
   
   # Production Environment
   ENVIRONMENT=production
   
   # Token Settings
   ACCESS_TOKEN_EXPIRE_MINUTES=1440
   PASSWORD_RESET_TTL_MINUTES=60
   
   # Data Retention
   LOCATION_RETENTION_DAYS=30
   
   # CORS (if frontend on different domain)
   CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
   
   # Optional: Host filtering
   ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
   ```

3. **Save Environment Variables**
   - Click "Save & Update"
   - Click "Save Configuration"

## Step 4: Deploy the Application

### Option A: Deploy via Git (Recommended)

1. **Connect GitHub/GitLab/Bitbucket**
   - In "Deployment" tab
   - Select "Deploy via GitHub/GitLab/Bitbucket"
   - Authorize CapRover
   - Select your repository
   - Select branch (e.g., `main` or `master`)
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
   Enter your CapRover URL and password

3. **Deploy from Project Directory**
   ```bash
   cd "/Users/jasper/Documents/dev11/rider app 2.0"
   caprover deploy -a rider-app
   ```

### Option C: Deploy via Tarball Upload

1. **Create Deployment Package**
   ```bash
   cd "/Users/jasper/Documents/dev11/rider app 2.0"
   tar -czf deploy.tar.gz --exclude node_modules --exclude .git .
   ```

2. **Upload in CapRover**
   - Go to "Deployment" tab
   - Select "Deploy via Upload"
   - Upload `deploy.tar.gz`
   - Click "Deploy Now"

## Step 5: Initialize Database and Admin User

1. **Access App Container**
   - In CapRover dashboard, go to your app
   - Click "Open Web Terminal" (or use SSH)

2. **Run Database Migrations**
   ```bash
   cd /app
   python -c "from database import engine, Base; from models import *; Base.metadata.create_all(bind=engine)"
   ```

3. **Create Admin User**
   ```bash
   python seed_admin.py
   ```
   This will create an admin user with:
   - Email: `admin@example.com`
   - Password: `admin123`
   - **IMPORTANT**: Change these credentials immediately after first login!

## Step 6: Verify Deployment

1. **Check Application Status**
   - Go to your app URL: `https://rider-app.yourdomain.com`
   - You should see the login page

2. **Test Login**
   - Login with admin credentials
   - Navigate through the dashboard
   - Check all major features

3. **Monitor Logs**
   - In CapRover dashboard, click "App Logs"
   - Check for any errors

## Step 7: Post-Deployment Configuration

1. **Change Admin Password**
   - Login as admin
   - Go to Settings/Profile
   - Change password immediately

2. **Configure Push Notifications (Optional)**
   - Generate VAPID keys if using push notifications
   - Add to environment variables:
     ```
     VAPID_PUBLIC_KEY=your_public_key
     VAPID_PRIVATE_KEY=your_private_key
     VAPID_CLAIM_EMAIL=admin@yourdomain.com
     ```

3. **Setup Backup Strategy**
   - Configure PostgreSQL backups in CapRover
   - Set up regular database backups

4. **Configure Monitoring**
   - Set up health checks
   - Configure alerts for downtime

## Step 8: Scaling (Optional)

1. **Increase Instance Count**
   - In "App Configs" tab
   - Increase "Instance Count" for load balancing
   - Click "Save & Update"

2. **Configure Resources**
   - Set memory limits
   - Set CPU limits based on your needs

## Troubleshooting

### Database Connection Issues
- Verify DATABASE_URL is correct
- Check if database container is running
- Ensure network connectivity between containers

### Build Failures
- Check build logs in CapRover
- Ensure all files are included in deployment
- Verify captain-definition syntax

### Application Not Starting
- Check environment variables are set
- Review application logs
- Verify JWT_SECRET is set

### CORS Issues
- Update CORS_ORIGINS environment variable
- Include your frontend domain

## Security Checklist

- [ ] Changed default admin credentials
- [ ] Set strong JWT_SECRET
- [ ] Enabled HTTPS
- [ ] Configured CORS properly
- [ ] Set up database backups
- [ ] Reviewed and hardened environment variables
- [ ] Enabled CapRover firewall rules if needed

## Maintenance

### Update Application
1. Push changes to Git repository
2. In CapRover, click "Build Now" or it auto-builds if webhook configured

### Database Maintenance
1. Access PostgreSQL container
2. Run maintenance commands as needed
3. Regular backups are crucial

### Monitor Performance
1. Check CapRover metrics
2. Monitor application logs
3. Set up external monitoring (optional)

## Support

For issues specific to:
- CapRover: Check [CapRover Docs](https://caprover.com/docs/)
- Application: Review application logs and error messages
- Database: Check PostgreSQL container logs

Remember to keep your CapRover instance updated and maintain regular backups of your database!