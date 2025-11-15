/**
 * Health Check Routes
 *
 * Provides health status endpoints for monitoring system availability,
 * database connectivity, and AI service status.
 */

import type { Express, Request, Response } from "express";
import { AIHealthService } from "../services/ai-models/health-service";
import { AIMonitoringService } from "../services/ai-models/monitoring";
import { checkDatabaseConnection } from "../db";
import { asyncHandler } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";

export function registerHealthRoutes(app: Express): void {
  const healthService = new AIHealthService(AIMonitoringService.getInstance());

  // Start periodic health checks and run immediate warm-up
  healthService.startPeriodicHealthChecks();

  // Warm up health cache immediately
  healthService.getSystemHealth().catch(error => {
    console.warn('Initial health check failed:', error);
  });

  /**
   * GET /api/health
   *
   * Public health check endpoint for load balancers and monitoring systems.
   * Returns cached health status (redacted for security).
   *
   * Response: 200 OK if healthy, 503 Service Unavailable if unhealthy
   */
  app.get("/api/health", asyncHandler(async (req: Request, res: Response) => {
    const health = healthService.getCachedHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 503;

    // Redact sensitive details for public health check
    const publicHealth = {
      status: health.overall,
      timestamp: health.timestamp,
      services: health.services.map(s => ({
        service: s.service,
        status: s.status,
        lastChecked: s.lastChecked
      }))
    };

    res.status(statusCode).json(createApiSuccessResponse(publicHealth, `System is ${health.overall}`));
  }));

  /**
   * GET /api/health/detailed
   *
   * Detailed health check endpoint with full metrics (admin only).
   * Requires authentication via X-Admin-Key header or Bearer token.
   *
   * Response: Full health status including error details and metrics
   */
  app.get("/api/health/detailed", asyncHandler(async (req: Request, res: Response) => {
    // Strict admin authentication - require exact API key match
    const adminKey = req.headers['x-admin-key'] as string;
    const authHeader = req.headers['authorization'] as string;

    const isValidKey = adminKey === process.env.ADMIN_API_KEY;
    const isValidBearer = authHeader?.startsWith('Bearer ') &&
                         authHeader.substring(7) === process.env.ADMIN_API_KEY;

    if (!isValidKey && !isValidBearer) {
      res.status(401).json(createApiErrorResponse(
        'AUTHENTICATION_ERROR',
        ERROR_CODES.AI_AUTHENTICATION_FAILED,
        'Valid admin authentication required for detailed health status',
        'Access denied - invalid credentials'
      ));
      return;
    }

    // Detailed health check with full metrics
    const health = await healthService.getSystemHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 503;
    res.status(statusCode).json(createApiSuccessResponse(health, "Detailed health status retrieved"));
  }));

  /**
   * GET /api/health/database
   *
   * Database connectivity check.
   *
   * Response: 200 if database is accessible, 503 if not
   */
  app.get("/api/health/database", asyncHandler(async (req: Request, res: Response) => {
    const isHealthy = await checkDatabaseConnection();
    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json(createApiSuccessResponse({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString()
    }, `Database is ${isHealthy ? 'healthy' : 'unhealthy'}`));
  }));

  /**
   * GET /api/health/ai
   *
   * AI services health check.
   * Returns cached health data to avoid costs and rate limits.
   *
   * Response: 200 if AI services are available, 503 if not
   */
  app.get("/api/health/ai", asyncHandler(async (req: Request, res: Response) => {
    // Use cached health data to avoid cost and rate limits
    const health = healthService.getCachedHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 503;

    // Return only AI service status without sensitive details
    const aiHealth = {
      overall: health.overall,
      services: health.services.map(s => ({
        service: s.service,
        status: s.status,
        lastChecked: s.lastChecked
      })),
      timestamp: health.timestamp
    };

    res.status(statusCode).json(createApiSuccessResponse(aiHealth, "AI services health status retrieved"));
  }));
}
