# Password Protection Setup

This application is protected with nginx basic authentication to ensure only authorized internal users can access it.

## How It Works

- **Nginx Reverse Proxy**: All requests go through nginx first
- **Basic Authentication**: Username/password prompt before accessing the app
- **Application Protection**: Everything is protected - no routes are exposed without authentication
- **Production Deployment**: Runs on Railway with Docker + nginx

## Setup Instructions

### 1. Railway Deployment

1. **Add Environment Variable** in Railway dashboard:
   ```
   AUTH_PASSWORD=your-strong-password-here
   ```

2. **Deploy**: Railway will automatically use the Dockerfile which:
   - Builds your Node.js application
   - Sets up nginx with basic auth
   - Creates `.htpasswd` file from `AUTH_PASSWORD`
   - Starts both nginx (port $PORT) and your app (port 5000)

3. **Access the Application**:
   - Username: `admin`
   - Password: Whatever you set in `AUTH_PASSWORD`

### 2. Local Development (Optional)

For local development, you don't need nginx - just run:

```bash
npm run dev
```

If you want to test the nginx auth locally:

```bash
# Build the Docker image
docker build -t fiscale-analist .

# Run with authentication
docker run -p 3000:3000 -e PORT=3000 -e AUTH_PASSWORD=testpassword \
  -e DATABASE_URL=your-db-url \
  -e GOOGLE_AI_API_KEY=your-key \
  -e OPENAI_API_KEY=your-key \
  fiscale-analist
```

Then visit http://localhost:3000 and login with:
- Username: `admin`
- Password: `testpassword`

## Security Notes

1. **HTTPS**: Railway provides automatic HTTPS, so credentials are transmitted securely
2. **Strong Password**: Use a strong, random password for `AUTH_PASSWORD`
3. **Internal Only**: This is designed for 2-3 internal users - not public-facing
4. **No Bypass**: All routes (including API endpoints) require authentication
5. **Session Management**: After initial login, browser caches credentials
6. **Health Check Exception**: `/api/health` is NOT password-protected (Railway needs this for monitoring)
   - Only returns: `status`, `timestamp`, `uptime`
   - No sensitive data exposed
   - All other endpoints (`/api/health/full`, `/api/health/detailed`, etc.) remain protected

## Changing Password

To change the password:

1. Update `AUTH_PASSWORD` in Railway environment variables
2. Redeploy the application
3. Users will need to use the new password on next access

## Troubleshooting

**Problem**: "401 Unauthorized" even with correct password
- Solution: Clear browser cache and try again

**Problem**: Application not accessible
- Check Railway logs for nginx errors
- Verify `AUTH_PASSWORD` is set in environment variables

**Problem**: "502 Bad Gateway"
- The Node.js app (port 5000) may not be running
- Check Railway logs for application startup errors

## Architecture

```
Internet Request
    ↓
Railway (HTTPS)
    ↓
nginx (port $PORT) ← AUTH CHECK HERE
    ↓ (if authenticated)
Node.js App (port 5000)
```

All traffic must pass through nginx's basic auth before reaching your application.
