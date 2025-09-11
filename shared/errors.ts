/**
 * Shared error types tussen frontend en backend
 * Zorgt voor consistente error handling door de gehele stack
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

export const ERROR_CODES = {
  // Validation Errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Business Logic Errors  
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
  INVALID_DOSSIER_DATA: 'INVALID_DOSSIER_DATA',
  INVALID_BOUWPLAN_DATA: 'INVALID_BOUWPLAN_DATA',
  
  // AI Service Errors
  AI_SERVICE_UNAVAILABLE: 'AI_SERVICE_UNAVAILABLE',
  AI_QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_AUTHENTICATION_FAILED: 'AI_AUTHENTICATION_FAILED',
  AI_MODEL_NOT_FOUND: 'AI_MODEL_NOT_FOUND',
  AI_CONTENT_FILTERED: 'AI_CONTENT_FILTERED',
  AI_NETWORK_ERROR: 'AI_NETWORK_ERROR',
  
  // External Service Errors
  SOURCE_VALIDATION_FAILED: 'SOURCE_VALIDATION_FAILED',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  
  // System Errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
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

/**
 * AI-specific error classes for better error handling
 */
export class AIError extends Error {
  public readonly errorCode: ErrorCode;
  public readonly isRetryable: boolean;
  public readonly retryAfter?: number;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    errorCode: ErrorCode,
    isRetryable = false,
    retryAfter?: number,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AIError';
    this.errorCode = errorCode;
    this.isRetryable = isRetryable;
    this.retryAfter = retryAfter;
    this.details = details;
  }

  static fromHttpError(
    statusCode: number,
    responseText: string,
    provider: string
  ): AIError {
    const details = { statusCode, responseText, provider };
    
    switch (statusCode) {
      case 401:
        return new AIError(
          `Authentication failed for ${provider}`,
          ERROR_CODES.AI_AUTHENTICATION_FAILED,
          false,
          undefined,
          details
        );
      case 429:
        return new AIError(
          `Rate limit exceeded for ${provider}`,
          ERROR_CODES.AI_RATE_LIMITED,
          true,
          60000, // Retry after 1 minute
          details
        );
      case 503:
      case 502:
      case 504:
        return new AIError(
          `${provider} service temporarily unavailable`,
          ERROR_CODES.AI_SERVICE_UNAVAILABLE,
          true,
          30000, // Retry after 30 seconds
          details
        );
      case 404:
        return new AIError(
          `Model not found on ${provider}`,
          ERROR_CODES.AI_MODEL_NOT_FOUND,
          false,
          undefined,
          details
        );
      default:
        return new AIError(
          `API error from ${provider}: ${statusCode} - ${responseText}`,
          ERROR_CODES.EXTERNAL_API_ERROR,
          statusCode >= 500, // 5xx errors are retryable
          statusCode >= 500 ? 30000 : undefined,
          details
        );
    }
  }

  static timeout(provider: string, timeoutMs: number): AIError {
    return new AIError(
      `${provider} request timed out after ${timeoutMs}ms`,
      ERROR_CODES.AI_TIMEOUT,
      true,
      10000, // Retry after 10 seconds
      { timeoutMs, provider }
    );
  }

  static invalidResponse(provider: string, reason: string): AIError {
    return new AIError(
      `Invalid response from ${provider}: ${reason}`,
      ERROR_CODES.AI_INVALID_RESPONSE,
      false,
      undefined,
      { provider, reason }
    );
  }

  static networkError(provider: string, originalError: Error): AIError {
    return new AIError(
      `Network error connecting to ${provider}: ${originalError.message}`,
      ERROR_CODES.AI_NETWORK_ERROR,
      true,
      5000, // Retry after 5 seconds
      { provider, originalError: originalError.message }
    );
  }

  static validationFailed(message: string, details?: Record<string, any>): AIError {
    return new AIError(
      message,
      ERROR_CODES.VALIDATION_FAILED,
      false,
      undefined,
      details
    );
  }

  static invalidInput(message: string, details?: Record<string, any>): AIError {
    return new AIError(
      message,
      ERROR_CODES.INVALID_INPUT,
      false,
      undefined,
      details
    );
  }

  static circuitBreakerOpen(provider: string, reason: string): AIError {
    return new AIError(
      `Circuit breaker is open for ${provider}: ${reason}`,
      ERROR_CODES.AI_UNAVAILABLE,
      true,
      30000, // Retry after 30 seconds
      { provider, reason }
    );
  }

  static rateLimited(provider: string, retryAfter?: number): AIError {
    return new AIError(
      `Rate limit exceeded for ${provider}`,
      ERROR_CODES.AI_RATE_LIMITED,
      true,
      retryAfter || 60000, // Default 60 seconds
      { provider }
    );
  }
}