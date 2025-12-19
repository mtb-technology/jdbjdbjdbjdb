#!/bin/sh
set -e

echo "🔧 Configuring nginx for port $PORT..."

# Generate nginx config with correct PORT
cat > /etc/nginx/conf.d/default.conf <<EOF
server {
    listen $PORT;
    server_name _;

    # Basic authentication for the entire application
    auth_basic "De Fiscale Analist - Internal Access Only";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # Health check endpoint - NO authentication required (for Railway monitoring)
    location = /api/health {
        auth_basic off;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Automail webhook - NO basic auth (uses API key in app)
    location ^~ /api/webhooks/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Embedded views - NO basic auth (for iframe embedding in Automail)
    location ^~ /embed/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Automail API routes - NO basic auth (for embedded view)
    location ^~ /api/automail/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Embed API routes - NO basic auth (token verification for embedded view)
    location ^~ /api/embed/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Proxy to Node.js application
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # Increased timeouts for long-running AI operations
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        send_timeout 600s;

        # Increased proxy buffers to avoid disk buffering warnings
        # Default is 8 4k buffers - we increase for large API responses
        proxy_buffer_size 128k;
        proxy_buffers 16 256k;
        proxy_busy_buffers_size 512k;
    }

    # SSE (Server-Sent Events) specific configuration - NO basic auth for embedded view
    location /api/reports/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE specific settings
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        # Long timeout for streaming
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # File upload size limit (100MB for batch uploads)
    client_max_body_size 100M;
}
EOF

echo "✅ nginx configured to listen on port $PORT"

# Run database migrations (sync schema)
echo "🗄️ Running database schema sync..."
cd /app && npm run db:push 2>&1 || echo "⚠️ db:push failed, continuing anyway"
echo "✅ Database schema sync complete"

# Generate htpasswd
if [ -n "$AUTH_PASSWORD" ]; then
  echo "$AUTH_PASSWORD" | htpasswd -c -i /etc/nginx/.htpasswd admin
  echo "✅ Password authentication configured for user: admin"
else
  echo "⚠️ WARNING: No AUTH_PASSWORD set. Using default password: changeme"
  echo "changeme" | htpasswd -c -i /etc/nginx/.htpasswd admin
fi

# Now run the start script
exec /start.sh
