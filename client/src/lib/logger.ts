/**
 * Conditional logging utility for development vs production
 *
 * In production, only errors and critical warnings are logged
 * In development, all logs are shown with emoji prefixes
 */

const isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

interface LogOptions {
  level?: LogLevel;
  context?: string;
  data?: unknown;
}

/**
 * Centralized logger that respects environment mode
 */
export const logger = {
  /**
   * Debug logs - only shown in development
   */
  debug: (message: string, options?: LogOptions) => {
    if (!isDevelopment) return;

    const prefix = options?.context ? `[${options.context}]` : '';
    console.log(`🔍 ${prefix} ${message}`, options?.data || '');
  },

  /**
   * Info logs - only shown in development
   */
  info: (message: string, options?: LogOptions) => {
    if (!isDevelopment) return;

    const prefix = options?.context ? `[${options.context}]` : '';
    console.log(`ℹ️ ${prefix} ${message}`, options?.data || '');
  },

  /**
   * Warning logs - shown in both dev and production
   */
  warn: (message: string, options?: LogOptions) => {
    const prefix = options?.context ? `[${options.context}]` : '';
    console.warn(`⚠️ ${prefix} ${message}`, options?.data || '');
  },

  /**
   * Error logs - always shown
   */
  error: (message: string, error?: unknown, options?: LogOptions) => {
    const prefix = options?.context ? `[${options.context}]` : '';
    console.error(`❌ ${prefix} ${message}`, error, options?.data || '');
  },

  /**
   * Critical logs - always shown with full stack trace
   */
  critical: (message: string, error?: unknown, options?: LogOptions) => {
    const prefix = options?.context ? `[${options.context}]` : '';
    console.error(`🚨 CRITICAL ${prefix} ${message}`);

    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    } else {
      console.error('Error data:', error);
    }

    if (options?.data) {
      console.error('Additional context:', options.data);
    }
  },

  /**
   * Streaming-specific logger with session context
   */
  streaming: (reportId: string, stageId: string, message: string, data?: unknown) => {
    if (!isDevelopment) return;

    console.log(`🌊 [${reportId}-${stageId}] ${message}`, data || '');
  },

  /**
   * Performance measurement
   */
  perf: (label: string, callback: () => void) => {
    if (!isDevelopment) {
      callback();
      return;
    }

    console.time(`⏱️ ${label}`);
    callback();
    console.timeEnd(`⏱️ ${label}`);
  },

  /**
   * Group logs together (dev only)
   */
  group: (label: string, callback: () => void) => {
    if (!isDevelopment) {
      callback();
      return;
    }

    console.group(label);
    callback();
    console.groupEnd();
  }
};

/**
 * Assert function for development debugging
 */
export function devAssert(condition: boolean, message: string): asserts condition {
  if (isDevelopment && !condition) {
    console.error(`🚨 Assertion failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Log object shape (useful for debugging complex objects)
 */
export function logShape(obj: unknown, label = 'Object'): void {
  if (!isDevelopment) return;

  if (obj === null || obj === undefined) {
    console.log(`📦 ${label}: ${obj}`);
    return;
  }

  if (typeof obj !== 'object') {
    console.log(`📦 ${label} (${typeof obj}):`, obj);
    return;
  }

  const keys = Object.keys(obj);
  console.log(`📦 ${label} shape:`, {
    keys,
    types: keys.reduce((acc, key) => {
      acc[key] = typeof (obj as Record<string, unknown>)[key];
      return acc;
    }, {} as Record<string, string>)
  });
}
