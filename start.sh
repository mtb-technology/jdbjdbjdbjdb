#!/bin/sh
set -e

echo "🚀 Starting De Fiscale Analist with nginx password protection..."

# Start Node.js application in background
cd /app
echo "📦 Starting Node.js application on port 5000..."
NODE_ENV=production PORT=5000 node dist/index.js 2>&1 | sed 's/^/[app] /' &
APP_PID=$!

# Wait for Node.js app to be ready (check health endpoint internally)
echo "⏳ Waiting for Node.js app to be ready..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -f -s http://127.0.0.1:5000/api/health > /dev/null 2>&1; then
        echo "✅ Node.js app is ready!"
        break
    fi

    # Check if app process is still running
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Node.js app failed to start (process died)"
        exit 1
    fi

    sleep 1
    WAITED=$((WAITED + 1))

    if [ $((WAITED % 10)) -eq 0 ]; then
        echo "   Still waiting... (${WAITED}s/${MAX_WAIT}s)"
    fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo "❌ Timeout waiting for Node.js app to start"
    exit 1
fi

# Start nginx in foreground
echo "🌐 Starting nginx on port $PORT..."
exec nginx -g 'daemon off;'
