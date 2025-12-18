/**
 * Centraal configuratie systeem voor De Fiscale Analist
 * 
 * Consolideert alle applicatie configuraties in een enkele, 
 * type-safe en environment-aware configuratie module.
 */

import { z } from 'zod';
import * as dotenv from 'dotenv';
import { logger } from '../services/logger';

// Load environment variables from .env file
dotenv.config();

// Environment schema voor validatie
const envSchema = z.object({
  // Server configuratie
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  
  // Database configuratie
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  
  // AI Service configuratie
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  
  // Session configuratie
  SESSION_SECRET: z.string().default('dev-session-secret'),
  
  // Logging configuratie  
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // AI Service limits
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(600000), // 10 minutes for complex reports
  AI_MAX_RETRIES: z.coerce.number().default(2),

  // Slack notifications
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  PORTAL_BASE_URL: z.string().url().optional(),

  // Automail webhook integration
  AUTOMAIL_WEBHOOK_SECRET: z.string().min(16, 'AUTOMAIL_WEBHOOK_SECRET must be at least 16 characters').optional(),
});

// Validate environment variables
const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error('❌ Invalid environment configuration:');
  envResult.error.issues.forEach(issue => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });
  process.exit(1);
}

const env = envResult.data;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LAYER 1: MODEL CAPABILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Statische metadata over wat elk AI model KAN doen.
 * Dit is NIET de runtime configuratie - zie AIConfigResolver voor dat.
 *
 * Elke entry definieert:
 * - provider: welke AI provider (google/openai)
 * - handlerType: welke handler class te gebruiken
 * - supportedParameters: welke config params dit model accepteert
 * - timeout: max wachttijd voor dit model
 * - defaultConfig: standaard parameter waarden
 * - limits: harde limieten van de provider
 *
 * @see docs/ARCHITECTURE.md voor het 3-layer config model
 * @see AIConfigResolver voor Layer 3 (runtime config)
 */
export const AI_MODELS = {
  // Google AI Models
  'gemini-2.5-pro': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'],
    requiresResponsesAPI: false,
    timeout: 300000, // 5 minutes
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 65535, // Gemini 2.5 Pro supports up to 65,535 output tokens
      maxRequestsPerMinute: 60
    }
  },
  'gemini-2.5-flash': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'],
    requiresResponsesAPI: false,
    timeout: 300000, // 5 minutes
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 65535, // Gemini 2.5 Flash also supports up to 65,535 output tokens
      maxRequestsPerMinute: 1000
    }
  },
  'gemini-2.5-flash-exp': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'],
    requiresResponsesAPI: false,
    timeout: 300000, // 5 minutes
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 65535,
      maxRequestsPerMinute: 1000
    }
  },
  // Gemini 3 Models (uses our own ResearchOrchestrator for deep research)
  'gemini-3-pro-preview': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'thinkingLevel', 'useGrounding', 'useDeepResearch', 'maxQuestions', 'parallelExecutors', 'polishPrompt'],
    requiresResponsesAPI: false,
    timeout: 1800000, // 30 minutes for deep research
    defaultConfig: {
      temperature: 1.0, // Gemini 3 optimized for default 1.0
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 16384, // Higher for thinking+grounding which consume extra tokens
      thinkingLevel: 'high' // default: high (dynamic thinking)
    },
    limits: {
      maxTokensPerRequest: 64000, // 64k output token limit
      maxRequestsPerMinute: 60
    }
  },
  // Gemini 3 Flash - Pro-level intelligence at Flash speed/pricing
  'gemini-3-flash-preview': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'thinkingLevel', 'useGrounding'],
    requiresResponsesAPI: false,
    timeout: 600000, // 10 minutes
    defaultConfig: {
      temperature: 1.0, // Gemini 3 optimized for default 1.0
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 16384,
      thinkingLevel: 'high' // default: high (dynamic thinking)
    },
    limits: {
      maxTokensPerRequest: 64000, // 64k output token limit
      maxRequestsPerMinute: 1000 // Higher rate limit than Pro
    }
  },

  // OpenAI Models
  'gpt-4o': {
    provider: 'openai' as const,
    handlerType: 'openai-standard' as const,
    supportedParameters: ['temperature', 'topP', 'maxOutputTokens', 'reasoning', 'verbosity'],
    requiresResponsesAPI: false,
    timeout: 300000, // 5 minutes
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 128000,
      maxRequestsPerMinute: 500
    }
  },
  'gpt-4o-mini': {
    provider: 'openai' as const,
    handlerType: 'openai-standard' as const,
    supportedParameters: ['temperature', 'topP', 'maxOutputTokens', 'reasoning', 'verbosity'],
    requiresResponsesAPI: false,
    timeout: 300000, // 5 minutes
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 128000,
      maxRequestsPerMinute: 1000
    }
  },
  'gpt-5': {
    provider: 'openai' as const,
    handlerType: 'openai-gpt5' as const,
    supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'],
    defaultConfig: {
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 200000,
      maxRequestsPerMinute: 50
    },
    requiresResponsesAPI: true,
    timeout: 600000 // 10 minutes
  },
  'o3-mini': {
    provider: 'openai' as const,
    handlerType: 'openai-reasoning' as const,
    supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity'],
    defaultConfig: {
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 128000,
      maxRequestsPerMinute: 100
    },
    requiresResponsesAPI: false,
    timeout: 180000 // 3 minutes
  },
  'o3': {
    provider: 'openai' as const,
    handlerType: 'openai-reasoning' as const,
    supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity'],
    defaultConfig: {
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 128000,
      maxRequestsPerMinute: 50
    },
    requiresResponsesAPI: false,
    timeout: 600000 // 10 minutes
  }
} as const;

export type AIModelName = keyof typeof AI_MODELS;

// Database configuratie
export const DATABASE_CONFIG = {
  url: env.DATABASE_URL,
  connectionPool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  },
  retries: {
    max: 3,
    delay: 1000
  }
} as const;

// Source validator configuratie
export const SOURCE_VALIDATION = {
  allowedDomains: [
    'belastingdienst.nl',
    'wetten.overheid.nl', 
    'rijksoverheid.nl'
  ],
  verificationTimeout: 5000,
  maxRetries: 2
} as const;

/**
 * Report Generator Configuration
 *
 * Stage-specific overrides for timeout and token limits.
 *
 * NOTE: maxTokens here acts as a MINIMUM FLOOR for stage output.
 * If the database AI config has lower maxOutputTokens, these values
 * will override it. This ensures stages like '3_generatie' always
 * have sufficient output capacity regardless of database config.
 *
 * The actual token limit used is: max(stageMaxTokens, aiConfig.maxOutputTokens)
 * @see server/services/report-generator.ts for usage
 */
export const REPORT_CONFIG = {
  stages: {
    '1a_informatiecheck': {
      name: 'Informatie Analyse',
      timeout: 60000,
      maxTokens: 4096  // Floor for output tokens
    },
    '1b_informatiecheck_email': {
      name: 'Email Generatie',
      timeout: 60000,
      maxTokens: 4096
    },
    '2_complexiteitscheck': {
      name: 'Complexiteits Check',
      timeout: 120000, // Increased to 2 minutes for rate limit retries
      maxTokens: 4096
    },
    '3_generatie': {
      name: 'Rapport Generatie',
      timeout: 600000, // 10 minutes for large reports
      maxTokens: 32768 // Double token capacity
    },
    '4a_BronnenSpecialist': {
      name: 'Bronnen Specialist Review',
      timeout: 600000, // Match GPT-5 model timeout for long analysis
      maxTokens: 12288 // More space for detailed feedback
    },
    '4b_FiscaalTechnischSpecialist': {
      name: 'Fiscaal Technisch Specialist Review',
      timeout: 120000, // Extended for complex analysis
      maxTokens: 12288 // More space for technical details
    },
    '4c_ScenarioGatenAnalist': {
      name: 'Scenario Gaten Analist Review',
      timeout: 120000,
      maxTokens: 12288 // Increased - was truncating JSON output
    },
    '4e_DeAdvocaat': {
      name: 'De Advocaat Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4f_HoofdCommunicatie': {
      name: 'Hoofd Communicatie Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '6_change_summary': {
      name: 'Change Summary',
      timeout: 60000,
      maxTokens: 8192
    }
  },
  // Hybrid workflow model selection
  defaultModel: 'gpt-4o-mini' as AIModelName, // Fast for automated checks
  reviewerModel: 'gpt-4o' as AIModelName, // Balanced for reviews - restored with fallback handling
  generationModel: 'gpt-5' as AIModelName, // Powerful for large reports
  simpleTaskModel: 'gpt-4o-mini' as AIModelName, // Quick tasks (1-2 mins)
  complexTaskModel: 'gemini-3-pro-preview' as AIModelName // Gemini 3 Pro with deep research via useDeepResearch (20-30 mins)
} as const;

// Session configuratie
export const SESSION_CONFIG = {
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' as const
  },
  name: 'fiscale-analist-session'
} as const;

// Rate limiting configuratie
export const RATE_LIMIT_CONFIG = {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: {
    success: false,
    error: {
      type: 'RATE_LIMIT_ERROR',
      code: 'TOO_MANY_REQUESTS',
      message: 'Te veel verzoeken',
      userMessage: 'U heeft te veel verzoeken gedaan. Probeer het over een paar minuten opnieuw.',
      timestamp: new Date().toISOString()
    }
  },
  standardHeaders: true,
  legacyHeaders: false
} as const;

// Logging configuratie
export const LOGGING_CONFIG = {
  level: env.LOG_LEVEL,
  format: env.NODE_ENV === 'production' ? 'json' : 'pretty',
  enableColors: env.NODE_ENV !== 'production',
  enableTimestamp: true,
  enableRequestId: true
} as const;

// Export all configuration
export const config = {
  // Environment
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  IS_DEVELOPMENT: env.NODE_ENV === 'development',
  IS_PRODUCTION: env.NODE_ENV === 'production',
  
  // API Keys  
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  GOOGLE_AI_API_KEY: env.GOOGLE_AI_API_KEY,
  
  // Service timeouts
  AI_REQUEST_TIMEOUT_MS: env.AI_REQUEST_TIMEOUT_MS,
  AI_MAX_RETRIES: env.AI_MAX_RETRIES,
  
  // Modules
  database: DATABASE_CONFIG,
  session: SESSION_CONFIG,
  rateLimit: RATE_LIMIT_CONFIG,
  logging: LOGGING_CONFIG,
  sourceValidation: SOURCE_VALIDATION,
  reports: REPORT_CONFIG,
  aiModels: AI_MODELS
} as const;

export type Config = typeof config;

// Helper functions
export function getAIModelConfig(modelName: AIModelName) {
  const modelConfig = AI_MODELS[modelName];
  if (!modelConfig) {
    throw new Error(`Unknown AI model: ${modelName}`);
  }
  return modelConfig;
}

export function getStageConfig(stageName: keyof typeof REPORT_CONFIG.stages) {
  const stageConfig = REPORT_CONFIG.stages[stageName];
  if (!stageConfig) {
    throw new Error(`Unknown stage: ${stageName}`);
  }
  return stageConfig;
}

// Validate critical configurations on startup
export function validateConfig() {
  const errors: string[] = [];
  
  // Check AI API keys
  if (!config.OPENAI_API_KEY && !config.GOOGLE_AI_API_KEY) {
    errors.push('At least one AI API key (OPENAI_API_KEY or GOOGLE_AI_API_KEY) must be configured');
  }
  
  if (errors.length > 0) {
    logger.error('config', 'Configuration validation failed', { errors });
    return false;
  }

  logger.info('config', 'Configuration validation passed');
  return true;
}