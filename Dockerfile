# Multi-stage build for production deployment with nginx auth protection
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage with nginx
FROM nginx:alpine

# Install Node.js runtime and curl for health checks
RUN apk add --no-cache nodejs npm apache2-utils curl

# Copy nginx configuration
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Copy built application
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package*.json /app/

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Create htpasswd file from environment variable
# The AUTH_PASSWORD environment variable should be set in Railway
RUN echo '#!/bin/sh' > /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo 'if [ -n "$AUTH_PASSWORD" ]; then' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo '  echo "$AUTH_PASSWORD" | htpasswd -c -i /etc/nginx/.htpasswd admin' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo '  echo "✅ Password authentication configured for user: admin"' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo 'else' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo '  echo "⚠️ WARNING: No AUTH_PASSWORD set. Using default password: changeme"' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo '  echo "changeme" | htpasswd -c -i /etc/nginx/.htpasswd admin' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    echo 'fi' >> /docker-entrypoint.d/40-generate-htpasswd.sh && \
    chmod +x /docker-entrypoint.d/40-generate-htpasswd.sh

# Use startup script that waits for app to be ready
CMD ["/start.sh"]

EXPOSE $PORT
