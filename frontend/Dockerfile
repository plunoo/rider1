FROM node:18-alpine AS build
WORKDIR /app

ENV NODE_ENV=production

# Install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Build static assets
COPY frontend ./
ARG VITE_API_BASE_URL=http://api.johnsonzoglo.com
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM nginx:alpine
# Custom nginx config for SPA routing and caching
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
# Static assets
COPY --from=build /app/dist /usr/share/nginx/html

ENV PORT=80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
