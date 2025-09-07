import { BaseAIHandler, AIModelResponse } from "./base-handler";
import type { AIModelParameters } from "./base-handler";
import { GoogleAIHandler } from "./google-handler";
import { OpenAIStandardHandler } from "./openai-standard-handler";
import { OpenAIReasoningHandler } from "./openai-reasoning-handler";
import { OpenAIGPT5Handler } from "./openai-gpt5-handler";
import { OpenAIDeepResearchHandler } from "./openai-deep-research-handler";
import type { AiConfig } from "@shared/schema";
import { config, getAIModelConfig, type AIModelName } from "../../config";
import { ServerError } from "../../middleware/errorHandler";
import { ERROR_CODES } from "@shared/errors";

export type { AIModelParameters } from "./base-handler";

export interface ModelInfo {
  provider: "google" | "openai";
  handlerType: "google" | "openai-standard" | "openai-reasoning" | "openai-gpt5" | "openai-deep-research";
  supportedParameters: string[];
  requiresResponsesAPI?: boolean;
  timeout?: number;
  defaultConfig: Record<string, any>;
  limits: {
    maxTokensPerRequest: number;
    maxRequestsPerMinute: number;
  };
}

export class AIModelFactory {
  private static instance: AIModelFactory;
  private handlers: Map<string, BaseAIHandler> = new Map();
  private modelRegistry: Map<string, ModelInfo> = new Map();
  private circuitBreaker: Map<string, { failures: number; lastFailure: number; isOpen: boolean }> = new Map();

  private constructor() {
    this.initializeModelRegistry();
    this.initializeHandlers();
  }

  static getInstance(): AIModelFactory {
    if (!AIModelFactory.instance) {
      AIModelFactory.instance = new AIModelFactory();
    }
    return AIModelFactory.instance;
  }

  private initializeModelRegistry() {
    // Load model configurations from centralized config
    for (const [modelName, modelConfig] of Object.entries(config.aiModels)) {
      this.modelRegistry.set(modelName, {
        provider: modelConfig.provider,
        handlerType: modelConfig.handlerType,
        supportedParameters: [...modelConfig.supportedParameters], // Convert readonly to mutable
        requiresResponsesAPI: (modelConfig as any).requiresResponsesAPI || false,
        timeout: (modelConfig as any).timeout || config.AI_REQUEST_TIMEOUT_MS,
        defaultConfig: modelConfig.defaultConfig,
        limits: modelConfig.limits
      });
    }
  }

  private initializeHandlers() {
    // Get API keys from centralized config
    const googleApiKey = config.GOOGLE_AI_API_KEY;
    const openaiApiKey = config.OPENAI_API_KEY;

    // Initialize Google handler
    if (googleApiKey) {
      this.handlers.set("google", new GoogleAIHandler(googleApiKey));
      console.log('✅ Google AI handler initialized');
    } else {
      console.warn('⚠️ Google AI API key not configured');
    }

    // Initialize OpenAI handlers
    if (openaiApiKey) {
      this.handlers.set("openai-standard", new OpenAIStandardHandler(openaiApiKey));
      this.handlers.set("openai-reasoning", new OpenAIReasoningHandler(openaiApiKey));
      this.handlers.set("openai-gpt5", new OpenAIGPT5Handler(openaiApiKey));
      
      // Create deep research handlers for each model
      this.handlers.set("openai-deep-research-o3", new OpenAIDeepResearchHandler(openaiApiKey, "o3-deep-research"));
      this.handlers.set("openai-deep-research-o4", new OpenAIDeepResearchHandler(openaiApiKey, "o4-mini-deep-research"));
      
      console.log('✅ OpenAI handlers initialized');
    } else {
      console.warn('⚠️ OpenAI API key not configured');
    }
  }

  getModelInfo(modelName: string): ModelInfo | undefined {
    return this.modelRegistry.get(modelName);
  }

  getSupportedParameters(modelName: string): string[] {
    const info = this.modelRegistry.get(modelName);
    return info?.supportedParameters || [];
  }

  validateConfig(config: AiConfig): void {
    const modelInfo = this.modelRegistry.get(config.model);
    if (!modelInfo) {
      throw new Error(`Model ${config.model} is niet geregistreerd`);
    }

    // Check if provider matches
    if (config.provider !== modelInfo.provider) {
      throw new Error(`Model ${config.model} hoort bij provider ${modelInfo.provider}, niet ${config.provider}`);
    }

    // Warn about unsupported parameters
    const supportedParams = modelInfo.supportedParameters;
    
    if (config.temperature !== undefined && !supportedParams.includes('temperature')) {
      console.warn(`⚠️ Temperature wordt niet ondersteund door ${config.model}`);
    }
    if (config.topP !== undefined && !supportedParams.includes('topP')) {
      console.warn(`⚠️ TopP wordt niet ondersteund door ${config.model}`);
    }
    if (config.topK !== undefined && !supportedParams.includes('topK')) {
      console.warn(`⚠️ TopK wordt niet ondersteund door ${config.model}`);
    }
  }

  async callModel(
    config: AiConfig,
    prompt: string,
    options?: AIModelParameters & { jobId?: string }
  ): Promise<AIModelResponse> {
    const modelInfo = this.modelRegistry.get(config.model);
    if (!modelInfo) {
      throw new Error(`Model ${config.model} is niet geregistreerd`);
    }

    // Get the appropriate handler
    let handler: BaseAIHandler | undefined;
    
    if (modelInfo.handlerType === "openai-deep-research") {
      // Use specific deep research handler based on model
      if (config.model.includes("o3")) {
        handler = this.handlers.get("openai-deep-research-o3");
      } else if (config.model.includes("o4")) {
        handler = this.handlers.get("openai-deep-research-o4");
      }
    } else {
      handler = this.handlers.get(modelInfo.handlerType);
    }

    if (!handler) {
      throw new Error(`Geen handler gevonden voor ${config.model}`);
    }

    // Validate configuration
    this.validateConfig(config);

    // Filter out unsupported parameters for this model
    const filteredConfig = this.filterConfigForModel(config, modelInfo);

    // Log model selection
    console.log(`🎯 Model Factory: Selected ${config.model} with handler ${modelInfo.handlerType}`, {
      supportedParams: modelInfo.supportedParameters,
      requiresResponsesAPI: modelInfo.requiresResponsesAPI,
      timeout: modelInfo.timeout
    });

    // Check circuit breaker
    const breaker = this.circuitBreaker.get(config.model) || { failures: 0, lastFailure: 0, isOpen: false };
    
    // Reset circuit after 60 seconds
    if (breaker.isOpen && Date.now() - breaker.lastFailure > 60000) {
      breaker.isOpen = false;
      breaker.failures = 0;
      console.log(`🔄 Circuit breaker reset for ${config.model}`);
    }
    
    if (breaker.isOpen) {
      throw new Error(`Circuit breaker OPEN for ${config.model} - too many failures`);
    }
    
    try {
      // Call the handler with timeout
      const timeoutMs = modelInfo.timeout || 120000;
      const result = await Promise.race([
        handler.call(prompt, filteredConfig, options),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
      
      // Reset failures on success
      breaker.failures = 0;
      this.circuitBreaker.set(config.model, breaker);
      
      return result;
    } catch (error: any) {
      // Update circuit breaker
      breaker.failures++;
      breaker.lastFailure = Date.now();
      
      if (breaker.failures >= 3) {
        breaker.isOpen = true;
        console.error(`🚫 Circuit breaker OPENED for ${config.model} after ${breaker.failures} failures`);
      }
      
      this.circuitBreaker.set(config.model, breaker);
      throw error;
    }
  }

  private filterConfigForModel(config: AiConfig, modelInfo: ModelInfo): AiConfig {
    const filtered: AiConfig = {
      provider: config.provider,
      model: config.model,
      // Include all required fields with defaults
      temperature: config.temperature ?? 0.1,
      topP: config.topP ?? 0.95,
      topK: config.topK ?? 20,
      maxOutputTokens: config.maxOutputTokens ?? 8192
    };

    const supportedParams = modelInfo.supportedParameters;

    // Override with actual values only if supported
    if (!supportedParams.includes('temperature')) {
      filtered.temperature = 1; // Neutral value for models that don't support it
    }
    if (!supportedParams.includes('topP')) {
      filtered.topP = 1; // Neutral value for models that don't support it
    }
    if (!supportedParams.includes('topK')) {
      filtered.topK = 20; // Default value for models that don't support it
    }
    
    // Add optional parameters if supported
    if (supportedParams.includes('reasoning') && config.reasoning !== undefined) {
      filtered.reasoning = config.reasoning;
    }
    if (supportedParams.includes('verbosity') && config.verbosity !== undefined) {
      filtered.verbosity = config.verbosity;
    }

    return filtered;
  }

  // Utility method to get all available models
  getAvailableModels(): { model: string; info: ModelInfo }[] {
    const models: { model: string; info: ModelInfo }[] = [];
    this.modelRegistry.forEach((info, model) => {
      models.push({ model, info });
    });
    return models;
  }

  // Check if a model requires special handling
  requiresResponsesAPI(modelName: string): boolean {
    const info = this.modelRegistry.get(modelName);
    return info?.requiresResponsesAPI || false;
  }

  // Get timeout for a model
  getModelTimeout(modelName: string): number {
    const info = this.modelRegistry.get(modelName);
    return info?.timeout || 120000; // Default 2 minutes
  }

  // Additional methods for health check service
  getSupportedModels(): string[] {
    const models: string[] = [];
    this.modelRegistry.forEach((_, modelName) => {
      models.push(modelName);
    });
    return models;
  }

  getHandler(modelName: string): BaseAIHandler | null {
    const modelInfo = this.modelRegistry.get(modelName);
    if (!modelInfo) {
      return null;
    }
    
    // Handle special cases for deep research models
    if (modelInfo.handlerType === "openai-deep-research") {
      if (modelName.includes("o3")) {
        return this.handlers.get("openai-deep-research-o3") || null;
      } else if (modelName.includes("o4")) {
        return this.handlers.get("openai-deep-research-o4") || null;
      }
    }
    
    return this.handlers.get(modelInfo.handlerType) || null;
  }
}