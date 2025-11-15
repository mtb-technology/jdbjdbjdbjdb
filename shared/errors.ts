/**
 * Simplified shared error types tussen frontend en backend
 * Voor 2-3 gebruikers - houden we het simpel
 */

export interface ApiErrorResponse {
  success: false;
  error: {
    type: string;
    code: string;
    message: string;
    userMessage: string;
    details?: Record<string, any>;
    timestamp: string;
  };
}

export interface ApiSuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

// Simplified error codes - only what we actually need
export const ERROR_CODES = {
  // Input validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Resource errors
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',

  // AI errors (kept minimal set that's actually used)
  AI_SERVICE_UNAVAILABLE: 'AI_SERVICE_UNAVAILABLE',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_PROCESSING_FAILED: 'AI_PROCESSING_FAILED',
  AI_RESPONSE_INVALID: 'AI_RESPONSE_INVALID',
  AI_AUTHENTICATION_FAILED: 'AI_AUTHENTICATION_FAILED',

  // External/Source validation
  SOURCE_VALIDATION_FAILED: 'SOURCE_VALIDATION_FAILED',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',

  // System errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export function isApiErrorResponse(response: any): response is ApiErrorResponse {
  return response && response.success === false && response.error;
}

export function createApiErrorResponse(
  type: string,
  code: ErrorCode,
  message: string,
  userMessage: string,
  details?: Record<string, any>
): ApiErrorResponse {
  return {
    success: false,
    error: {
      type,
      code,
      message,
      userMessage,
      details,
      timestamp: new Date().toISOString()
    }
  };
}

export function createApiSuccessResponse<T>(
  data: T,
  message?: string
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    message
  };
}

// Simple error class for AI handlers
export class AIError extends Error {
  public errorCode: ErrorCode;
  public isRetryable: boolean;
  public details?: Record<string, any>;
  public retryAfter?: number;

  constructor(
    message: string,
    public code: ErrorCode = ERROR_CODES.AI_SERVICE_UNAVAILABLE,
    public statusCode: number = 500,
    options?: { isRetryable?: boolean; details?: Record<string, any>; retryAfter?: number }
  ) {
    super(message);
    this.name = 'AIError';
    this.errorCode = code; // Alias for backward compatibility
    this.isRetryable = options?.isRetryable ?? false;
    this.details = options?.details;
    this.retryAfter = options?.retryAfter;
  }

  // Static factory methods for common error types
  static invalidInput(message: string, details?: Record<string, any>) {
    return new AIError(message, ERROR_CODES.VALIDATION_FAILED, 400, { details });
  }

  static timeout(message: string = 'Request timeout') {
    return new AIError(message, ERROR_CODES.AI_SERVICE_UNAVAILABLE, 504, { isRetryable: true });
  }

  static circuitBreakerOpen(message: string = 'Circuit breaker open') {
    return new AIError(message, ERROR_CODES.AI_SERVICE_UNAVAILABLE, 503, { isRetryable: true });
  }
}
