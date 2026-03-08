# Dokploy Deployment Guide for Rider Management System

## Step 1: Login to Dokploy Dashboard
1. Access your Dokploy instance
2. Navigate to Applications section

## Step 2: Create New Application
1. Click "Create Application"
2. Name: `rider-app`
3. Select "Docker" as deployment type

## Step 3: Configure GitHub Repository
1. Repository URL: `https://github.com/plunoo/rider1.git`
2. Branch: `main`
3. Auto-deploy: Enable (optional)

## Step 4: Docker Configuration
1. Dockerfile Path: `Dockerfile.production`
2. Port: `80`
3. Health Check Path: `/health`

## Step 5: Environment Variables
Add these in Dokploy's Environment Variables section:

```env
# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_USER=postgres
DB_NAME=postgres
DB_PASSWORD=d5aef14c8274f6be
DATABASE_URL=postgresql://postgres:d5aef14c8274f6be@postgres:5432/postgres

# Security
JWT_SECRET=6oLdHF8/W51aJFh6A3v0Mt1uJOM/cnbq6LTXAoCWvAc=
ENVIRONMENT=production

# Application Settings
ACCESS_TOKEN_EXPIRE_MINUTES=1440
PASSWORD_RESET_TTL_MINUTES=60
LOCATION_RETENTION_DAYS=30
```

## Step 6: PostgreSQL Database Link
1. In Dokploy, link your existing PostgreSQL database
2. Service name should be: `postgres`
3. This allows the app container to connect to database

## Step 7: Deploy
1. Click "Deploy" button
2. Monitor logs for:
   - "Database connection established!"
   - "Database tables created successfully!"
   - "Admin user created! Login: admin/admin123"
   - "Starting application services..."

## Step 8: Configure Domain (Optional)
1. Add custom domain in Dokploy
2. Enable SSL/TLS certificate
3. Update CORS_ORIGINS in environment variables

## Step 9: Test Application
1. Access your application URL
2. Login credentials:
   - Username: `admin`
   - Password: `admin123`
3. Change admin password immediately after first login

## Monitoring
- Check application logs in Dokploy dashboard
- Health endpoint: `/health`
- Backend logs: Available in Dokploy logs
- Frontend served on root `/`
- API available at `/api/*`

## Troubleshooting
1. If database connection fails:
   - Verify PostgreSQL service name is `postgres`
   - Check database credentials in environment variables
   
2. If login fails:
   - Check backend logs for errors
   - Verify JWT_SECRET is set correctly
   - Ensure database tables were created

3. If 502 error:
   - Check if backend started successfully
   - Verify supervisor logs in Dokploy
   - Ensure port 8000 is used internally for backend

## Notes
- Application auto-initializes database on first run
- Admin user created automatically
- Frontend built during Docker image creation
- Nginx proxies API requests to backend
- Supervisor manages both nginx and uvicorn processes