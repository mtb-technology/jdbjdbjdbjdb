/**
 * Centralized Configuration Constants
 *
 * All magic numbers, timeouts, and configuration values
 * extracted to a single source of truth.
 *
 * Benefits:
 * - Easy to tune performance without code changes
 * - Consistent behavior across the application
 * - Clear documentation of limits and constraints
 * - Type-safe constants (readonly)
 */

// ===== API TIMEOUTS =====

/**
 * Timeout configurations for various operations
 */
export const TIMEOUTS = {
  /** Standard AI request timeout (2 minutes) */
  AI_REQUEST: 120_000,

  /** Complex AI operations like report generation (5 minutes) */
  AI_LONG_OPERATION: 300_000,

  /** Reasoning models (o3, o4) may need longer (10 minutes) */
  AI_REASONING: 600_000,

  /** Circuit breaker recovery wait time (1 minute) */
  CIRCUIT_BREAKER_RECOVERY: 60_000,

  /** Request deduplication window (5 minutes) */
  REQUEST_DEDUPLICATION: 300_000,

  /** Standard HTTP request timeout (30 seconds) */
  HTTP_TIMEOUT: 30_000,

  /** Database query timeout (10 seconds) */
  DATABASE_QUERY: 10_000,
} as const;

// ===== CIRCUIT BREAKER CONFIGURATION =====

/**
 * Circuit breaker thresholds and recovery settings
 */
export const CIRCUIT_BREAKER = {
  /** Open circuit after this many consecutive failures */
  FAILURE_THRESHOLD: 5,

  /** Wait this long before attempting recovery (ms) */
  RECOVERY_TIMEOUT_MS: 60_000,

  /** Maximum requests to allow in half-open state */
  HALF_OPEN_MAX_REQUESTS: 3,

  /** Successes needed to close circuit from half-open */
  SUCCESS_TO_CLOSE: 1,
} as const;

// ===== PAGINATION DEFAULTS =====

/**
 * Pagination configuration for list endpoints
 */
export const PAGINATION = {
  /** Default number of items per page */
  DEFAULT_LIMIT: 20,

  /** Maximum items allowed per page */
  MAX_LIMIT: 100,

  /** Minimum items per page */
  MIN_LIMIT: 1,

  /** Default page number */
  DEFAULT_PAGE: 1,
} as const;

// ===== AI TOKEN LIMITS =====

/**
 * Token limits for AI model requests
 */
export const AI_TOKENS = {
  /** Default maximum output tokens for standard requests */
  DEFAULT_MAX: 8_192,

  /** Maximum for long-form content generation */
  LONG_CONTENT_MAX: 32_768,

  /** Maximum for validation and checks */
  VALIDATION_MAX: 100_000,

  /** Minimum output tokens */
  MIN_OUTPUT: 100,

  /** Maximum input tokens for safety */
  MAX_INPUT: 200_000,
} as const;

// ===== RETRY CONFIGURATION =====

/**
 * Retry logic configuration with exponential backoff
 */
export const RETRY = {
  /** Maximum number of retry attempts (initial call + retries) */
  MAX_ATTEMPTS: 3,

  /** Base delay between retries (ms) */
  BASE_DELAY_MS: 1_000,

  /** Maximum delay cap (prevents exponential explosion) */
  MAX_DELAY_MS: 10_000,

  /** Jitter factor (0-1) to prevent thundering herd */
  JITTER_FACTOR: 0.3,
} as const;

// ===== CACHE CONFIGURATION =====

/**
 * Cache TTL (Time To Live) settings
 */
export const CACHE = {
  /** Health check cache TTL (25 seconds) */
  HEALTH_CHECK_TTL: 25_000,

  /** Prompt configuration cache TTL (5 minutes) */
  PROMPT_CONFIG_TTL: 300_000,

  /** Report list cache TTL (1 minute) */
  REPORT_LIST_TTL: 60_000,

  /** Individual report cache TTL (5 seconds) */
  REPORT_DETAIL_TTL: 5_000,

  /** Source list cache TTL (10 minutes) */
  SOURCE_LIST_TTL: 600_000,

  /** Stale-while-revalidate duration for reports */
  REPORT_SWR: 15_000,
} as const;

// ===== FILE UPLOAD LIMITS =====

/**
 * File upload constraints
 */
export const FILE_UPLOAD = {
  /** Maximum file size in bytes (10 MB) */
  MAX_SIZE_BYTES: 10_000_000,

  /** Maximum number of files per upload */
  MAX_FILES: 10,

  /** Allowed file extensions */
  ALLOWED_EXTENSIONS: ['.pdf', '.txt', '.docx', '.doc'],

  /** MIME types for validation */
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ],
} as const;

// ===== BACKUP CONFIGURATION =====

/**
 * Backup and restore settings
 */
export const BACKUP = {
  /** Maximum number of backups to keep */
  MAX_BACKUPS_TO_KEEP: 10,

  /** Backup directory path */
  BACKUP_DIR: 'backups',

  /** Backup file prefix */
  BACKUP_PREFIX: 'prompts-backup',

  /** Auto-backup prefix */
  AUTO_BACKUP_PREFIX: 'auto-backup-before-restore',
} as const;

// ===== MEMORY MANAGEMENT =====

/**
 * Memory limits for in-memory state (WorkflowContext)
 */
export const MEMORY = {
  /** Maximum stage results to keep in memory */
  MAX_STAGE_RESULTS: 100,

  /** Maximum concept versions to keep */
  MAX_CONCEPT_VERSIONS: 50,

  /** Maximum history entries to keep */
  MAX_HISTORY_ENTRIES: 20,

  /** Prune when exceeding limit by this factor */
  PRUNE_THRESHOLD_FACTOR: 1.2,
} as const;

// ===== RATE LIMITING =====

/**
 * Rate limiting configuration for API endpoints
 */
export const RATE_LIMIT = {
  /** Time window for rate limiting (15 minutes) */
  WINDOW_MS: 15 * 60 * 1000,

  /** Maximum requests per window for standard users */
  MAX_REQUESTS: 100,

  /** Maximum requests per window for admin endpoints */
  ADMIN_MAX_REQUESTS: 100,

  /** Rate limit for AI endpoints (lower to prevent abuse) */
  AI_MAX_REQUESTS: 50,

  /** Skip successful OPTIONS requests */
  SKIP_SUCCESSFUL_REQUESTS: true,
} as const;

// ===== INPUT VALIDATION =====

/**
 * Input validation constraints
 */
export const VALIDATION = {
  /** Maximum client name length */
  CLIENT_NAME_MAX_LENGTH: 200,

  /** Maximum raw text length (5 MB) */
  RAW_TEXT_MAX_LENGTH: 5_000_000,

  /** Maximum user instructions length */
  USER_INSTRUCTIONS_MAX_LENGTH: 50_000,

  /** Maximum prompt length */
  PROMPT_MAX_LENGTH: 100_000,

  /** Minimum required text for dossier */
  MIN_DOSSIER_TEXT: 10,

  /** Maximum title length */
  TITLE_MAX_LENGTH: 200,
} as const;

// ===== WORKFLOW CONFIGURATION =====

/**
 * Workflow stage configuration
 */
export const WORKFLOW = {
  /** Stage execution timeout (5 minutes) */
  STAGE_TIMEOUT: 300_000,

  /** Maximum concurrent stage executions */
  MAX_CONCURRENT_STAGES: 3,

  /** Delay between substeps (ms) */
  SUBSTEP_DELAY: 500,

  /** Maximum substeps per stage */
  MAX_SUBSTEPS: 10,
} as const;

// ===== PERFORMANCE MONITORING =====

/**
 * Performance monitoring thresholds
 */
export const PERFORMANCE = {
  /** Slow query threshold (ms) */
  SLOW_QUERY_MS: 1_000,

  /** Slow API request threshold (ms) */
  SLOW_REQUEST_MS: 3_000,

  /** Memory warning threshold (MB) */
  MEMORY_WARNING_MB: 512,

  /** CPU warning threshold (%) */
  CPU_WARNING_PERCENT: 80,
} as const;

// ===== SECURITY =====

/**
 * Security-related constants
 */
export const SECURITY = {
  /** API key rotation period (days) */
  API_KEY_ROTATION_DAYS: 90,

  /** API key grace period after rotation (hours) */
  API_KEY_GRACE_PERIOD_HOURS: 24,

  /** Maximum login attempts before lockout */
  MAX_LOGIN_ATTEMPTS: 5,

  /** Lockout duration (minutes) */
  LOCKOUT_DURATION_MINUTES: 30,

  /** Password minimum length */
  PASSWORD_MIN_LENGTH: 8,

  /** Session timeout (hours) */
  SESSION_TIMEOUT_HOURS: 24,
} as const;

// ===== HELPER FUNCTIONS =====

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoffDelay(attempt: number): number {
  const baseDelay = RETRY.BASE_DELAY_MS;
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, RETRY.MAX_DELAY_MS);

  // Add jitter (0-30% random variation)
  const jitter = Math.random() * cappedDelay * RETRY.JITTER_FACTOR;

  return Math.round(cappedDelay + jitter);
}

/**
 * Check if retry should be attempted based on attempt count
 */
export function shouldRetry(attempt: number): boolean {
  return attempt < RETRY.MAX_ATTEMPTS;
}

/**
 * Check if circuit breaker should be open based on failure count
 */
export function shouldOpenCircuit(failures: number): boolean {
  return failures >= CIRCUIT_BREAKER.FAILURE_THRESHOLD;
}

/**
 * Check if circuit breaker can attempt recovery
 */
export function canAttemptRecovery(lastFailureTime: number): boolean {
  return Date.now() - lastFailureTime > CIRCUIT_BREAKER.RECOVERY_TIMEOUT_MS;
}
