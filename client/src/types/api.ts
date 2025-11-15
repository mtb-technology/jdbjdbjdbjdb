/**
 * Shared TypeScript types for API responses and errors
 *
 * Centralized type definitions to replace 'any' types across the codebase
 */

import type { ProcessFeedbackResponse } from '@shared/types/api';
import type { StreamingEvent } from '@shared/streaming-types';

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * Structured API error
 */
export interface ApiError {
  code?: string;
  message: string;
  userMessage?: string;
  status?: number;
  details?: Record<string, unknown>;
}

/**
 * Typed error for API operations
 */
export class TypedApiError extends Error implements ApiError {
  code?: string;
  userMessage?: string;
  status?: number;
  details?: Record<string, unknown>;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'TypedApiError';
    this.code = error.code;
    this.userMessage = error.userMessage;
    this.status = error.status;
    this.details = error.details;
  }
}

/**
 * Override concept dialog response
 */
export interface OverrideConceptResponse {
  success: boolean;
  version: number;
  message: string;
}

/**
 * Stage execution result
 */
export interface StageExecutionResult {
  success: boolean;
  stage: string;
  result?: string;
  conceptContent?: string;
  version?: number;
  error?: ApiError;
}

/**
 * Manual stage execution result
 */
export interface ManualStageResult {
  success: boolean;
  stage: string;
  content: string;
  isManual: boolean;
}

/**
 * Prompt generation response
 */
export interface PromptGenerationResponse {
  prompt: string;
  systemPrompt?: string;
  userInput?: string;
  metadata?: {
    stage: string;
    timestamp: string;
    promptLength: number;
  };
}

/**
 * Streaming session completion result
 */
export interface StreamingCompletionResult {
  event: string;
  data?: {
    requiresUserAction?: boolean;
    actionType?: 'feedback_instructions' | 'manual_intervention';
    rawFeedback?: string;
    message?: string;
  };
}

/**
 * Feedback processing result (extends shared type)
 */
export interface FeedbackProcessingResult extends ProcessFeedbackResponse {
  // Additional client-side properties if needed
}

/**
 * Type guard to check if error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as ApiError).message === 'string'
  );
}

/**
 * Type guard to check if error is a TypedApiError
 */
export function isTypedApiError(error: unknown): error is TypedApiError {
  return error instanceof TypedApiError;
}

/**
 * Extract user-friendly message from error
 */
export function getErrorMessage(error: unknown): string {
  if (isTypedApiError(error)) {
    return error.userMessage || error.message;
  }

  if (isApiError(error)) {
    return error.userMessage || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
}

/**
 * Extract error code from error
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isApiError(error)) {
    return error.code;
  }

  return undefined;
}

/**
 * Check if error is retryable (network/service issues)
 */
export function isRetryableError(error: unknown): boolean {
  if (!isApiError(error)) return false;

  return (
    error.status === 503 || // Service Unavailable
    error.status === 429 || // Rate Limited
    error.status === 504 || // Gateway Timeout
    error.code === 'AI_SERVICE_UNAVAILABLE' ||
    error.code === 'AI_RATE_LIMITED' ||
    error.code === 'NETWORK_ERROR'
  );
}
