# rider
Rider management system

## Docker
- Build backend: `docker build --target backend -t rider-backend .`
- Build frontend: `docker build --target frontend -t rider-frontend .`
- Compose (uses the root Dockerfile targets): `docker-compose up --build`
- Env needed for backend: `DATABASE_URL`, `JWT_SECRET` (see `.env.example`)
- Optional backend env: `ACCESS_TOKEN_EXPIRE_MINUTES`, `CORS_ORIGINS` (comma-separated)
- Optional backend env: `PASSWORD_RESET_TTL_MINUTES`, `LOCATION_RETENTION_DAYS`
- Override frontend API URL at build time: `VITE_API_BASE_URL`

## Dokploy quick setup
- Repo: `https://github.com/johnsonzoglo/rider.git`, branch `rider`.
- Build context/path: `.`
- Dockerfile path: `Dockerfile`.
- Build target: `backend` (FastAPI, port 8000) or `frontend` (nginx static, port 80).
- Required backend env vars: `DATABASE_URL`, `JWT_SECRET` (backend exits if missing).
- Frontend build arg: `VITE_API_BASE_URL` (e.g., `https://api.johnsonzoglo.com`).

## Production checklist
1. Set `ENVIRONMENT=production` and a strong `JWT_SECRET`.
2. Set `DATABASE_URL` to your production database.
3. If the frontend and backend are on different domains, set `CORS_ORIGINS` to the frontend origin(s).
4. If you want host filtering, set `ALLOWED_HOSTS` (comma-separated).
5. Build and run using Docker or your process manager with reload disabled.
