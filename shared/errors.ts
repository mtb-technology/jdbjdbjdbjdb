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

/**
 * AI Error Category - high-level classification for error handling
 */
export type AIErrorCategory =
  | 'rate_limit'      // Rate limit exceeded (429)
  | 'authentication'  // Invalid API key or auth failure
  | 'token_limit'     // Output token limit reached
  | 'timeout'         // Request timed out
  | 'network'         // Network/connectivity issues
  | 'invalid_response'// Malformed response from AI
  | 'cancelled'       // Request was cancelled
  | 'circuit_breaker' // Circuit breaker open
  | 'unknown';        // Unknown error type

/**
 * Simple error class for AI handlers with typed error categories
 */
export class AIError extends Error {
  public errorCode: ErrorCode;
  public isRetryable: boolean;
  public details?: Record<string, any>;
  public retryAfter?: number;
  public category: AIErrorCategory;

  constructor(
    message: string,
    public code: ErrorCode = ERROR_CODES.AI_SERVICE_UNAVAILABLE,
    public statusCode: number = 500,
    options?: {
      isRetryable?: boolean;
      details?: Record<string, any>;
      retryAfter?: number;
      category?: AIErrorCategory;
    }
  ) {
    super(message);
    this.name = 'AIError';
    this.errorCode = code; // Alias for backward compatibility
    this.isRetryable = options?.isRetryable ?? false;
    this.details = options?.details;
    this.retryAfter = options?.retryAfter;
    this.category = options?.category ?? 'unknown';
  }

  // ========== Type checking methods ==========

  /** Check if this is a rate limit error */
  isRateLimitError(): boolean {
    return this.category === 'rate_limit' || this.code === ERROR_CODES.AI_RATE_LIMITED;
  }

  /** Check if this is an authentication error */
  isAuthenticationError(): boolean {
    return this.category === 'authentication' || this.code === ERROR_CODES.AI_AUTHENTICATION_FAILED;
  }

  /** Check if this is a token limit error */
  isTokenLimitError(): boolean {
    return this.category === 'token_limit';
  }

  /** Check if this is a timeout error */
  isTimeoutError(): boolean {
    return this.category === 'timeout';
  }

  /** Check if this was cancelled */
  isCancelled(): boolean {
    return this.category === 'cancelled';
  }

  // ========== Static factory methods ==========

  static invalidInput(message: string, details?: Record<string, any>) {
    return new AIError(message, ERROR_CODES.VALIDATION_FAILED, 400, {
      details,
      category: 'unknown'
    });
  }

  static invalidResponse(message: string, details?: Record<string, any>) {
    return new AIError(message, ERROR_CODES.AI_INVALID_RESPONSE, 502, {
      details,
      isRetryable: true,
      category: 'invalid_response'
    });
  }

  static networkError(provider: string, error: any) {
    return new AIError(
      `Network error connecting to ${provider}: ${error.message}`,
      ERROR_CODES.NETWORK_ERROR,
      503,
      {
        details: { provider, originalError: error.code },
        isRetryable: true,
        category: 'network'
      }
    );
  }

  static rateLimited(provider: string, retryAfter?: number) {
    return new AIError(
      `Rate limit exceeded for ${provider}${retryAfter ? ` - retry after ${retryAfter}s` : ''}`,
      ERROR_CODES.AI_RATE_LIMITED,
      429,
      {
        details: { provider },
        isRetryable: true,
        retryAfter: retryAfter ? retryAfter * 1000 : undefined,
        category: 'rate_limit'
      }
    );
  }

  static authenticationFailed(provider: string, message?: string) {
    return new AIError(
      message || `Authentication failed for ${provider}`,
      ERROR_CODES.AI_AUTHENTICATION_FAILED,
      401,
      {
        details: { provider },
        isRetryable: false,
        category: 'authentication'
      }
    );
  }

  static tokenLimitExceeded(model: string, details?: { requested?: number; maximum?: number }) {
    const msg = details?.maximum
      ? `Token limit exceeded for ${model}: requested ${details.requested ?? 'unknown'}, max ${details.maximum}`
      : `Token limit exceeded for ${model}`;
    return new AIError(
      msg,
      ERROR_CODES.AI_PROCESSING_FAILED,
      400,
      {
        details: { model, ...details },
        isRetryable: false,
        category: 'token_limit'
      }
    );
  }

  static fromHttpError(status: number, provider: string, message?: string) {
    // Determine category and code based on HTTP status
    let category: AIErrorCategory = 'unknown';
    let code: ErrorCode = ERROR_CODES.AI_SERVICE_UNAVAILABLE;
    let isRetryable = false;

    if (status === 429) {
      category = 'rate_limit';
      code = ERROR_CODES.AI_RATE_LIMITED;
      isRetryable = true;
    } else if (status === 401 || status === 403) {
      category = 'authentication';
      code = ERROR_CODES.AI_AUTHENTICATION_FAILED;
      isRetryable = false;
    } else if (status >= 500) {
      category = 'network';
      code = ERROR_CODES.AI_SERVICE_UNAVAILABLE;
      isRetryable = true;
    }

    return new AIError(
      message || `HTTP ${status} from ${provider}`,
      code,
      status,
      { details: { provider, httpStatus: status }, isRetryable, category }
    );
  }

  static validationFailed(message: string) {
    return new AIError(message, ERROR_CODES.VALIDATION_FAILED, 400, {
      category: 'unknown'
    });
  }

  static timeout(model: string, timeoutMs?: number) {
    const message = timeoutMs
      ? `Request to ${model} timed out after ${timeoutMs}ms`
      : `Request to ${model} timed out`;
    return new AIError(message, ERROR_CODES.AI_SERVICE_UNAVAILABLE, 504, {
      isRetryable: true,
      category: 'timeout'
    });
  }

  static circuitBreakerOpen(message: string = 'Circuit breaker open') {
    return new AIError(message, ERROR_CODES.AI_SERVICE_UNAVAILABLE, 503, {
      isRetryable: true,
      category: 'circuit_breaker'
    });
  }

  static cancelled(model: string) {
    return new AIError(
      `Request to ${model} was cancelled`,
      ERROR_CODES.AI_SERVICE_UNAVAILABLE,
      499,
      { isRetryable: false, category: 'cancelled' }
    );
  }
}

/**
 * Check if an error is an AIError
 */
export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

/**
 * Get the error category from any error (AIError or generic Error)
 * Falls back to string matching for backwards compatibility with non-AIError errors
 */
export function getErrorCategory(error: unknown): AIErrorCategory {
  if (isAIError(error)) {
    return error.category;
  }

  // Fallback: string matching for legacy errors
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('429')) {
      return 'rate_limit';
    }
    if (msg.includes('authentication') || msg.includes('api key') || msg.includes('401') || msg.includes('403')) {
      return 'authentication';
    }
    if (msg.includes('token') && (msg.includes('limit') || msg.includes('exceeded') || msg.includes('incomplete'))) {
      return 'token_limit';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }
    if (msg.includes('cancel')) {
      return 'cancelled';
    }
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return 'network';
    }
  }

  return 'unknown';
}
