# Multi-stage Dockerfile to build both backend (FastAPI) and frontend (Vite + nginx)

# --------------------
# Backend build stage
# --------------------
FROM python:3.11-slim AS backend-builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/app/requirements.txt ./requirements.txt
RUN pip install --upgrade pip \
    && pip install --no-cache-dir --prefix /install -r ./requirements.txt

# --------------------
# Backend runtime
# --------------------
FROM python:3.11-slim AS backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

# Build-time defaults; override via build args or env at runtime
ARG PORT=8000
ARG WEB_CONCURRENCY=4
ENV PORT=${PORT} \
    WEB_CONCURRENCY=${WEB_CONCURRENCY}

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /install /usr/local
COPY backend/app /app

RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app
USER app

EXPOSE 8000
CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-4} -b 0.0.0.0:${PORT:-8000} app.main:app"]

# --------------------
# Frontend build stage
# --------------------
FROM node:18-alpine AS frontend-build
WORKDIR /app

ENV NODE_ENV=production

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
ARG VITE_API_BASE_URL=http://api.johnsonzoglo.com
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# --------------------
# Frontend runtime
# --------------------
FROM nginx:alpine AS frontend

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html

ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
