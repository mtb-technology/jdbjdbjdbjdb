# Setup Guide - De Fiscale Analist

This guide will help you set up and run the Dutch fiscal analysis application locally.

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL (for local development) OR a Neon account (for cloud database)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Database Configuration
# Option Use Neon (recommended for production)
DATABASE_URL='postgresql://user:password@host/database?sslmode=require'

# AI API Keys (at least one required)
OPENAI_API_KEY=your-openai-api-key-here
GOOGLE_AI_API_KEY=your-google-api-key-here  # Optional

# Server Configuration
PORT=3000  # Default is 5000, but macOS uses that for Control Center

# Session Secret (generate a secure random string for production)
SESSION_SECRET=your-secret-key-here
```

### 3. Database Setup

#### Option Using Neon (Recommended)

1. Sign up at [Neon](https://neon.tech)
2. Create a new project
3. Copy the connection string to your `.env` file
4. Run migrations:
   ```bash
   npm run db:push
   ```


### 4. Obtain API Keys

#### OpenAI API Key (Required)
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create an account or sign in
3. Generate a new API key
4. Add it to your `.env` file

#### Google AI API Key (Optional)
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Generate an API key
4. Add it to your `.env` file

### 5. Run the Application

```bash
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- API: http://localhost:3000/api

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Run production build
- `npm run check` - Run TypeScript type checking
- `npm run db:push` - Push database schema changes

## Common Issues

### Port Already in Use

If port 5000 is in use (common on macOS with Control Center), change the port in `.env`:
```env
PORT=3000
```

### Database Connection Failed

**For Neon users:**
- Ensure your connection string includes `?sslmode=require`
- Check that your Neon project is active

### Missing API Keys

The application requires at least one AI provider (OpenAI or Google AI) to be configured. Without API keys, the server will not start.

### Database Tables Missing

If you see errors about missing tables, run:
```bash
npm run db:push
```

## Project Structure

- `/client` - React frontend with TypeScript
- `/server` - Express.js backend with TypeScript
- `/shared` - Shared types and schemas
- `/storage` - File storage for prompts and temporary data

## Features

- 🇳🇱 Dutch fiscal analysis report generation
- 📊 Multi-stage AI workflow with real-time streaming
- 🔒 Source validation (only official Dutch government sources)
- 📄 PDF report export
- 🎨 Dark mode support
- 🔄 Real-time progress updates via Server-Sent Events

## Development Tips

1. **Hot Module Replacement**: The dev server supports HMR for both frontend and backend
2. **TypeScript Checking**: Run `npm run check` regularly to catch type errors
3. **Environment Variables**: Never commit `.env` files with real credentials
4. **Database Changes**: After schema changes, always run `npm run db:push`

## Support

For issues or questions about the setup, check:
- The error logs in the console
- Database connection status
- API key validity
- Network/firewall settings for database connections