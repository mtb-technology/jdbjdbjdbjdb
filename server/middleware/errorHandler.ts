import type { Request, Response, NextFunction } from 'express';
import { createApiErrorResponse, ERROR_CODES, type ErrorCode } from '@shared/errors';
import { ZodError } from 'zod';

export class ServerError extends Error {
  constructor(
    public code: ErrorCode,
    public userMessage: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(`[${code}] ${userMessage}`);
    this.name = 'ServerError';
  }

  static validation(message: string, userMessage: string, details?: Record<string, any>): ServerError {
    return new ServerError(ERROR_CODES.VALIDATION_FAILED, userMessage, 400, details);
  }

  static business(code: ErrorCode, userMessage: string, details?: Record<string, any>): ServerError {
    return new ServerError(code, userMessage, 400, details);
  }

  static internal(userMessage: string = 'Er is een interne serverfout opgetreden', details?: Record<string, any>): ServerError {
    return new ServerError(ERROR_CODES.INTERNAL_SERVER_ERROR, userMessage, 500, details);
  }

  static ai(userMessage: string, details?: Record<string, any>): ServerError {
    return new ServerError(ERROR_CODES.AI_SERVICE_UNAVAILABLE, userMessage, 503, details);
  }

  static notFound(resource: string): ServerError {
    return new ServerError(
      ERROR_CODES.REPORT_NOT_FOUND, 
      `${resource} niet gevonden`, 
      404
    );
  }
}

/**
 * Centraal error handling middleware
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log de error voor debugging
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] Error in ${req.method} ${req.path}:`, {
    error: err.message,
    stack: err.stack,
    requestId: req.headers['x-request-id'] || 'unknown'
  });

  // Handle verschillende error types
  if (err instanceof ServerError) {
    return res.status(err.statusCode).json(
      createApiErrorResponse(
        'SERVER_ERROR',
        err.code,
        err.message,
        err.userMessage,
        err.details
      )
    );
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = {
      validationErrors: err.errors.map(error => ({
        path: error.path.join('.'),
        message: error.message,
        code: error.code
      }))
    };

    return res.status(400).json(
      createApiErrorResponse(
        'VALIDATION_ERROR',
        ERROR_CODES.VALIDATION_FAILED,
        'Validation failed',
        'De ingevoerde gegevens zijn niet geldig. Controleer uw invoer.',
        details
      )
    );
  }

  // Handle database errors (Drizzle/PostgreSQL)
  if (err.code === '23505') { // Unique constraint violation
    return res.status(409).json(
      createApiErrorResponse(
        'DATABASE_ERROR',
        ERROR_CODES.DATABASE_ERROR,
        'Unique constraint violation',
        'Deze gegevens bestaan al in het systeem.',
        { postgresCode: err.code }
      )
    );
  }

  // Handle andere database errors
  if (err.code?.startsWith('23') || err.name === 'DatabaseError') {
    return res.status(500).json(
      createApiErrorResponse(
        'DATABASE_ERROR',
        ERROR_CODES.DATABASE_ERROR,
        'Database operation failed',
        'Er is een probleem met de database. Probeer het later opnieuw.'
      )
    );
  }

  // Handle network/fetch errors
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.name === 'FetchError') {
    return res.status(503).json(
      createApiErrorResponse(
        'NETWORK_ERROR',
        ERROR_CODES.EXTERNAL_API_ERROR,
        'External service unavailable',
        'Een externe service is momenteel niet beschikbaar. Probeer het later opnieuw.'
      )
    );
  }

  // Handle AI service specific errors
  if (err.message?.includes('AI') || err.message?.includes('OpenAI') || err.message?.includes('Gemini')) {
    return res.status(503).json(
      createApiErrorResponse(
        'AI_ERROR',
        ERROR_CODES.AI_SERVICE_UNAVAILABLE,
        err.message,
        'De AI service is momenteel niet beschikbaar. Probeer het later opnieuw.'
      )
    );
  }

  // Fallback voor alle andere errors
  const statusCode = err.statusCode || err.status || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  return res.status(statusCode).json(
    createApiErrorResponse(
      'UNKNOWN_ERROR',
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      err.message || 'Unknown error occurred',
      isClientError 
        ? 'Er is een fout opgetreden bij het verwerken van uw verzoek.'
        : 'Er is een interne serverfout opgetreden. Probeer het later opnieuw.'
    )
  );
}

/**
 * Middleware voor het afhandelen van async errors
 */
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Helper functie om errors te loggen met context
 */
export function logError(error: any, context: Record<string, any> = {}) {
  const timestamp = new Date().toISOString();
  
  if (process.env.NODE_ENV === 'development') {
    console.group(`🚨 Server Error: ${timestamp}`);
    console.error('Error:', error.message);
    console.error('Context:', context);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    console.groupEnd();
  } else {
    // Structured logging for production
    console.error(JSON.stringify({
      timestamp,
      level: 'error',
      message: error.message,
      stack: error.stack,
      context
    }));
  }
}