/**
 * Logger Service
 *
 * Centralized logging with consistent formatting and structured context.
 * Designed to be easily extended for production observability (Sentry, DataDog, etc.)
 *
 * Usage:
 *   import { logger } from './services/logger';
 *   logger.info('operation', 'message', { context });
 *   logger.error('operation', 'message', { error, context });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  operation: string;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class LoggerService {
  private isDev = process.env.NODE_ENV !== 'production';
  private useEmoji = process.env.NODE_ENV !== 'production';

  private readonly levelEmoji: Record<LogLevel, string> = {
    debug: '🔍',
    info: '📋',
    warn: '⚠️',
    error: '❌',
  };

  private readonly levelColors: Record<LogLevel, string> = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m',  // green
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
  };

  private readonly reset = '\x1b[0m';

  /**
   * Format log entry for console output
   */
  private format(entry: LogEntry): string {
    const { level, operation, message, context, error } = entry;

    // Dev: pretty format with emoji
    if (this.isDev) {
      const emoji = this.useEmoji ? `${this.levelEmoji[level]} ` : '';
      const prefix = operation ? `[${operation}] ` : '';
      let output = `${emoji}${prefix}${message}`;

      if (context && Object.keys(context).length > 0) {
        output += ` ${JSON.stringify(context)}`;
      }

      if (error) {
        output += `\n  Error: ${error.message}`;
        if (error.stack && level === 'error') {
          output += `\n  ${error.stack.split('\n').slice(1, 4).join('\n  ')}`;
        }
      }

      return output;
    }

    // Production: JSON structured logging
    return JSON.stringify(entry);
  }

  /**
   * Core log method
   */
  private log(level: LogLevel, operation: string, message: string, context?: LogContext, error?: Error): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      operation,
      message,
      context,
    };

    if (error) {
      entry.error = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    const formatted = this.format(entry);

    switch (level) {
      case 'debug':
        if (this.isDev) console.debug(formatted);
        break;
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }

    // Hook for external services (Sentry, DataDog, etc.)
    // this.sendToExternalService(entry);
  }

  /**
   * Debug level - only in development
   */
  debug(operation: string, message: string, context?: LogContext): void {
    this.log('debug', operation, message, context);
  }

  /**
   * Info level - general operational messages
   */
  info(operation: string, message: string, context?: LogContext): void {
    this.log('info', operation, message, context);
  }

  /**
   * Warn level - potential issues
   */
  warn(operation: string, message: string, context?: LogContext): void {
    this.log('warn', operation, message, context);
  }

  /**
   * Error level - errors and exceptions
   */
  error(operation: string, message: string, context?: LogContext, error?: Error): void {
    this.log('error', operation, message, context, error);
  }

  /**
   * Shorthand for logging with report context
   */
  forReport(reportId: string) {
    return {
      debug: (message: string, context?: LogContext) =>
        this.debug(reportId, message, context),
      info: (message: string, context?: LogContext) =>
        this.info(reportId, message, context),
      warn: (message: string, context?: LogContext) =>
        this.warn(reportId, message, context),
      error: (message: string, context?: LogContext, error?: Error) =>
        this.error(reportId, message, context, error),
    };
  }

  /**
   * Shorthand for logging with job context
   */
  forJob(jobId: string) {
    return {
      debug: (message: string, context?: LogContext) =>
        this.debug(`job:${jobId}`, message, context),
      info: (message: string, context?: LogContext) =>
        this.info(`job:${jobId}`, message, context),
      warn: (message: string, context?: LogContext) =>
        this.warn(`job:${jobId}`, message, context),
      error: (message: string, context?: LogContext, error?: Error) =>
        this.error(`job:${jobId}`, message, context, error),
    };
  }

  /**
   * Shorthand for AI operation logging
   */
  forAI(provider: string, model: string) {
    const operation = `ai:${provider}:${model}`;
    return {
      debug: (message: string, context?: LogContext) =>
        this.debug(operation, message, context),
      info: (message: string, context?: LogContext) =>
        this.info(operation, message, context),
      warn: (message: string, context?: LogContext) =>
        this.warn(operation, message, context),
      error: (message: string, context?: LogContext, error?: Error) =>
        this.error(operation, message, context, error),
    };
  }
}

// Singleton export
export const logger = new LoggerService();
