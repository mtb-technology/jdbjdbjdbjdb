# Deployment Guide - Railway

This guide covers deploying "De Fiscale Analist" to Railway with nginx password protection.

> **🔒 Security Note:** This application uses nginx basic authentication to protect all routes. Only authorized internal users with the password can access the application.

## Prerequisites

- Railway account (sign up at https://railway.app)
- Git repository (GitHub, GitLab, or Bitbucket)
- Required API keys:
  - `GOOGLE_AI_API_KEY` (for Gemini models)
  - `OPENAI_API_KEY` (for OpenAI models)

## Option 1: Deploy via Railway Dashboard (Recommended)

### Step 1: Create New Project
1. Go to https://railway.app/dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway to access your GitHub account
5. Select this repository

### Step 2: Add PostgreSQL Database
1. In your Railway project, click "+ New"
2. Select "Database" → "PostgreSQL"
3. Railway will automatically create a PostgreSQL instance
4. The `DATABASE_URL` variable will be automatically set

**Alternative:** Keep using Neon database
- If you prefer to use your existing Neon database, skip adding PostgreSQL
- You'll manually set `DATABASE_URL` to your Neon connection string in Step 3

### Step 3: Configure Environment Variables
1. Click on your service (the web app)
2. Go to "Variables" tab
3. Add the following **required** variables:

```
NODE_ENV=production
GOOGLE_AI_API_KEY=your_google_ai_key_here
OPENAI_API_KEY=your_openai_key_here
AUTH_PASSWORD=your-strong-password-here
SESSION_SECRET=generate-random-32-byte-hex-string
```

If using Neon instead of Railway Postgres, also add:
```
DATABASE_URL=postgresql://user:password@your-neon-url/dbname
```

**🔒 Important - AUTH_PASSWORD:**
- This password protects your entire application
- Choose a strong password
- Username will be `admin`
- All users (including you) will need this password to access the app
- Generate strong secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### Step 4: Deploy
1. Railway will automatically detect the `Dockerfile` and build using Docker
2. The build process will:
   - Build your Node.js application
   - Set up nginx with password protection
   - Configure authentication from `AUTH_PASSWORD`
3. Monitor deployment in the "Deployments" tab
4. Once deployed, click "Generate Domain" to get a public URL

### Step 5: Access Your Application
1. Visit your Railway URL
2. You'll see a browser login prompt
3. Enter credentials:
   - **Username:** `admin`
   - **Password:** The value you set in `AUTH_PASSWORD`
4. Your browser will remember these credentials for future visits

## Option 2: Deploy via Railway CLI

### Step 1: Install Railway CLI
```bash
npm i -g @railway/cli
railway login
```

### Step 2: Initialize Project
```bash
# In your project directory
railway init

# Link to existing project or create new one
railway link
```

### Step 3: Add PostgreSQL (Optional)
```bash
# Add PostgreSQL service
railway add --database postgres
```

### Step 4: Set Environment Variables
```bash
railway variables set NODE_ENV=production
railway variables set GOOGLE_AI_API_KEY=your_google_ai_key_here
railway variables set OPENAI_API_KEY=your_openai_key_here
railway variables set AUTH_PASSWORD=your-strong-password-here
railway variables set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# If using Neon database
railway variables set DATABASE_URL=postgresql://user:password@your-neon-url/dbname
```

### Step 5: Deploy
```bash
railway up
```

Or link to GitHub for automatic deployments:
```bash
railway github
```

## Database Migration

After first deployment, run database migrations:

### Via Railway Dashboard:
1. Go to your service
2. Click "Settings" → "Deploy"
3. Add to "Build Command": `npm run build && npm run db:push`

### Via CLI:
```bash
railway run npm run db:push
```

## Monitoring and Logs

### View Logs:
```bash
railway logs
```

Or in the Railway dashboard: Service → "Deployments" → Click deployment → "View Logs"

### Health Check:
Your app includes a health endpoint at `/api/health` that Railway can use for monitoring.

## Custom Domain (Optional)

1. In Railway dashboard, go to your service
2. Click "Settings" → "Networking"
3. Click "Generate Domain" for a railway.app subdomain
4. Or click "Custom Domain" to add your own domain

## Password Protection Architecture

This deployment uses a **multi-container Docker setup** with nginx as a reverse proxy:

```
Internet (HTTPS)
    ↓
Railway Load Balancer (Port $PORT)
    ↓
nginx Container (basic auth) 🔒 ← PASSWORD CHECK HERE
    ↓ (only if authenticated)
Node.js Application (Port 5000)
    ↓
PostgreSQL Database
```

**Security Features:**
- ✅ All routes protected (frontend, API, static files)
- ✅ Network-level authentication (happens before any code runs)
- ✅ No code changes needed to enable/disable
- ✅ Simple for 2-3 internal users
- ✅ HTTPS encryption via Railway

**How to Change Password:**
1. Update `AUTH_PASSWORD` in Railway variables
2. Railway will automatically redeploy
3. Inform users of new credentials

**How to Remove Password Protection:**
1. Change `railway.json` back to use NIXPACKS instead of DOCKERFILE
2. Remove `Dockerfile` and `nginx.conf`
3. Remove `AUTH_PASSWORD` variable
4. Redeploy

See `AUTH_SETUP.md` for detailed authentication documentation.

## Troubleshooting

### Build Fails
- Check that all dependencies are in `dependencies` (not `devDependencies`)
- Verify Node.js version compatibility
- Check build logs in Railway dashboard

### Database Connection Issues
- Verify `DATABASE_URL` is set correctly
- For Neon: Ensure connection pooling is enabled
- Check that IP allowlist includes Railway's IPs (or use 0.0.0.0/0)

### Environment Variables Not Working
- Ensure variables are set in Railway dashboard
- Restart the service after adding new variables
- Check for typos in variable names

### Port Issues
Railway automatically sets the `PORT` environment variable. The Dockerfile is configured to:
- Run nginx on Railway's `$PORT` (public-facing)
- Run Node.js on port 5000 (internal only)
- nginx proxies authenticated requests to Node.js

### Authentication Issues
**401 Unauthorized:**
- Verify username is `admin` (lowercase)
- Check password matches `AUTH_PASSWORD` in Railway
- Clear browser cache/cookies
- Try incognito/private mode

**502 Bad Gateway:**
- Node.js application failed to start
- Check Railway logs for errors
- Verify all environment variables are set
- Check database connectivity

## Costs

**Free Tier:**
- $5 credit per month
- Suitable for development/testing
- Includes hobby usage

**Pro Plan:**
- $20/month
- Usage-based pricing
- Better for production

**Database Costs:**
- Railway Postgres: ~$5-10/month (usage-based)
- Neon (external): Free tier available, then ~$19/month

## Next Steps After Deployment

1. Test all API endpoints
2. Verify AI model integrations work
3. Test report generation and PDF exports
4. Set up monitoring/alerting
5. Configure custom domain (if needed)
6. Set up backups for database

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Project Issues: Create issues in this repository
