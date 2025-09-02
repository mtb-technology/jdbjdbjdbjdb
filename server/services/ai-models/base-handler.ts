import type { AiConfig } from "@shared/schema";

export interface AIModelResponse {
  content: string;
  usage?: any;
  duration: number;
  metadata?: Record<string, any>;
}

export interface AIModelParameters {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  reasoning?: {
    effort?: "minimal" | "low" | "medium" | "high";
  };
  verbosity?: "low" | "medium" | "high";
  useWebSearch?: boolean;
  useGrounding?: boolean;
}

export abstract class BaseAIHandler {
  protected modelName: string;
  protected apiKey: string | undefined;

  constructor(modelName: string, apiKey?: string) {
    this.modelName = modelName;
    this.apiKey = apiKey;
  }

  // Abstract methods that each handler must implement
  abstract call(prompt: string, config: AiConfig, options?: AIModelParameters): Promise<AIModelResponse>;
  abstract validateParameters(config: AiConfig): void;
  abstract getSupportedParameters(): string[];

  // Common utility methods
  protected logStart(jobId: string | undefined, additionalInfo?: Record<string, any>) {
    console.log(`🚀 [${jobId || 'unknown'}] Starting ${this.modelName} call:`, {
      model: this.modelName,
      timestamp: new Date().toISOString(),
      ...additionalInfo
    });
  }

  protected logSuccess(jobId: string | undefined, response: AIModelResponse) {
    console.log(`✅ [${jobId || 'unknown'}] ${this.modelName} response received:`, {
      model: this.modelName,
      contentLength: response.content.length,
      duration: `${response.duration}ms`,
      usage: response.usage,
      hasContent: !!response.content
    });
  }

  protected logError(jobId: string | undefined, error: any) {
    console.error(`🚨 [${jobId || 'unknown'}] ${this.modelName} error:`, {
      model: this.modelName,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack?.split('\n').slice(0, 3)
    });
  }

  protected formatPromptWithSearch(prompt: string, useWebSearch: boolean): string {
    if (!useWebSearch) return prompt;
    
    return `${prompt}\n\nIMPORTANT: Voor deze analyse heb je toegang tot actuele online informatie. Zoek actief naar relevante fiscale regelgeving, jurisprudentie en Belastingdienst publicaties om je antwoord te onderbouwen. Gebruik alleen officiële Nederlandse bronnen zoals belastingdienst.nl, wetten.overheid.nl, en rijksoverheid.nl.`;
  }
}