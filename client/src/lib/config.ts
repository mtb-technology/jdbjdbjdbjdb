/**
 * Frontend configuratie voor De Fiscale Analist
 * 
 * Centraliseert alle frontend configuraties en constanten
 * voor consistente applicatie instellingen.
 */

// API configuratie
export const API_CONFIG = {
  BASE_URL: '', // Relatief naar de huidige origin
  ENDPOINTS: {
    // AI en Test endpoints
    TEST_AI: '/api/test-ai',
    EXTRACT_DOSSIER: '/api/extract-dossier',
    
    // Report endpoints
    REPORTS: '/api/reports',
    REPORTS_CREATE: '/api/reports/create',
    REPORTS_GENERATE: '/api/reports/generate',
    REPORTS_WORKFLOW: '/api/reports/workflow',
    
    // Job endpoints
    JOBS: '/api/jobs',
    
    // Source endpoints
    SOURCES: '/api/sources',
    
    // Prompt endpoints
    PROMPTS: '/api/prompts',
    PROMPTS_ACTIVE: '/api/prompts/active',
    
    // Model test endpoints
    MODEL_TEST: '/api/model-test'
  },
  
  // Request configuratie
  TIMEOUT: 30000, // 30 seconds
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000 // 1 second
} as const;

// UI configuratie
export const UI_CONFIG = {
  // Theme
  THEME: {
    DEFAULT: 'light' as const,
    STORAGE_KEY: 'fiscale-analist-theme'
  },
  
  // Sidebar
  SIDEBAR: {
    STORAGE_KEY: 'sidebar_state',
    COOKIE_MAX_AGE: 60 * 60 * 24 * 7, // 7 days
    WIDTH: '16rem',
    WIDTH_MOBILE: '18rem',
    WIDTH_ICON: '3rem',
    KEYBOARD_SHORTCUT: 'b'
  },
  
  // Toast configuratie
  TOAST: {
    DURATION: 5000,
    MAX_TOASTS: 3,
    POSITION: 'bottom-right' as const
  },
  
  // Form configuratie
  FORMS: {
    DEBOUNCE_DELAY: 300,
    VALIDATION_DELAY: 500
  },
  
  // Polling configuratie
  POLLING: {
    REPORT_STATUS_INTERVAL: 2000,
    JOB_STATUS_INTERVAL: 1000,
    MAX_POLL_ATTEMPTS: 300 // 10 minutes at 2s intervals
  }
} as const;

// Query client configuratie
export const QUERY_CONFIG = {
  // Default options voor React Query
  QUERIES: {
    STALE_TIME: 5 * 60 * 1000, // 5 minutes
    CACHE_TIME: 10 * 60 * 1000, // 10 minutes
    RETRY: 1,
    RETRY_DELAY: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
    REFETCH_ON_WINDOW_FOCUS: false,
    REFETCH_INTERVAL: false
  },
  
  MUTATIONS: {
    RETRY: false,
    CACHE_TIME: 5 * 60 * 1000 // 5 minutes
  }
} as const;

// Validatie configuratie
export const VALIDATION_CONFIG = {
  // Dossier validatie
  DOSSIER: {
    MIN_CLIENT_NAME_LENGTH: 2,
    MAX_CLIENT_NAME_LENGTH: 100,
    MIN_SITUATION_LENGTH: 10,
    MAX_SITUATION_LENGTH: 1000,
    MIN_INCOME: 0,
    MAX_INCOME: 10000000, // 10 miljoen
    MIN_ASSETS: 0,
    MAX_ASSETS: 100000000 // 100 miljoen
  },
  
  // Bouwplan validatie
  BOUWPLAN: {
    SUPPORTED_LANGUAGES: ['nl', 'en'],
    MIN_KNELPUNTEN: 1,
    MAX_KNELPUNTEN: 10,
    MAX_KNELPUNT_LENGTH: 200
  },
  
  // Report validatie
  REPORT: {
    MIN_TITLE_LENGTH: 5,
    MAX_TITLE_LENGTH: 200,
    MIN_CONTENT_LENGTH: 100,
    MAX_CONTENT_LENGTH: 50000
  }
} as const;

// Error berichten configuratie
export const ERROR_MESSAGES = {
  // Netwerk errors
  NETWORK: {
    OFFLINE: 'U bent offline. Controleer uw internetverbinding.',
    TIMEOUT: 'Het verzoek duurde te lang. Probeer het opnieuw.',
    SERVER_ERROR: 'Er is een serverfout opgetreden. Probeer het later opnieuw.',
    CONNECTION_FAILED: 'Kan geen verbinding maken met de server.'
  },
  
  // Validatie errors
  VALIDATION: {
    REQUIRED_FIELD: 'Dit veld is verplicht',
    INVALID_EMAIL: 'Voer een geldig e-mailadres in',
    INVALID_JSON: 'Ongeldige JSON-structuur',
    MIN_LENGTH: (min: number) => `Minimaal ${min} karakters vereist`,
    MAX_LENGTH: (max: number) => `Maximaal ${max} karakters toegestaan`
  },
  
  // Business logic errors
  BUSINESS: {
    NO_DOSSIER_DATA: 'Geen dossiergegevens beschikbaar',
    NO_BOUWPLAN_DATA: 'Geen bouwplan gegevens beschikbaar',
    INVALID_REPORT_STATUS: 'Ongeldige rapportstatus',
    REPORT_GENERATION_FAILED: 'Rapport generatie is mislukt'
  },
  
  // AI service errors
  AI: {
    SERVICE_UNAVAILABLE: 'AI service is momenteel niet beschikbaar',
    QUOTA_EXCEEDED: 'AI quota overschreden. Probeer het later opnieuw.',
    INVALID_RESPONSE: 'Ongeldig antwoord van AI service',
    TIMEOUT: 'AI service timeout. Probeer het opnieuw.'
  }
} as const;

// Feature flags configuratie
export const FEATURE_FLAGS = {
  // Development features
  SHOW_DEV_TOOLS: import.meta.env.DEV,
  ENABLE_DEBUG_LOGGING: import.meta.env.DEV,
  
  // Experimental features
  ENABLE_ADVANCED_WORKFLOW: true,
  ENABLE_MODEL_COMPARISON: true,
  ENABLE_EXPORT_FORMATS: ['html', 'pdf', 'docx'],
  
  // UI features
  ENABLE_DARK_MODE: true,
  ENABLE_SIDEBAR_TOGGLE: true,
  ENABLE_REAL_TIME_UPDATES: true
} as const;

// Analytics configuratie (voor toekomstige implementatie)
export const ANALYTICS_CONFIG = {
  ENABLED: false, // Disabled by default voor privacy
  EVENTS: {
    REPORT_GENERATED: 'report_generated',
    WORKFLOW_COMPLETED: 'workflow_completed',
    ERROR_OCCURRED: 'error_occurred',
    AI_MODEL_USED: 'ai_model_used'
  }
} as const;

// Environment helpers
export const ENV = {
  IS_DEVELOPMENT: import.meta.env.DEV,
  IS_PRODUCTION: import.meta.env.PROD,
  MODE: import.meta.env.MODE,
  BASE_URL: import.meta.env.BASE_URL || '/'
} as const;

// Type exports voor type safety
export type ApiEndpoint = keyof typeof API_CONFIG.ENDPOINTS;
export type ErrorMessageKey = keyof typeof ERROR_MESSAGES;
export type FeatureFlag = keyof typeof FEATURE_FLAGS;

// Helper functions
export function getApiUrl(endpoint: ApiEndpoint): string {
  return `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS[endpoint]}`;
}

export function getErrorMessage(category: keyof typeof ERROR_MESSAGES, key: string): string {
  const messages = ERROR_MESSAGES[category] as Record<string, any>;
  return messages[key] || 'Er is een onbekende fout opgetreden';
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag] === true;
}

// Configuration validation
export function validateClientConfig(): boolean {
  const errors: string[] = [];
  
  // Validate required environment variables
  if (!ENV.BASE_URL) {
    errors.push('BASE_URL environment variable is required');
  }
  
  if (errors.length > 0) {
    console.error('❌ Client configuration validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    return false;
  }
  
  if (ENV.IS_DEVELOPMENT) {
    console.log('✅ Client configuration validation passed');
  }
  
  return true;
}