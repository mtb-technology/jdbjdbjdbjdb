/**
 * Service interface definities voor dependency injection en type safety
 */

import type { 
  Report, InsertReport, 
  User, InsertUser,
  PromptConfig, AiConfig,
  DossierData, BouwplanData
} from '../schema';

// ===== STORAGE SERVICE INTERFACE =====

export interface IStorageService {
  // Report operations
  createReport(data: InsertReport): Promise<Report>;
  getReport(id: string): Promise<Report | null>;
  getAllReports(): Promise<Report[]>;
  updateReport(id: string, data: Partial<InsertReport>): Promise<Report>;
  deleteReport(id: string): Promise<boolean>;
  
  // User operations
  createUser(data: InsertUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  
  // Prompt config operations
  createPromptConfig(data: any): Promise<PromptConfig>;
  getAllPromptConfigs(): Promise<PromptConfig[]>;
  getActivePromptConfig(): Promise<PromptConfig | null>;
  activatePromptConfig(id: string): Promise<PromptConfig>;
  getPromptConfigById(id: string): Promise<PromptConfig | null>;
}

// ===== AI SERVICE INTERFACE =====

export interface AIModelParameters {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high';
  };
  verbosity?: 'low' | 'medium' | 'high';
  useGrounding?: boolean;
  useWebSearch?: boolean;
}

export interface AIModelResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: string;
  metadata?: Record<string, any>;
}

export interface IAIHandler {
  generateContent(
    prompt: string, 
    parameters?: AIModelParameters
  ): Promise<AIModelResponse>;
  
  validateParameters(parameters: AIModelParameters): boolean;
  getSupportedParameters(): string[];
  getModelName(): string;
  getProvider(): string;
}

export interface IAIModelFactory {
  getHandler(modelName: string): IAIHandler | null;
  getSupportedModels(): string[];
  getModelInfo(modelName: string): ModelInfo | null;
  isModelSupported(modelName: string): boolean;
  validateModelConfig(modelName: string, config: AIModelParameters): boolean;
}

export interface ModelInfo {
  provider: "google" | "openai";
  handlerType: string;
  supportedParameters: string[];
  requiresResponsesAPI?: boolean;
  timeout?: number;
  defaultConfig: Record<string, any>;
  limits: {
    maxTokensPerRequest: number;
    maxRequestsPerMinute: number;
  };
}

// ===== REPORT GENERATION SERVICE INTERFACE =====

export interface ReportGenerationStage {
  name: string;
  type: 'generator' | 'reviewer' | 'processor';
  dependencies: string[];
  timeout: number;
}

export interface StageExecutionResult {
  stage: string;
  success: boolean;
  output: string;
  metadata: Record<string, any>;
  nextStage?: string;
  errors?: string[];
}

export interface IReportGeneratorService {
  generateReport(
    dossier: DossierData,
    bouwplan: BouwplanData,
    promptConfig: PromptConfig,
    aiConfig?: AiConfig
  ): Promise<string>;
  
  executeStage(
    reportId: string,
    stage: string,
    input: Record<string, any>,
    config?: any
  ): Promise<StageExecutionResult>;
  
  getAvailableStages(): ReportGenerationStage[];
  validateStageInput(stage: string, input: Record<string, any>): boolean;
  getStageProgress(reportId: string): Promise<number>;
}

// ===== SOURCE VALIDATION SERVICE INTERFACE =====

export interface SourceValidationResult {
  isValid: boolean;
  domain: string;
  isAccessible?: boolean;
  lastChecked: Date;
  errors?: string[];
}

export interface ISourceValidatorService {
  validateSource(url: string): Promise<boolean>;
  verifySourceAvailability(url: string): Promise<boolean>;
  getAllowedDomains(): string[];
  validateSources(urls: string[]): Promise<{ valid: string[], invalid: string[] }>;
  getValidationStats(): {
    allowedDomains: number;
    verificationTimeout: number;
    maxRetries: number;
    supportedDomains: string[];
  };
}

// ===== CONFIGURATION SERVICE INTERFACE =====

export interface IConfigurationService {
  get<T>(key: string): T;
  getAIModelConfig(modelName: string): any;
  getDatabaseConfig(): any;
  getServerConfig(): any;
  validateConfiguration(): boolean;
  getEnvironment(): 'development' | 'production' | 'test';
}

// ===== LOGGING SERVICE INTERFACE =====

export interface LogLevel {
  DEBUG: 'debug';
  INFO: 'info';
  WARN: 'warn';
  ERROR: 'error';
}

export interface LogEntry {
  level: keyof LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  requestId?: string;
  userId?: string;
}

export interface ILoggingService {
  debug(message: string, context?: Record<string, any>): void;
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, error?: Error, context?: Record<string, any>): void;
  setContext(context: Record<string, any>): void;
  setRequestId(requestId: string): void;
  setUserId(userId: string): void;
}

// ===== SERVICE CONTAINER INTERFACE =====

export interface IServiceContainer {
  register<T>(key: string, factory: () => T): void;
  registerSingleton<T>(key: string, factory: () => T): void;
  resolve<T>(key: string): T;
  isRegistered(key: string): boolean;
}

// ===== VALIDATION SERVICE INTERFACE =====

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

export interface IValidationService {
  validateDossier(data: any): ValidationResult<DossierData>;
  validateBouwplan(data: any): ValidationResult<BouwplanData>;
  validateAiConfig(data: any): ValidationResult<AiConfig>;
  validatePromptConfig(data: any): ValidationResult<PromptConfig>;
  validateUserInput(data: any): ValidationResult<InsertUser>;
}

// ===== HEALTH CHECK SERVICE INTERFACE =====

export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  responseTime: number;
  details?: Record<string, any>;
  lastChecked: Date;
}

export interface IHealthCheckService {
  checkDatabase(): Promise<HealthCheckResult>;
  checkAIServices(): Promise<HealthCheckResult[]>;
  checkExternalSources(): Promise<HealthCheckResult>;
  getOverallHealth(): Promise<{
    healthy: boolean;
    services: HealthCheckResult[];
    timestamp: Date;
  }>;
}