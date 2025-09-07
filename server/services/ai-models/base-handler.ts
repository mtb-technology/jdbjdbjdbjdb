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

  // Helper method to normalize response content across different model formats
  protected normalizeResponseContent(
    rawResponse: any, 
    modelType: string, 
    jobId?: string
  ): string {
    let content = "";
    
    // Try different response formats based on model type
    if (modelType === "deep-research") {
      // Deep Research format: output array with message/reasoning items
      if (rawResponse?.output && Array.isArray(rawResponse.output)) {
        for (const item of rawResponse.output.reverse()) {
          if (item?.type === 'message' && item?.content) {
            if (Array.isArray(item.content)) {
              const textContent = item.content.find((c: any) => c?.text);
              if (textContent?.text) {
                content = textContent.text;
                break;
              }
            } else if (typeof item.content === 'string') {
              content = item.content;
              break;
            }
          }
        }
      }
      // Fallback to output_text for Deep Research
      if (!content && rawResponse?.output_text) {
        content = rawResponse.output_text;
      }
    } else if (modelType === "gpt5") {
      // GPT-5 format: direct output_text field
      content = rawResponse?.output_text || "";
      
      // Alternative GPT-5 format with output array
      if (!content && rawResponse?.output && Array.isArray(rawResponse.output)) {
        const lastItem = rawResponse.output[rawResponse.output.length - 1];
        if (lastItem?.text) content = lastItem.text;
      }
    } else if (modelType === "openai-standard" || modelType === "openai-reasoning") {
      // Standard OpenAI format: choices array
      content = rawResponse?.choices?.[0]?.message?.content || "";
    } else if (modelType === "google") {
      // Google Gemini format: candidates array
      content = rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text || 
                rawResponse?.text || "";
    }
    
    // Generic fallbacks for any model type
    if (!content) {
      // Try direct content field
      content = rawResponse?.content || "";
      
      // Try result field (some models use this)
      if (!content) content = rawResponse?.result || "";
      
      // Try text field
      if (!content) content = rawResponse?.text || "";
    }
    
    // Log normalization result
    if (jobId) {
      if (content) {
        console.log(`✅ [${jobId}] Normalized ${modelType} response: ${content.length} chars`);
      } else {
        console.warn(`⚠️ [${jobId}] Failed to normalize ${modelType} response`);
      }
    }
    
    return content;
  }

  // Helper to detect if response is incomplete
  protected isIncompleteResponse(rawResponse: any): boolean {
    return rawResponse?.status === 'incomplete' ||
           rawResponse?.finish_reason === 'length' ||
           rawResponse?.finish_reason === 'max_tokens' ||
           rawResponse?.incomplete_details?.reason === 'max_output_tokens';
  }
}