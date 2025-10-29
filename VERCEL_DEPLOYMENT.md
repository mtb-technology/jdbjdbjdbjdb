# Vercel Deployment Guide - De Fiscale Analist

This guide walks you through deploying "De Fiscale Analist" to Vercel's serverless platform.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Vercel CLI** (optional): `npm i -g vercel`
3. **Neon Database**: Your PostgreSQL database should already be set up at [neon.tech](https://neon.tech)
4. **API Keys**: Google AI and OpenAI API keys ready

## Quick Deployment (GitHub)

### 1. Push to GitHub

```bash
git add .
git commit -m "Add Vercel deployment configuration"
git push origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel will auto-detect the configuration from `vercel.json`
4. Configure environment variables (see below)
5. Click **Deploy**

## Environment Variables

Configure these in Vercel Dashboard → Project Settings → Environment Variables:

### Required Variables

```env
# Database (PostgreSQL via Neon)
DATABASE_URL=postgresql://user:password@host.neon.tech/database?sslmode=require

# AI API Keys
GOOGLE_AI_API_KEY=your-google-ai-api-key
OPENAI_API_KEY=sk-your-openai-api-key

# Security
SESSION_SECRET=your-32-byte-hex-string-here
ADMIN_API_KEY=your-admin-api-key-here

# Server Configuration
PORT=3000
NODE_ENV=production
```

### Generating Secure Secrets

Run this command to generate secure random strings:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Manual Deployment (CLI)

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

## Build Configuration

The project uses these build settings (already configured in `vercel.json`):

- **Build Command**: `npm run build:vercel` (builds client only)
- **Output Directory**: `dist/public`
- **API Routes**: `api/index.ts` → serverless function
- **Max Function Duration**: 60 seconds (requires Vercel Pro)

## Important Limitations

### Serverless Function Timeouts

- **Hobby (Free) Plan**: 10 second timeout
- **Pro Plan ($20/month)**: 60 second timeout
- **Enterprise Plan**: Custom timeouts

⚠️ **SSE Streaming**: Some long-running AI operations may timeout on the free plan. Consider upgrading to Pro for production use.

### Session Management

✅ The app uses PostgreSQL-backed sessions (`connect-pg-simple`), which work perfectly with Vercel's stateless functions.

### File System

⚠️ Serverless functions have **read-only** filesystem (except `/tmp`). The app already stores everything in the database, so this is fine.

## Post-Deployment Checklist

After deployment:

1. ✅ **Test Health Check**: `https://your-app.vercel.app/api/health`
2. ✅ **Test Database**: `https://your-app.vercel.app/api/health/database`
3. ✅ **Test AI Models**: `https://your-app.vercel.app/api/health/ai`
4. ✅ **Create Test Report**: Use the UI to create a new fiscal report
5. ✅ **Test SSE Streaming**: Execute a report stage and verify real-time updates

## Troubleshooting

### Build Fails

**Error**: `Cannot find module 'server/routes'`
- **Fix**: Ensure `api/index.ts` correctly imports from `../server/`

### Function Timeout

**Error**: `Function execution timeout`
- **Fix**: Upgrade to Vercel Pro for 60s timeout
- **Alternative**: Consider Railway or Render for unlimited timeouts

### Database Connection Failed

**Error**: `Database connection failed`
- **Fix**: Check `DATABASE_URL` is correct in Vercel environment variables
- **Fix**: Ensure Neon database allows connections from `0.0.0.0/0`

### Session Issues

**Error**: `Session store is not available`
- **Fix**: Verify `DATABASE_URL` and `SESSION_SECRET` are set
- **Fix**: Run `npm run db:push` to ensure session table exists

## Monitoring

### Vercel Dashboard

Monitor your deployment:
- **Analytics**: Request counts, response times
- **Logs**: Real-time function logs
- **Errors**: Error tracking and alerting

### Custom Monitoring

The app includes built-in health checks:
- `/api/health` - Overall system health
- `/api/health/database` - Database connectivity
- `/api/health/ai` - AI model availability
- `/api/health/detailed` - Detailed metrics (requires admin key)

## Performance Optimization

### Caching Headers

Already configured in the app:
- Reports list: 60s cache
- Sources: 600s cache (rarely changes)
- Prompts: No cache (dynamic)

### Cold Start Optimization

The serverless handler uses singleton pattern to minimize cold start impact:
- First request: ~2-3s (initialization)
- Subsequent requests: ~100-300ms

## Alternative Hosting Options

If Vercel's serverless architecture proves limiting:

### Railway.app
- ✅ No timeout limits
- ✅ Persistent connections
- ✅ $5/month starting
- 🔗 [railway.app](https://railway.app)

### Render.com
- ✅ Traditional server deployment
- ✅ Free tier available
- ✅ Auto-scaling
- 🔗 [render.com](https://render.com)

### Fly.io
- ✅ Edge deployment
- ✅ Global distribution
- ✅ WebSocket support
- 🔗 [fly.io](https://fly.io)

## Support

For issues with:
- **Vercel Platform**: [vercel.com/support](https://vercel.com/support)
- **This App**: Check CLAUDE.md or create an issue

---

**Last Updated**: 2025-10-29
**Vercel Config Version**: 2
