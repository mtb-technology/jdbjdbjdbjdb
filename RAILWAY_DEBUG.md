# Railway Deployment Debugging Guide

If your deployment fails or health checks are failing, follow this guide.

## Common Issues and Solutions

### 1. Health Check Failures (503 Service Unavailable)

**Symptoms:**
- Railway shows "Service Unavailable"
- Health checks timing out
- Can't access the application

**Causes & Solutions:**

#### A. Node.js App Not Starting

Check Railway logs for:
```
❌ Invalid environment configuration
❌ Database connection failed
```

**Solution:** Verify ALL environment variables are set in Railway:
```
DATABASE_URL=postgresql://...
GOOGLE_AI_API_KEY=...
OPENAI_API_KEY=...
AUTH_PASSWORD=...
SESSION_SECRET=...
```

#### B. Database Connection Issues

Check Railway logs for:
```
❌ Database connection error
⚠️ Database connection failed
```

**Solution:**
1. Verify `DATABASE_URL` is correct
2. Check your Neon database is running
3. Ensure Neon allows connections from Railway (0.0.0.0/0)
4. Test the connection string manually

#### C. Port Configuration Issues

Check Railway logs for:
```
Error: listen EADDRINUSE
❌ Failed to bind to port
```

**Solution:**
- Railway automatically sets `PORT` environment variable
- nginx listens on `$PORT` (Railway's port)
- Node.js app should listen on port 5000 (hardcoded in Dockerfile)
- Don't override `PORT=5000` in Railway variables (let Railway set it)

### 2. Authentication Not Working

**Symptoms:**
- No password prompt appears
- Getting 401 errors
- Password not accepted

**Solutions:**

#### No Password Prompt
- Clear browser cache
- Try incognito/private mode
- Verify `AUTH_PASSWORD` is set in Railway
- Check Railway logs for: `✅ Password authentication configured`

#### 401 Unauthorized
- Username must be `admin` (lowercase)
- Password must match `AUTH_PASSWORD` exactly
- Clear browser authentication cache
- Check Railway logs for nginx errors

### 3. Application Crashes After Starting

**Symptoms:**
- App starts but crashes after a few seconds
- 502 Bad Gateway errors
- Railway shows "Crashed" status

**Check Railway logs for:**
```
Error: Out of memory
Error: ECONNREFUSED
Segmentation fault
```

**Solutions:**
- Increase Railway memory allocation
- Check for infinite loops in code
- Verify AI API keys are valid
- Check database connection pooling settings

### 4. Slow Startup (Health Check Timeout)

**Symptoms:**
- Deployment takes >5 minutes
- Health checks fail during startup
- Eventually works after retries

**Solutions:**
- Current startup script waits up to 60 seconds for app
- Increase `healthcheckTimeout` in `railway.json`
- Check if database migrations are slow
- Verify AI service warm-up isn't blocking

## How to Debug

### Step 1: Check Railway Build Logs

1. Go to Railway dashboard
2. Click your service
3. Click "Deployments" tab
4. Click the failing deployment
5. Check "Build Logs"

Look for:
- ✅ Build completed successfully
- ❌ Build failed
- Missing dependencies

### Step 2: Check Railway Deploy Logs

In the same deployment view, check "Deploy Logs":

**Good signs:**
```
🚀 Starting De Fiscale Analist with nginx password protection...
📦 Starting Node.js application on port 5000...
✅ Password authentication configured for user: admin
⏳ Waiting for Node.js app to be ready...
✅ Node.js app is ready!
🌐 Starting nginx on port $PORT...
```

**Bad signs:**
```
❌ Invalid environment configuration
❌ Database connection failed
❌ Node.js app failed to start (process died)
❌ Timeout waiting for Node.js app to start
```

### Step 3: Check Health Endpoint Manually

Once deployed, try accessing the health endpoint directly:

```bash
# This should work WITHOUT authentication
curl https://your-app.railway.app/api/health

# Should return:
{"success":true,"data":{"status":"healthy","timestamp":"...","uptime":123}}
```

If this fails:
- Node.js app is not running
- nginx is not proxying correctly
- Port configuration is wrong

### Step 4: Check nginx Logs

SSH into Railway container (if possible) or check logs for:

```
nginx error log:
- connect() failed (111: Connection refused)
  → Node.js not running on port 5000

- no such file or directory
  → .htpasswd file not created

- upstream timed out
  → Node.js app is too slow to respond
```

## Environment Variables Checklist

Copy this and verify each one is set in Railway:

- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `GOOGLE_AI_API_KEY` - Google AI API key
- [ ] `OPENAI_API_KEY` - OpenAI API key
- [ ] `AUTH_PASSWORD` - Your chosen password
- [ ] `SESSION_SECRET` - Random 32-byte hex string
- [ ] `NODE_ENV` - Should be "production" (Railway sets automatically)
- [ ] `PORT` - Railway sets automatically (DON'T override)

## Still Having Issues?

1. Check this file for your specific error message
2. Review Railway logs carefully
3. Test locally with Docker:
   ```bash
   docker build -t test-app .
   docker run -p 3000:3000 \
     -e PORT=3000 \
     -e DATABASE_URL=your-url \
     -e AUTH_PASSWORD=test123 \
     -e GOOGLE_AI_API_KEY=your-key \
     -e OPENAI_API_KEY=your-key \
     -e SESSION_SECRET=your-secret \
     test-app
   ```
3. Check Railway status page (status.railway.app)
4. Contact Railway support if platform issue

## Quick Fixes

### Force Redeploy
Sometimes Railway cache causes issues:
1. Go to Railway dashboard
2. Settings → Deployments
3. Click "Redeploy" with "Clear build cache"

### Restart Service
1. Go to Railway dashboard
2. Click your service
3. Settings → "Restart"

### Check Resource Usage
1. Railway dashboard → your service
2. Metrics tab
3. Check CPU, Memory, Network
4. Increase if hitting limits
