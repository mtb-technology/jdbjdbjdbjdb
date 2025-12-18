/**
 * Route Handler Utilities
 *
 * Type-safe error handling for Express routes.
 * Eliminates `catch (error: any)` pattern with consistent error responses.
 */

import type { Response } from "express";
import { createApiErrorResponse, ERROR_CODES, AIError } from "@shared/errors";
import { logger } from "../services/logger";

/**
 * Extracts a user-friendly message from any error type.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Een onverwachte fout is opgetreden";
}

/**
 * Extracts error code from AIError or returns default.
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof AIError) {
    return error.code;
  }
  return ERROR_CODES.INTERNAL_SERVER_ERROR;
}

/**
 * Extracts HTTP status code from error or returns 500.
 */
export function getStatusCode(error: unknown): number {
  if (error instanceof AIError) {
    return error.statusCode;
  }
  if (error instanceof Error && "statusCode" in error) {
    return (error as Error & { statusCode: number }).statusCode;
  }
  return 500;
}

/**
 * Standard error response handler for routes.
 *
 * Usage:
 * ```typescript
 * try {
 *   // route logic
 * } catch (error) {
 *   return handleRouteError(res, error, "Fout bij ophalen van rapport", "ReportRoutes");
 * }
 * ```
 */
export function handleRouteError(
  res: Response,
  error: unknown,
  userMessage: string,
  context?: string
): void {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const statusCode = getStatusCode(error);

  // Log with context if provided
  logger.error(context || 'routeHandler', message, {}, error instanceof Error ? error : undefined);

  res.status(statusCode).json(
    createApiErrorResponse(
      "ROUTE_ERROR",
      code as typeof ERROR_CODES[keyof typeof ERROR_CODES],
      message,
      userMessage
    )
  );
}

/**
 * Wraps an async route handler with standardized error handling.
 *
 * Usage:
 * ```typescript
 * app.get("/api/reports/:id", safeRoute(async (req, res) => {
 *   const report = await storage.getReport(req.params.id);
 *   res.json(createApiSuccessResponse(report));
 * }, "Fout bij ophalen rapport"));
 * ```
 */
export function safeRoute<T extends (req: any, res: Response) => Promise<void>>(
  handler: T,
  defaultUserMessage: string = "Er is een fout opgetreden",
  context?: string
) {
  return async (req: Parameters<T>[0], res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      handleRouteError(res, error, defaultUserMessage, context);
    }
  };
}

/**
 * Type guard for checking if error is an AIError
 */
export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

/**
 * Type guard for checking if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AIError) {
    return error.isRetryable;
  }
  return false;
}
