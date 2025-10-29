import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes";
import { errorHandler } from "../server/middleware/errorHandler";
import { config, validateConfig } from "../server/config";
import { checkDatabaseConnection } from "../server/db";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

      console.log(logLine);
    }
  });

  next();
});

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

// Initialize the app once (singleton pattern for serverless)
async function initializeApp() {
  if (isInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    // Validate configuration on startup
    if (!validateConfig()) {
      console.error('❌ Configuration validation failed');
      throw new Error('Configuration validation failed');
    }

    // Check database connection
    try {
      const dbConnected = await checkDatabaseConnection();
      if (!dbConnected) {
        console.error('❌ Database connection failed');
        throw new Error('Database connection failed');
      }
      console.log('✅ Database connection verified');
    } catch (error) {
      console.error('❌ Database connection error:', error);
      throw error;
    }

    // Register routes (returns HTTP server, but we don't need it for Vercel)
    await registerRoutes(app);

    // Use centralized error handling middleware
    app.use(errorHandler);

    isInitialized = true;
    console.log('✅ App initialized for Vercel serverless');
  })();

  return initializationPromise;
}

// Vercel serverless handler
export default async function handler(req: Request, res: Response) {
  try {
    // Initialize app on first request (cold start)
    await initializeApp();

    // Handle the request with Express
    return app(req, res);
  } catch (error) {
    console.error('❌ Serverless handler error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        userMessage: 'Er is een interne fout opgetreden'
      }
    });
  }
}
