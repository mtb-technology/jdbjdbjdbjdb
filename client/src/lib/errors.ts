/**
 * Centraal error handling systeem voor De Fiscale Analist
 * 
 * Definieert gestandaardiseerde error types en handling patterns
 * voor consistent error management door de gehele applicatie.
 */

export enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  API_ERROR = 'API_ERROR', 
  NETWORK_ERROR = 'NETWORK_ERROR',
  AI_ERROR = 'AI_ERROR',
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface AppErrorDetails {
  code: string;
  message: string;
  type: ErrorType;
  originalError?: Error;
  context?: Record<string, any>;
  timestamp: Date;
  userMessage: string; // Vriendelijke boodschap voor de gebruiker
}

export class AppError extends Error {
  public readonly details: AppErrorDetails;

  constructor(
    type: ErrorType,
    code: string,
    message: string,
    userMessage: string,
    originalError?: Error,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';

    this.details = {
      code,
      message,
      type,
      originalError,
      context,
      timestamp: new Date(),
      userMessage
    };

    // Behoud stack trace voor debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  static fromUnknown(error: unknown, context?: Record<string, any>): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError(
        ErrorType.UNKNOWN_ERROR,
        'UNKNOWN_ERROR',
        error.message,
        'Er is een onverwachte fout opgetreden. Probeer het opnieuw.',
        error,
        context
      );
    }

    return new AppError(
      ErrorType.UNKNOWN_ERROR,
      'UNKNOWN_ERROR',
      String(error),
      'Er is een onverwachte fout opgetreden. Probeer het opnieuw.',
      undefined,
      context
    );
  }

  static validation(message: string, userMessage: string, context?: Record<string, any>): AppError {
    return new AppError(
      ErrorType.VALIDATION_ERROR,
      'VALIDATION_ERROR',
      message,
      userMessage,
      undefined,
      context
    );
  }

  static api(message: string, userMessage: string, originalError?: Error, context?: Record<string, any>): AppError {
    return new AppError(
      ErrorType.API_ERROR,
      'API_ERROR', 
      message,
      userMessage,
      originalError,
      context
    );
  }

  static network(message: string, userMessage: string, originalError?: Error, context?: Record<string, any>): AppError {
    return new AppError(
      ErrorType.NETWORK_ERROR,
      'NETWORK_ERROR',
      message, 
      userMessage,
      originalError,
      context
    );
  }

  static ai(message: string, userMessage: string, originalError?: Error, context?: Record<string, any>): AppError {
    return new AppError(
      ErrorType.AI_ERROR,
      'AI_ERROR',
      message,
      userMessage,
      originalError,
      context
    );
  }

  static business(code: string, message: string, userMessage: string, context?: Record<string, any>): AppError {
    return new AppError(
      ErrorType.BUSINESS_ERROR,
      code,
      message,
      userMessage,
      undefined,
      context
    );
  }

  toJSON() {
    return {
      name: this.name,
      details: {
        ...this.details,
        originalError: this.details.originalError?.message
      }
    };
  }
}

/**
 * Error logging service voor structured logging
 */
export class ErrorLogger {
  static log(error: AppError, additionalContext?: Record<string, any>) {
    const logData = {
      timestamp: error.details.timestamp.toISOString(),
      type: error.details.type,
      code: error.details.code,
      message: error.details.message,
      context: {
        ...error.details.context,
        ...additionalContext
      },
      stack: error.stack
    };

    // In development: gedetailleerde console logging
    if (import.meta.env.DEV) {
      console.group(`🚨 AppError: ${error.details.type}`);
      console.error('Code:', error.details.code);
      console.error('Message:', error.details.message);
      console.error('User Message:', error.details.userMessage);
      if (error.details.context) {
        console.error('Context:', error.details.context);
      }
      if (error.details.originalError) {
        console.error('Original Error:', error.details.originalError);
      }
      console.error('Stack:', error.stack);
      console.groupEnd();
    } else {
      // In production: structured JSON logging
      console.error(JSON.stringify(logData));
    }
  }

  static logAndThrow(error: AppError, additionalContext?: Record<string, any>): never {
    this.log(error, additionalContext);
    throw error;
  }
}