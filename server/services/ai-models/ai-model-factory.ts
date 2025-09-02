import { BaseAIHandler, AIModelResponse } from "./base-handler";
import type { AIModelParameters } from "./base-handler";
import { GoogleAIHandler } from "./google-handler";
import { OpenAIStandardHandler } from "./openai-standard-handler";
import { OpenAIReasoningHandler } from "./openai-reasoning-handler";
import { OpenAIGPT5Handler } from "./openai-gpt5-handler";
import { OpenAIDeepResearchHandler } from "./openai-deep-research-handler";
import type { AiConfig } from "@shared/schema";

export type { AIModelParameters } from "./base-handler";

export interface ModelInfo {
  provider: "google" | "openai";
  handlerType: "google" | "openai-standard" | "openai-reasoning" | "openai-gpt5" | "openai-deep-research";
  supportedParameters: string[];
  requiresResponsesAPI?: boolean;
  timeout?: number;
}

export class AIModelFactory {
  private static instance: AIModelFactory;
  private handlers: Map<string, BaseAIHandler> = new Map();
  private modelRegistry: Map<string, ModelInfo> = new Map();

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
    // Google AI Models
    this.modelRegistry.set("gemini-2.5-pro", {
      provider: "google",
      handlerType: "google",
      supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding']
    });
    
    this.modelRegistry.set("gemini-2.5-flash", {
      provider: "google",
      handlerType: "google",
      supportedParameters: ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding']
    });

    // OpenAI Standard Models
    this.modelRegistry.set("gpt-4o", {
      provider: "openai",
      handlerType: "openai-standard",
      supportedParameters: ['temperature', 'topP', 'maxOutputTokens', 'reasoning', 'verbosity']
    });
    
    this.modelRegistry.set("gpt-4o-mini", {
      provider: "openai",
      handlerType: "openai-standard",
      supportedParameters: ['temperature', 'topP', 'maxOutputTokens', 'reasoning', 'verbosity']
    });

    // OpenAI GPT-5
    this.modelRegistry.set("gpt-5", {
      provider: "openai",
      handlerType: "openai-gpt5",
      supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'],
      requiresResponsesAPI: true,
      timeout: 300000 // 5 minutes
    });

    // OpenAI Reasoning Models (o3 series)
    this.modelRegistry.set("o3-mini", {
      provider: "openai",
      handlerType: "openai-reasoning",
      supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity']
    });
    
    this.modelRegistry.set("o3", {
      provider: "openai",
      handlerType: "openai-reasoning",
      supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity']
    });

    // OpenAI Deep Research Models
    this.modelRegistry.set("o3-deep-research-2025-06-26", {
      provider: "openai",
      handlerType: "openai-deep-research",
      supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'],
      requiresResponsesAPI: true,
      timeout: 600000 // 10 minutes
    });
    
    this.modelRegistry.set("o4-mini-deep-research-2025-06-26", {
      provider: "openai",
      handlerType: "openai-deep-research",
      supportedParameters: ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'],
      requiresResponsesAPI: true,
      timeout: 600000 // 10 minutes
    });
  }

  private initializeHandlers() {
    // Get API keys from environment
    const googleApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
    const openaiApiKey = process.env.OPENAI_API_KEY_JDB || process.env.OPENAI_API_KEY || "";

    // Initialize Google handler
    if (googleApiKey) {
      this.handlers.set("google", new GoogleAIHandler(googleApiKey));
    }

    // Initialize OpenAI handlers
    if (openaiApiKey) {
      this.handlers.set("openai-standard", new OpenAIStandardHandler(openaiApiKey));
      this.handlers.set("openai-reasoning", new OpenAIReasoningHandler(openaiApiKey));
      this.handlers.set("openai-gpt5", new OpenAIGPT5Handler(openaiApiKey));
      
      // Create deep research handlers for each model
      this.handlers.set("openai-deep-research-o3", new OpenAIDeepResearchHandler(openaiApiKey, "o3-deep-research"));
      this.handlers.set("openai-deep-research-o4", new OpenAIDeepResearchHandler(openaiApiKey, "o4-mini-deep-research"));
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

    // Call the handler
    return handler.call(prompt, filteredConfig, options);
  }

  private filterConfigForModel(config: AiConfig, modelInfo: ModelInfo): AiConfig {
    const filtered: AiConfig = {
      provider: config.provider,
      model: config.model,
      // Include all required fields with defaults
      temperature: config.temperature ?? 0.1,
      topP: config.topP ?? 0.95,
      topK: config.topK ?? 20,
      maxOutputTokens: config.maxOutputTokens ?? 2048
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
}