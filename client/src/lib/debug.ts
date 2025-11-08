/**
 * Debug utility for conditional logging
 * Only logs in development mode
 */

const isDevelopment = import.meta.env.DEV;

export const debug = {
  log: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  warn: (...args: any[]) => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  error: (...args: any[]) => {
    // Always log errors, even in production
    console.error(...args);
  },

  info: (...args: any[]) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  // Specific domain loggers
  workflow: {
    stage: (message: string, data?: any) => {
      if (isDevelopment) {
        console.log(`🎯 [Workflow] ${message}`, data || '');
      }
    },

    navigation: (message: string, data?: any) => {
      if (isDevelopment) {
        console.log(`🧭 [Navigation] ${message}`, data || '');
      }
    },

    prompt: (message: string, data?: any) => {
      if (isDevelopment) {
        console.log(`📝 [Prompt] ${message}`, data || '');
      }
    }
  },

  api: {
    request: (endpoint: string, data?: any) => {
      if (isDevelopment) {
        console.log(`📡 [API Request] ${endpoint}`, data || '');
      }
    },

    response: (endpoint: string, data?: any) => {
      if (isDevelopment) {
        console.log(`✅ [API Response] ${endpoint}`, data || '');
      }
    },

    error: (endpoint: string, error: any) => {
      console.error(`❌ [API Error] ${endpoint}`, error);
    }
  }
};
