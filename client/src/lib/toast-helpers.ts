/**
 * Toast notification helpers for consistent user feedback
 *
 * Provides standardized toast patterns for success, error, and info messages
 * Integrates with error handler and logger for comprehensive error tracking
 */

import { toast } from '@/hooks/use-toast';
import { logger } from './logger';
import { TypedApiError, isApiError, getErrorMessage } from '@/types/api';

export interface ToastOptions {
  /**
   * Optional custom title (defaults based on toast type)
   */
  title?: string;

  /**
   * Optional custom description
   */
  description?: string;

  /**
   * Duration in milliseconds (defaults: error=6000, success=4000, info=5000)
   */
  duration?: number;

  /**
   * Context for logging (recommended for error toasts)
   */
  context?: string;

  /**
   * Whether to log this toast (defaults: error=true, success/info=false)
   */
  shouldLog?: boolean;
}

/**
 * Show error toast with consistent styling and logging
 * Automatically extracts user-friendly messages from ApiError objects
 */
export function showErrorToast(error: unknown, options: ToastOptions = {}) {
  const {
    title = 'Er ging iets mis',
    duration = 6000,
    context = 'Unknown',
    shouldLog = true,
  } = options;

  // Extract error message
  let description = options.description;

  if (!description) {
    if (isApiError(error)) {
      description = error.userMessage || error.message || 'Er is een onverwachte fout opgetreden';
    } else {
      description = getErrorMessage(error);
    }
  }

  // Log error if enabled
  if (shouldLog) {
    logger.error(`Toast error shown: ${title}`, error, {
      context,
      data: { description }
    });
  }

  // Show toast
  return toast({
    variant: 'destructive',
    title,
    description,
    duration,
  });
}

/**
 * Show success toast with consistent styling
 */
export function showSuccessToast(message: string, options: ToastOptions = {}) {
  const {
    title = 'Gelukt',
    duration = 4000,
    shouldLog = false,
    context = 'Success'
  } = options;

  const description = options.description || message;

  if (shouldLog) {
    logger.info(`Toast success: ${title}`, {
      context,
      data: { description }
    });
  }

  return toast({
    title,
    description,
    duration,
  });
}

/**
 * Show info/warning toast with consistent styling
 */
export function showInfoToast(message: string, options: ToastOptions = {}) {
  const {
    title = 'Let op',
    duration = 5000,
    shouldLog = false,
    context = 'Info'
  } = options;

  const description = options.description || message;

  if (shouldLog) {
    logger.info(`Toast info: ${title}`, {
      context,
      data: { description }
    });
  }

  return toast({
    title,
    description,
    duration,
  });
}

/**
 * Show loading toast (useful for long operations)
 * Returns dismiss function to remove the toast when operation completes
 */
export function showLoadingToast(message: string, options: ToastOptions = {}) {
  const {
    title = 'Even geduld...',
    duration = 0, // No auto-dismiss for loading toasts
  } = options;

  const description = options.description || message;

  const { dismiss } = toast({
    title,
    description,
    duration,
  });

  return dismiss;
}

/**
 * Error toast helper that chains with promises
 * Usage: fetchData().catch(catchWithToast('Failed to load data'))
 */
export function catchWithToast(
  errorTitle: string,
  options: Omit<ToastOptions, 'title'> = {}
) {
  return (error: unknown) => {
    showErrorToast(error, { title: errorTitle, ...options });
    throw error; // Re-throw so promise chain can continue
  };
}

/**
 * Success toast helper for promise chains
 * Usage: saveData().then(thenShowSuccess('Data saved'))
 */
export function thenShowSuccess(
  message: string,
  options: Omit<ToastOptions, 'description'> = {}
) {
  return (result: unknown) => {
    showSuccessToast(message, options);
    return result; // Pass through result for further chaining
  };
}

/**
 * Standardized network error messages
 */
export const NETWORK_ERROR_MESSAGES = {
  OFFLINE: 'Je bent offline. Controleer je internetverbinding.',
  TIMEOUT: 'De actie duurde te lang. Probeer het opnieuw.',
  SERVER_ERROR: 'Er ging iets mis op de server. Probeer het later opnieuw.',
  NOT_FOUND: 'De gevraagde resource kon niet worden gevonden.',
  UNAUTHORIZED: 'Je bent niet geautoriseerd voor deze actie.',
  FORBIDDEN: 'Je hebt geen toegang tot deze resource.',
  VALIDATION_ERROR: 'Controleer je invoer en probeer het opnieuw.',
} as const;

/**
 * Show network error toast based on error status
 */
export function showNetworkErrorToast(error: unknown, options: ToastOptions = {}) {
  let description = options.description;

  if (isApiError(error) && !description) {
    switch (error.status) {
      case 0:
        description = NETWORK_ERROR_MESSAGES.OFFLINE;
        break;
      case 400:
        description = NETWORK_ERROR_MESSAGES.VALIDATION_ERROR;
        break;
      case 401:
        description = NETWORK_ERROR_MESSAGES.UNAUTHORIZED;
        break;
      case 403:
        description = NETWORK_ERROR_MESSAGES.FORBIDDEN;
        break;
      case 404:
        description = NETWORK_ERROR_MESSAGES.NOT_FOUND;
        break;
      case 408:
      case 504:
        description = NETWORK_ERROR_MESSAGES.TIMEOUT;
        break;
      case 500:
      case 502:
      case 503:
        description = NETWORK_ERROR_MESSAGES.SERVER_ERROR;
        break;
      default:
        description = error.userMessage || error.message;
    }
  }

  return showErrorToast(error, {
    ...options,
    description,
  });
}
