/**
 * Centraal configuratie systeem voor De Fiscale Analist
 * 
 * Consolideert alle applicatie configuraties in een enkele, 
 * type-safe en environment-aware configuratie module.
 */

import { z } from 'zod';

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
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(120000), // 2 minutes
  AI_MAX_RETRIES: z.coerce.number().default(2),
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

// AI Model configuraties
export const AI_MODELS = {
  // Google AI Models
  'gemini-2.5-pro': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'],
    requiresResponsesAPI: false,
    timeout: 120000,
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 32768,
      maxRequestsPerMinute: 60
    }
  },
  'gemini-2.5-flash': {
    provider: 'google' as const,
    handlerType: 'google' as const,
    supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'],
    requiresResponsesAPI: false,
    timeout: 120000,
    defaultConfig: {
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192
    },
    limits: {
      maxTokensPerRequest: 32768,
      maxRequestsPerMinute: 1000
    }
  },
  
  // OpenAI Models
  'gpt-4o': {
    provider: 'openai' as const,
    handlerType: 'openai-standard' as const,
    supportedParameters: ['temperature', 'topP', 'maxOutputTokens', 'reasoning', 'verbosity'],
    requiresResponsesAPI: false,
    timeout: 120000,
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
    timeout: 120000,
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
    timeout: 300000 // 5 minutes
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
    timeout: 300000 // 5 minutes
  },
  'o3-deep-research-2025-06-26': {
    provider: 'openai' as const,
    handlerType: 'openai-deep-research' as const,
    supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'],
    defaultConfig: {
      maxOutputTokens: 16384
    },
    limits: {
      maxTokensPerRequest: 200000,
      maxRequestsPerMinute: 30
    },
    requiresResponsesAPI: true,
    timeout: 600000 // 10 minutes
  },
  'o4-mini-deep-research-2025-06-26': {
    provider: 'openai' as const,
    handlerType: 'openai-deep-research' as const,
    supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'],
    defaultConfig: {
      maxOutputTokens: 16384
    },
    limits: {
      maxTokensPerRequest: 200000,
      maxRequestsPerMinute: 100
    },
    requiresResponsesAPI: true,
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

// Report generator configuratie
export const REPORT_CONFIG = {
  stages: {
    '1_informatiecheck': {
      name: 'Informatie Check',
      timeout: 60000,
      maxTokens: 4096
    },
    '2_complexiteitscheck': {
      name: 'Complexiteits Check', 
      timeout: 60000,
      maxTokens: 4096
    },
    '3_generatie': {
      name: 'Rapport Generatie',
      timeout: 120000,
      maxTokens: 16384
    },
    '4a_JuridischAdviseur': {
      name: 'Juridisch Adviseur Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4b_FiscaalSpecialist': {
      name: 'Fiscaal Specialist Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4c_ComplianceExpert': {
      name: 'Compliance Expert Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4d_RisicoAnalist': {
      name: 'Risico Analist Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4e_KlantenAdviseur': {
      name: 'Klanten Adviseur Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4f_KwaliteitsControleur': {
      name: 'Kwaliteits Controleur Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '4g_ChefEindredactie': {
      name: 'Chef Eindredactie Review',
      timeout: 90000,
      maxTokens: 8192
    },
    '5_feedback_verwerker': {
      name: 'Feedback Verwerker',
      timeout: 180000,
      maxTokens: 16384
    },
    'final_check': {
      name: 'Finale Controle',
      timeout: 120000,
      maxTokens: 16384
    }
  },
  defaultModel: 'gemini-2.5-pro' as AIModelName,
  reviewerModel: 'gpt-4o' as AIModelName,
  generationModel: 'gemini-2.5-pro' as AIModelName
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
    console.error('❌ Configuration validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    return false;
  }
  
  console.log('✅ Configuration validation passed');
  return true;
}