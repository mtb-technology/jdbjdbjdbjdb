import type { AiConfig } from "@shared/schema";
import { AIError } from "@shared/errors";

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
  jobId?: string;
}

export abstract class BaseAIHandler {
  protected modelName: string;
  protected apiKey: string | undefined;
  protected maxRetries: number = 3;
  protected baseRetryDelay: number = 1000; // 1 second

  constructor(modelName: string, apiKey?: string) {
    this.modelName = modelName;
    this.apiKey = apiKey;
  }

  // Abstract methods that each handler must implement
  abstract callInternal(prompt: string, config: AiConfig, options?: AIModelParameters): Promise<AIModelResponse>;
  abstract validateParameters(config: AiConfig): void;
  abstract getSupportedParameters(): string[];

  // Main call method with retry logic
  async call(prompt: string, config: AiConfig, options?: AIModelParameters): Promise<AIModelResponse> {
    const jobId = options?.jobId;
    this.validateInput(prompt, config);
    
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.callInternal(prompt, config, options);
        this.validateResponse(response);
        return response;
      } catch (error: any) {
        lastError = error;
        
        // If this is the last attempt, don't retry
        if (attempt === this.maxRetries) {
          this.logError(jobId, error);
          throw this.enhanceError(error);
        }
        
        // Check if error is retryable
        if (error instanceof AIError && error.isRetryable) {
          const delay = error.retryAfter || this.calculateRetryDelay(attempt);
          this.logRetry(jobId, attempt + 1, this.maxRetries, delay, error.message);
          await this.sleep(delay);
          continue;
        }
        
        // For non-AIError, check if it's a potentially retryable network error
        if (this.isRetryableError(error)) {
          const delay = this.calculateRetryDelay(attempt);
          this.logRetry(jobId, attempt + 1, this.maxRetries, delay, error.message);
          await this.sleep(delay);
          continue;
        }
        
        // Non-retryable error, throw immediately
        this.logError(jobId, error);
        throw this.enhanceError(error);
      }
    }
    
    // This should never be reached, but just in case
    throw lastError || new Error('Unknown error occurred during API call');
  }

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
    const errorDetails: any = {
      model: this.modelName,
      errorName: error.name,
      errorMessage: error.message,
      timestamp: new Date().toISOString()
    };

    if (error instanceof AIError) {
      errorDetails.errorCode = error.errorCode;
      errorDetails.isRetryable = error.isRetryable;
      errorDetails.details = error.details;
    }

    // Only include stack trace for unexpected errors (non-AIError)
    if (!(error instanceof AIError)) {
      errorDetails.errorStack = error.stack?.split('\n').slice(0, 3);
    }

    console.error(`🚨 [${jobId || 'unknown'}] ${this.modelName} error:`, errorDetails);
  }

  protected logRetry(jobId: string | undefined, attempt: number, maxRetries: number, delay: number, errorMessage: string) {
    console.warn(`🔄 [${jobId || 'unknown'}] ${this.modelName} retry ${attempt}/${maxRetries} in ${delay}ms:`, {
      model: this.modelName,
      attempt,
      maxRetries,
      delay,
      errorMessage,
      timestamp: new Date().toISOString()
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

  // Input validation
  protected validateInput(prompt: string, config: AiConfig): void {
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      throw AIError.invalidResponse(this.modelName, 'Prompt cannot be empty');
    }

    if (prompt.length > 1000000) { // 1MB limit
      throw AIError.invalidResponse(this.modelName, 'Prompt exceeds maximum length (1MB)');
    }

    this.validateParameters(config);
  }

  // Response validation
  protected validateResponse(response: AIModelResponse): void {
    if (!response) {
      throw AIError.invalidResponse(this.modelName, 'Response is null or undefined');
    }

    if (!response.content || typeof response.content !== 'string') {
      throw AIError.invalidResponse(this.modelName, 'Response content is missing or invalid');
    }

    if (response.content.trim() === '') {
      throw AIError.invalidResponse(this.modelName, 'Response content is empty');
    }

    if (typeof response.duration !== 'number' || response.duration < 0) {
      console.warn(`⚠️ Invalid duration in response: ${response.duration}`);
      response.duration = 0; // Fix invalid duration
    }
  }

  // Error enhancement
  protected enhanceError(error: any): AIError {
    if (error instanceof AIError) {
      return error;
    }

    // Convert common errors to AIError
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return AIError.timeout(this.modelName, 120000);
    }

    // Handle various network error codes
    const networkCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH'];
    if (error.code && networkCodes.includes(error.code)) {
      return AIError.networkError(this.modelName, error);
    }

    // Handle SDK-specific error formats
    if (error.status || error.statusCode || error.response?.status) {
      const statusCode = error.status || error.statusCode || error.response?.status;
      const responseText = this.sanitizeErrorText(error.message || error.response?.data || '');
      return AIError.fromHttpError(statusCode, responseText, this.modelName);
    }

    // Convert validation errors to non-retryable AIError
    if (error.name === 'ValidationError' || error.message?.includes('validation') || error.message?.includes('parameter')) {
      return new AIError(
        error.message || 'Validation error',
        'VALIDATION_FAILED' as any,
        false,
        undefined,
        { originalError: this.sanitizeErrorText(error.message), originalName: error.name }
      );
    }

    // Generic conversion
    return new AIError(
      error.message || 'Unknown error occurred',
      'EXTERNAL_API_ERROR' as any,
      false,
      undefined,
      { originalError: this.sanitizeErrorText(error.message), originalName: error.name }
    );
  }

  // Sanitize error text to prevent sensitive data leaks
  private sanitizeErrorText(text: string): string {
    if (!text || typeof text !== 'string') return '';
    
    // Truncate long error messages
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;
    
    // Remove potential API keys or sensitive patterns
    return truncated
      .replace(/sk-[a-zA-Z0-9]{32,}/g, 'sk-***')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***')
      .replace(/api[_-]?key["\s:=]+[a-zA-Z0-9._-]+/gi, 'api_key: ***');
  }

  // Check if error is retryable
  protected isRetryableError(error: any): boolean {
    // Network errors are generally retryable
    const retryableCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'];
    if (retryableCodes.includes(error.code)) {
      return true;
    }

    // Timeout errors are retryable
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return true;
    }

    return false;
  }

  // Calculate exponential backoff delay
  protected calculateRetryDelay(attempt: number): number {
    const jitter = Math.random() * 0.1 * this.baseRetryDelay; // 10% jitter
    return Math.min(this.baseRetryDelay * Math.pow(2, attempt) + jitter, 60000); // Max 60 seconds
  }

  // Sleep utility
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}