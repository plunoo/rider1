# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack rider management system with role-based access for riders, captains, and admins. Built with FastAPI (backend) and React TypeScript (frontend).

## Development Commands

### Frontend (React + Vite)
```bash
cd frontend
npm install           # Install dependencies
npm run dev           # Start development server (port 5173)
npm run build         # Build for production
npm run preview       # Preview production build
```

### Backend (FastAPI)
```bash
cd backend/app
pip install -r requirements.txt   # Install Python dependencies
uvicorn main:app --reload        # Development server (port 8000)
```

### Docker
```bash
docker-compose up --build         # Run full stack with Docker
docker build --target backend -t rider-backend .   # Build backend only
docker build --target frontend -t rider-frontend . # Build frontend only
```

## Architecture

### Backend Structure
- **FastAPI application** at `backend/app/main.py`
- **Database models** in `backend/app/models.py` using SQLAlchemy ORM
- **Authentication** via JWT tokens in `backend/app/auth/`
- **Role-based routers**:
  - Admin endpoints: `routers/admin.py`
  - Captain endpoints: `routers/captain.py`
  - Rider endpoints: `routers/riders.py`
  - Shared features: attendance, shifts, tracking, deliveries, messages, earnings
- **Database**: Supports PostgreSQL (production) and SQLite (development)
- **Environment variables** required:
  - `DATABASE_URL`: Database connection string
  - `JWT_SECRET`: Secret key for JWT tokens

### Frontend Structure
- **React SPA** with TypeScript and Vite
- **Three role-based layouts**:
  - `pages/admin/AdminLayout.tsx`: Admin dashboard with full management
  - `pages/captain/CaptainLayout.tsx`: Captain features for team management
  - `pages/rider/RiderLayout.tsx`: Rider self-service portal
- **Authentication context** at `src/auth/AuthContext.tsx` handles JWT token management
- **API client** at `src/api/client.ts` with axios interceptors for auth
- **Internationalization** in `src/i18n/` with English and French support
- **Service Worker** for push notifications at `public/sw.js`

### Key Architectural Patterns
1. **Role-based access control**: User roles (rider/captain/admin) determined by JWT claims
2. **API communication**: Frontend uses axios with auth interceptors, backend CORS configured
3. **Real-time features**: Push notifications via WebPush, location tracking with geofencing
4. **Multi-tenant**: Store-based segregation with rider assignments and shift management
5. **Offline support**: Service worker for PWA capabilities and push notifications

## Database Schema Key Relationships
- Users → Stores (many-to-many via user_stores)
- Shifts → Stores (riders check in to shifts at specific stores)
- Deliveries → Users (tracking delivery assignments and earnings)
- Messages → Threads → Users (threaded messaging system)
- LocationUpdates → Users (real-time tracking with retention policies)

## Production Deployment Notes
- Set `ENVIRONMENT=production` for secure defaults
- Configure CORS_ORIGINS for cross-domain requests
- Database migrations handled automatically on startup
- Frontend API URL configured via `VITE_API_BASE_URL` build arg
- HTTPS required for push notifications and location services