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