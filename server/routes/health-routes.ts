/**
 * Health Check Routes
 *
 * Provides health status endpoints for monitoring system availability,
 * database connectivity, and AI service status.
 */

import type { Express, Request, Response } from "express";
import { AIHealthService } from "../services/ai-models/health-service";
import { checkDatabaseConnection } from "../db";
import { asyncHandler } from "../middleware/errorHandler";
import { createApiSuccessResponse, createApiErrorResponse, ERROR_CODES } from "@shared/errors";
import { HTTP_STATUS } from "../config/constants";

// Singleton instance for graceful shutdown support
let healthServiceInstance: AIHealthService | null = null;

export function getHealthService(): AIHealthService {
  if (!healthServiceInstance) {
    healthServiceInstance = new AIHealthService();
  }
  return healthServiceInstance;
}

// Call on server shutdown to clean up resources
export function shutdownHealthService(): void {
  if (healthServiceInstance) {
    healthServiceInstance.stopPeriodicHealthChecks();
    healthServiceInstance = null;
  }
}

export function registerHealthRoutes(app: Express): void {
  const healthService = getHealthService();

  // NOTE: Periodic health checks disabled - they make unnecessary API calls that cost money
  // and count against rate limits. The cached health status is updated by actual workflow calls.
  // If you need fresh health status, call /api/health/detailed (admin only).

  // healthService.startPeriodicHealthChecks();  // DISABLED
  // healthService.getSystemHealth();  // DISABLED

  /**
   * GET /api/health
   *
   * Simple health check endpoint for load balancers (Railway, etc).
   * Returns 200 OK immediately if the server is running.
   * This endpoint is optimized for fast startup checks.
   *
   * Response: 200 OK if server is running
   */
  app.get("/api/health", asyncHandler(async (req: Request, res: Response) => {
    // Simple, fast health check - just return OK if we can respond
    // Railway needs this to be fast during initial startup
    res.status(200).json(createApiSuccessResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }, 'Service is running'));
  }));

  /**
   * GET /api/health/full
   *
   * Comprehensive health check with AI services and database status.
   * Returns cached health status (redacted for security).
   *
   * Response: 200 OK if healthy, 503 Service Unavailable if unhealthy
   */
  app.get("/api/health/full", asyncHandler(async (req: Request, res: Response) => {
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
      res.status(HTTP_STATUS.UNAUTHORIZED).json(createApiErrorResponse(
        'AuthenticationError',
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
   * Returns basic status without making API calls (periodic checks are disabled).
   * Actual health is determined by workflow success/failure.
   *
   * Response: Always 200 with "available" status (actual errors show during workflow execution)
   */
  app.get("/api/health/ai", asyncHandler(async (req: Request, res: Response) => {
    // Return optimistic status - actual errors will surface during workflow execution
    // This avoids unnecessary API calls just for health checking
    const configuredServices: string[] = [];
    if (process.env.GOOGLE_AI_API_KEY) configuredServices.push('Google AI');
    if (process.env.OPENAI_API_KEY) configuredServices.push('OpenAI');

    const aiHealth = {
      overall: configuredServices.length > 0 ? 'available' : 'not_configured',
      services: configuredServices.map(service => ({
        service,
        status: 'available',
        note: 'Health determined by workflow execution'
      })),
      timestamp: Date.now()
    };

    res.status(200).json(createApiSuccessResponse(aiHealth, "AI services status retrieved"));
  }));
}
