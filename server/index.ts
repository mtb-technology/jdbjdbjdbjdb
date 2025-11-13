import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { errorHandler } from "./middleware/errorHandler";
import { config, validateConfig } from "./config";
import { checkDatabaseConnection } from "./db";

const app = express();

// CORS middleware - allow requests from Vite dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID, X-Admin-Key');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// ✅ FIX: Increase body size limits for file uploads
// Default is 100kb which is too small for PDFs
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

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

  // Check database connection
  try {
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      console.error('❌ Database connection failed. Exiting...');
      process.exit(1);
    }
    console.log('✅ Database connection verified');
  } catch (error) {
    console.error('❌ Database connection error:', error);
    process.exit(1);
  }

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
  server.listen({
    port,
    host: "localhost",
  }, () => {
    log(`serving on port ${port}`);
  });
})();
