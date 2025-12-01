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

# Copy built application
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/package*.json /app/

# Copy startup scripts
COPY start.sh /start.sh
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /start.sh /docker-entrypoint.sh

# Use entrypoint that configures nginx then starts app
CMD ["/docker-entrypoint.sh"]

EXPOSE $PORT
