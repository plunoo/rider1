# Build stage to compile dependencies
FROM python:3.11-slim AS builder

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


# Runtime image
FROM python:3.11-slim

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

# Runtime libs only (no compilers)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed deps from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY backend/app /app

# Drop privileges
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app
USER app

EXPOSE 8000

# Use gunicorn with uvicorn workers for production
CMD ["sh", "-c", "gunicorn -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-4} -b 0.0.0.0:${PORT:-8000} app.main:app"]
