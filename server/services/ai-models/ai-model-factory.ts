import { BaseAIHandler, AIModelResponse } from "./base-handler";
import type { AIModelParameters } from "./base-handler";
import { GoogleAIHandler } from "./google-handler";
import { OpenAIStandardHandler } from "./openai-standard-handler";
import { OpenAIReasoningHandler } from "./openai-reasoning-handler";
import { OpenAIGPT5Handler } from "./openai-gpt5-handler";
import type { AiConfig } from "@shared/schema";
import { config, getAIModelConfig, type AIModelName } from "../../config";
import { ServerError } from "../../middleware/errorHandler";
import { ERROR_CODES } from "@shared/errors";
import { TIMEOUTS } from "../../config/constants";

export type { AIModelParameters } from "./base-handler";

/**
 * Type-safe handler types.
 * Als je een nieuw handler type toevoegt, voeg het hier toe.
 * TypeScript zal dan compile-time errors geven als handlerType in AI_MODELS niet klopt.
 */
export type HandlerType = "google" | "openai-standard" | "openai-reasoning" | "openai-gpt5";

export interface ModelInfo {
  provider: "google" | "openai";
  handlerType: HandlerType;
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
  private handlers: Map<HandlerType, BaseAIHandler> = new Map();
  private modelRegistry: Map<string, ModelInfo> = new Map();
  // Note: Circuit breaker logic is handled by BaseAIHandler per-handler instance.
  // This map only tracks handler initialization failures (not runtime call failures).
  private initializationFailures: Set<HandlerType> = new Set();

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

    // Validate and initialize handlers with better error tracking
    const initializeHandler = (
      type: HandlerType,
      Handler: new (key: string, ...args: any[]) => BaseAIHandler,
      apiKey?: string,
      ...args: any[]
    ) => {
      if (!apiKey) {
        console.warn(`⚠️ ${type} API key not configured`);
        return;
      }

      try {
        const handler = new Handler(apiKey, ...args);
        this.handlers.set(type, handler);
        console.log(`✅ ${type} handler initialized`);
      } catch (error) {
        console.error(`❌ Failed to initialize ${type} handler:`, error);
        this.initializationFailures.add(type);
      }
    };

    // Initialize Google handler (includes our own deep research via ResearchOrchestrator)
    initializeHandler("google", GoogleAIHandler, googleApiKey);

    // Initialize OpenAI handlers with additional validation
    if (openaiApiKey) {
      // Validate OpenAI key format
      if (!openaiApiKey.startsWith('sk-') || openaiApiKey.length < 32) {
        console.warn('⚠️ Invalid OpenAI API key format - OpenAI handlers will not be initialized');
        return; // Skip OpenAI initialization instead of throwing
      }

      // Initialize all OpenAI handlers
      initializeHandler("openai-standard", OpenAIStandardHandler, openaiApiKey);
      initializeHandler("openai-reasoning", OpenAIReasoningHandler, openaiApiKey);
      initializeHandler("openai-standard", OpenAIStandardHandler, openaiApiKey, "gpt-4o");
      
      // Deep research handlers
      // Note: Deep research models are experimental and may not be available
      // Using o3-mini for advanced reasoning instead
      initializeHandler(
        "openai-reasoning",
        OpenAIReasoningHandler,
        openaiApiKey,
        "o3-mini"
      );
      initializeHandler("openai-gpt5", OpenAIGPT5Handler, openaiApiKey);
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
    prompt: string | { systemPrompt: string; userInput: string },
    options?: AIModelParameters & { jobId?: string }
  ): Promise<AIModelResponse> {
    const modelInfo = this.modelRegistry.get(config.model);
    if (!modelInfo) {
      throw new Error(`Model ${config.model} is niet geregistreerd`);
    }

    // Get the appropriate handler based on handlerType
    const handler = this.handlers.get(modelInfo.handlerType);

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

    // Normalize prompt format - support both old (string) and new (object) formats
    let finalPrompt: string;
    if (typeof prompt === 'string') {
      // Legacy format: single prompt string
      finalPrompt = prompt;
      console.log(`📝 [${options?.jobId}] Using legacy prompt format (single string)`);
    } else {
      // New format: separate system prompt and user input
      finalPrompt = `${prompt.systemPrompt}\n\n### USER INPUT:\n${prompt.userInput}`;
      console.log(`📝 [${options?.jobId}] Using new prompt format (system + user input)`, {
        systemPromptLength: prompt.systemPrompt.length,
        userInputLength: prompt.userInput.length
      });
    }

    // Pass model-specific timeout to handler via options
    // Use longer timeout for grounding requests (10 min vs 2 min)
    let timeoutMs = modelInfo.timeout || 120000;
    if (options?.useGrounding) {
      timeoutMs = TIMEOUTS.AI_GROUNDING;
      console.log(`⏱️ Using extended timeout for grounding request: ${timeoutMs}ms`);
    }
    const optionsWithTimeout = {
      ...options,
      timeout: timeoutMs
    };

    // Circuit breaker logic is handled by BaseAIHandler.call()
    return handler.call(finalPrompt, filteredConfig, optionsWithTimeout);
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
    if (supportedParams.includes('thinkingLevel') && (config as any).thinkingLevel !== undefined) {
      (filtered as any).thinkingLevel = (config as any).thinkingLevel;
    }
    // Deep research workflow parameters
    if (supportedParams.includes('useDeepResearch') && (config as any).useDeepResearch !== undefined) {
      (filtered as any).useDeepResearch = (config as any).useDeepResearch;
    }
    if (supportedParams.includes('maxQuestions') && (config as any).maxQuestions !== undefined) {
      (filtered as any).maxQuestions = (config as any).maxQuestions;
    }
    if (supportedParams.includes('parallelExecutors') && (config as any).parallelExecutors !== undefined) {
      (filtered as any).parallelExecutors = (config as any).parallelExecutors;
    }
    if (supportedParams.includes('polishPrompt') && (config as any).polishPrompt !== undefined) {
      (filtered as any).polishPrompt = (config as any).polishPrompt;
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

    return this.handlers.get(modelInfo.handlerType) || null;
  }
}