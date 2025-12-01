# Portal JDB

AI-powered research portal for generating comprehensive reports.

## Requirements

- Node.js 20+
- PostgreSQL database
- OpenAI API key (or Google Gemini API key)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database and API credentials
   ```

3. **Setup database:**
   ```bash
   npm run db:push
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

## Production

1. **Build:**
   ```bash
   npm run build
   ```

2. **Start:**
   ```bash
   npm start
   ```

## Database Migrations

Migrations are in `/migrations`. To apply:
```bash
npm run db:push
```

## Environment Variables

See `.env.example` for required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key
- `SESSION_SECRET` - Session encryption secret
