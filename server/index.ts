import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { errorHandler } from "./middleware/errorHandler";
import { config, validateConfig } from "./config";
import { checkDatabaseConnection } from "./db";
import { initializeDossierSequence } from "./storage";
import { startJobProcessor, stopJobProcessor } from "./services/job-processor";

const app = express();

// CORS middleware - allow requests from Vite dev server and production
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:5000'];

  // In production, allow same-origin requests
  if (config.IS_PRODUCTION || (origin && allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// ✅ Body size limits: 25mb to support large dossier text inputs
// Note: File uploads use multer with separate limits (25mb per file)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false, limit: '25mb' }));

// 🔒 SECURITY: Session middleware for authentication
// Sessions are stored in PostgreSQL for production, memory for development
declare module 'express-session' {
  interface SessionData {
    userId: string;
    username: string;
  }
}

app.use(session({
  secret: config.session.secret,
  resave: config.session.resave,
  saveUninitialized: config.session.saveUninitialized,
  cookie: config.session.cookie,
  name: config.session.name
}));

// Request ID middleware voor betere error tracking
app.use((req, res, next) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] || 
    Date.now().toString(36) + Math.random().toString(36).substr(2);
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const requestId = req.headers['x-request-id'];
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `[${requestId}] ${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      
      if (capturedJsonResponse) {
        // Log success/error status
        const isError = capturedJsonResponse.success === false;
        const status = isError ? '❌' : '✅';
        logLine = `${status} ${logLine}`;
        
        // Add error details for failed requests
        if (isError && capturedJsonResponse.error) {
          logLine += ` :: ${capturedJsonResponse.error.code}`;
        }
      }

      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Validate configuration on startup
  if (!validateConfig()) {
    console.error('❌ Configuration validation failed. Exiting...');
    process.exit(1);
  }

  // Check database connection (non-blocking in production for Railway startup)
  try {
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      console.warn('⚠️ Database connection failed. App will start but may have limited functionality.');
      if (!config.IS_PRODUCTION) {
        console.error('❌ Exiting in development mode...');
        process.exit(1);
      }
    } else {
      console.log('✅ Database connection verified');
    }
  } catch (error) {
    console.error('❌ Database connection error:', error);
    if (!config.IS_PRODUCTION) {
      console.error('❌ Exiting in development mode...');
      process.exit(1);
    } else {
      console.warn('⚠️ Continuing in production mode...');
    }
  }

  // Initialize dossier number sequence (syncs with max existing value)
  await initializeDossierSequence();

  const server = await registerRoutes(app);

  // Use het nieuwe centralized error handling middleware
  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = config.PORT;
  console.log(`🔧 Attempting to bind to port ${port} on host 0.0.0.0`);
  console.log(`🔧 Environment PORT: ${process.env.PORT}`);
  console.log(`🔧 Config PORT: ${config.PORT}`);

  server.listen(port, "0.0.0.0", () => {
    console.log(`🚀 ✅ SERVER SUCCESSFULLY LISTENING ON PORT ${port}`);
    log(`serving on port ${port}`);

    // Start the background job processor
    startJobProcessor();
  });

  server.on('error', (error: any) => {
    console.error(`❌ SERVER ERROR:`, error);
    console.error(`❌ Failed to bind to port ${port}`);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('📴 SIGTERM received, shutting down gracefully...');
    stopJobProcessor();
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('📴 SIGINT received, shutting down gracefully...');
    stopJobProcessor();
    server.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  });
})();
