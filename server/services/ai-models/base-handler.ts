import type { AiConfig } from "@shared/schema";
import { AIError } from "@shared/errors";
import { AIMonitoringService, RequestMetrics } from "./monitoring";
import { TIMEOUTS, RETRY, CIRCUIT_BREAKER } from "../../config/constants";

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
  timeout?: number; // Timeout in milliseconds
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime?: number;
  state: 'closed' | 'open' | 'half-open';
  successCount?: number;
}

export abstract class BaseAIHandler {
  protected modelName: string;
  protected apiKey: string | undefined;
  protected maxRetries: number = RETRY.MAX_ATTEMPTS;
  protected baseRetryDelay: number = RETRY.BASE_DELAY_MS;
  protected defaultTimeout: number = TIMEOUTS.AI_REQUEST;

  // Circuit breaker properties
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    state: 'closed'
  };
  private readonly failureThreshold: number = CIRCUIT_BREAKER.FAILURE_THRESHOLD;
  private readonly recoveryTimeout: number = CIRCUIT_BREAKER.RECOVERY_TIMEOUT_MS;
  private readonly halfOpenMaxRequests: number = CIRCUIT_BREAKER.HALF_OPEN_MAX_REQUESTS;

  constructor(modelName: string, apiKey?: string) {
    this.modelName = modelName;
    this.apiKey = apiKey;
  }

  // Get monitoring service instance
  protected get monitoring(): AIMonitoringService {
    return AIMonitoringService.getInstance();
  }

  // Abstract methods that each handler must implement
  abstract callInternal(prompt: string, config: AiConfig, options?: AIModelParameters & { signal?: AbortSignal }): Promise<AIModelResponse>;
  abstract validateParameters(config: AiConfig): void;
  abstract getSupportedParameters(): string[];

  // Main call method with retry logic
  async call(prompt: string, config: AiConfig, options?: AIModelParameters): Promise<AIModelResponse> {
    const jobId = options?.jobId;
    const startTime = Date.now();
    const modelKey = `${config.provider}-${config.model}`;
    
    this.validateInput(prompt, config, options);
    
    // Check circuit breaker state
    this.checkCircuitBreaker(modelKey);
    
    let lastError: Error | undefined;
    let callFailed = false;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.callWithTimeout(prompt, config, options);
        this.validateResponse(response);
        
        // Success - reset circuit breaker and record metrics
        this.onSuccess(modelKey);
        this.recordRequestMetrics(prompt, config, response, startTime, true, jobId);
        return response;
      } catch (error: any) {
        lastError = error;
        
        // If this is the last attempt, don't retry
        if (attempt === this.maxRetries) {
          callFailed = true;
          this.logError(jobId, error);
          this.recordRequestMetrics(prompt, config, undefined, startTime, false, jobId, error);
          break;
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
        
        // Non-retryable error, record metrics and throw immediately
        callFailed = true;
        this.logError(jobId, error);
        this.recordRequestMetrics(prompt, config, undefined, startTime, false, jobId, error);
        break;
      }
    }
    
    // Record failure for circuit breaker only once per overall failed call
    if (callFailed) {
      this.onFailure(modelKey);
    }
    
    throw this.enhanceError(lastError || new Error('Unknown error occurred during API call'));
  }

  // Call with unified timeout handling
  private async callWithTimeout(prompt: string, config: AiConfig, options?: AIModelParameters): Promise<AIModelResponse> {
    const timeout = options?.timeout || this.defaultTimeout;
    const controller = new AbortController();
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);
    
    try {
      const response = await this.callInternal(prompt, config, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (controller.signal.aborted) {
        throw AIError.timeout(this.modelName, timeout);
      }
      
      throw error;
    }
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
    const delaySeconds = Math.round(delay / 1000);
    const delayMinutes = Math.round(delay / 60000);
    const humanDelay = delayMinutes >= 1 ? `${delayMinutes}min` : `${delaySeconds}s`;

    const isRateLimit = errorMessage.toLowerCase().includes('rate limit') ||
                       errorMessage.toLowerCase().includes('quota');

    if (isRateLimit) {
      console.warn(`⏳ [${jobId || 'unknown'}] ${this.modelName} RATE LIMIT - Retry ${attempt}/${maxRetries} in ${humanDelay}:`, {
        model: this.modelName,
        attempt,
        maxRetries,
        delayMs: delay,
        humanReadableDelay: humanDelay,
        errorMessage,
        timestamp: new Date().toISOString(),
        suggestion: 'Rate limits may require 5-10 minutes to reset. Consider using a different model or waiting longer.'
      });
    } else {
      console.warn(`🔄 [${jobId || 'unknown'}] ${this.modelName} retry ${attempt}/${maxRetries} in ${humanDelay}:`, {
        model: this.modelName,
        attempt,
        maxRetries,
        delayMs: delay,
        errorMessage,
        timestamp: new Date().toISOString()
      });
    }
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
    } else if (modelType === "gpt4o") {
      // GPT-4o format: direct output_text field (legacy support)
      content = rawResponse?.output_text || "";

      // Alternative GPT-4o format with output array
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

  // Input validation with proper config merging
  protected validateInput(prompt: string, config: AiConfig, options?: AIModelParameters): void {
    this.validatePrompt(prompt);
    this.validateOptions(options);
    
    // Create effective config by merging options overrides
    const effectiveConfig = this.mergeConfigWithOptions(config, options);
    this.validateConfig(effectiveConfig);
    this.validateParameters(effectiveConfig);
  }

  // Merge config with options, giving precedence to options
  protected mergeConfigWithOptions(config: AiConfig, options?: AIModelParameters): AiConfig {
    if (!options) return config;
    
    return {
      ...config,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.topP !== undefined && { topP: options.topP }),
      ...(options.topK !== undefined && { topK: options.topK }),
      ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
      ...(options.reasoning !== undefined && { reasoning: options.reasoning }),
      ...(options.verbosity !== undefined && { verbosity: options.verbosity }),
    };
  }

  // Validate options parameter
  protected validateOptions(options?: AIModelParameters): void {
    if (!options) return;

    if (typeof options !== 'object') {
      throw new AIError('Options must be an object', 'INVALID_INPUT' as any, false);
    }

    // Validate boolean parameters
    if (options.useWebSearch !== undefined && typeof options.useWebSearch !== 'boolean') {
      throw AIError.invalidInput('useWebSearch must be a boolean');
    }

    if (options.useGrounding !== undefined && typeof options.useGrounding !== 'boolean') {
      throw AIError.invalidInput('useGrounding must be a boolean');
    }

    // Validate jobId if present
    if (options.jobId !== undefined) {
      if (typeof options.jobId !== 'string' || options.jobId.trim() === '') {
        throw AIError.invalidInput('jobId must be a non-empty string');
      }
      if (options.jobId.length > 100) {
        throw AIError.invalidInput('jobId must be less than 100 characters');
      }
    }

    // Validate model-specific parameters (these will override config values)
    this.validateNumericParameter('temperature', options.temperature, 0, 2);
    this.validateNumericParameter('topP', options.topP, 0, 1);
    this.validateNumericParameter('topK', options.topK, 1, 100);
    this.validateNumericParameter('maxOutputTokens', options.maxOutputTokens, 1, 100000);

    // Validate reasoning parameter in options
    if (options.reasoning !== undefined) {
      if (typeof options.reasoning !== 'object' || options.reasoning === null) {
        throw AIError.invalidInput('Reasoning parameter must be an object');
      }
      if (options.reasoning.effort !== undefined) {
        const validEfforts = ['minimal', 'low', 'medium', 'high'];
        if (!validEfforts.includes(options.reasoning.effort)) {
          throw AIError.invalidInput(`Invalid reasoning effort: ${options.reasoning.effort}. Valid values: ${validEfforts.join(', ')}`);
        }
      }
    }

    // Validate verbosity parameter in options
    if (options.verbosity !== undefined) {
      const validVerbosity = ['low', 'medium', 'high'];
      if (!validVerbosity.includes(options.verbosity)) {
        throw AIError.invalidInput(`Invalid verbosity: ${options.verbosity}. Valid values: ${validVerbosity.join(', ')}`);
      }
    }
  }

  // Comprehensive prompt validation and sanitization
  protected validatePrompt(prompt: string): void {
    if (!prompt || typeof prompt !== 'string') {
      throw AIError.invalidInput('Prompt must be a non-empty string');
    }

    if (prompt.trim() === '') {
      throw AIError.invalidInput('Prompt cannot be empty or only whitespace');
    }

    if (prompt.length > 1000000) { // 1MB limit
      throw AIError.invalidInput('Prompt exceeds maximum length (1MB)');
    }

    // Normalize prompt for security checks
    const normalizedPrompt = this.normalizeForSecurityCheck(prompt);

    // Enhanced security patterns with word boundaries and case insensitive matching
    const securityPatterns = [
      { pattern: /\bjavascript\s*:/gi, description: 'JavaScript protocol' },
      { pattern: /\bvbscript\s*:/gi, description: 'VBScript protocol' },
      { pattern: /\bdata\s*:\s*text\/html/gi, description: 'Data URL with HTML' },
      { pattern: /<\s*script\b[^>]*>/gi, description: 'Script tags' },
      { pattern: /<\s*iframe\b[^>]*>/gi, description: 'Iframe tags' },
      { pattern: /<\s*object\b[^>]*>/gi, description: 'Object tags' },
      { pattern: /<\s*embed\b[^>]*>/gi, description: 'Embed tags' },
      { pattern: /\bon\w+\s*=/gi, description: 'Event handlers' },
      { pattern: /expression\s*\(/gi, description: 'CSS expressions' },
    ];

    for (const { pattern, description } of securityPatterns) {
      if (pattern.test(normalizedPrompt)) {
        const promptHash = this.hashString(prompt);
        console.warn(`🚨 Rejected prompt with ${description}. Hash: ${promptHash}, Length: ${prompt.length}`);
        throw AIError.invalidInput(`Prompt contains potentially malicious content (${description})`);
      }
    }

    // Warn about very long single lines (potential issues)
    const lines = prompt.split('\n');
    const maxLineLength = 10000;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > maxLineLength) {
        console.warn(`⚠️ Prompt line ${i + 1} is very long (${lines[i].length} chars). This may cause processing issues.`);
        break;
      }
    }
  }

  // Normalize prompt for security checking
  private normalizeForSecurityCheck(prompt: string): string {
    return prompt
      .normalize('NFKC') // Unicode normalization
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  // Simple hash for logging without exposing content
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  // Circuit breaker methods
  private checkCircuitBreaker(modelKey: string): void {
    if (this.circuitBreaker.state === 'open') {
      const timeSinceLastFailure = Date.now() - (this.circuitBreaker.lastFailureTime || 0);
      
      if (timeSinceLastFailure >= this.recoveryTimeout) {
        // Transition to half-open state
        this.circuitBreaker.state = 'half-open';
        this.circuitBreaker.successCount = 0;
        console.log(`🔄 Circuit breaker for ${this.modelName} transitioning to half-open state`);
        this.monitoring.updateCircuitBreakerState(modelKey, 'half-open');
      } else {
        throw AIError.circuitBreakerOpen(this.modelName, 'Circuit breaker is open');
      }
    }
    
    if (this.circuitBreaker.state === 'half-open' && 
        (this.circuitBreaker.successCount || 0) >= this.halfOpenMaxRequests) {
      throw AIError.circuitBreakerOpen(this.modelName, 'Circuit breaker half-open request limit exceeded');
    }
  }

  private onSuccess(modelKey: string): void {
    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.successCount = (this.circuitBreaker.successCount || 0) + 1;
      
      if (this.circuitBreaker.successCount >= this.halfOpenMaxRequests) {
        // Transition back to closed state
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.lastFailureTime = undefined;
        console.log(`✅ Circuit breaker for ${this.modelName} closed - service recovered`);
        this.monitoring.updateCircuitBreakerState(modelKey, 'closed');
      }
    } else if (this.circuitBreaker.state === 'closed') {
      // Reset failure count on success
      this.circuitBreaker.failures = 0;
    }
  }

  private onFailure(modelKey: string): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    // Handle half-open state failure - immediately transition back to open
    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.successCount = 0;
      console.error(`🚨 Circuit breaker for ${this.modelName} failed during half-open - reopening`);
      this.monitoring.updateCircuitBreakerState(modelKey, 'open');
    }
    // Handle closed state failure - open after threshold
    else if (this.circuitBreaker.failures >= this.failureThreshold && this.circuitBreaker.state === 'closed') {
      this.circuitBreaker.state = 'open';
      console.error(`🚨 Circuit breaker for ${this.modelName} opened after ${this.circuitBreaker.failures} failures`);
      this.monitoring.updateCircuitBreakerState(modelKey, 'open');
    }
  }

  // Get circuit breaker status (for monitoring)
  public getCircuitBreakerStatus(): { state: string; failures: number; lastFailureTime?: number } {
    return {
      state: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      lastFailureTime: this.circuitBreaker.lastFailureTime
    };
  }

  // Record request metrics
  protected recordRequestMetrics(
    prompt: string,
    config: AiConfig,
    response: AIModelResponse | undefined,
    startTime: number,
    success: boolean,
    jobId?: string,
    error?: Error
  ): void {
    const metrics: RequestMetrics = {
      model: config.model,
      provider: config.provider,
      duration: response?.duration || (Date.now() - startTime),
      success,
      errorType: error instanceof AIError ? error.errorCode : error?.name,
      promptLength: prompt.length,
      responseLength: response?.content?.length || 0,
      tokensUsed: response?.usage?.tokens || response?.usage?.total_tokens,
      timestamp: Date.now(),
      jobId
    };

    this.monitoring.recordRequest(metrics);
  }


  // Validate configuration object
  protected validateConfig(config: AiConfig): void {
    if (!config || typeof config !== 'object') {
      throw AIError.invalidInput('Configuration must be a valid object');
    }

    if (!config.model || typeof config.model !== 'string') {
      throw AIError.invalidInput('Model name is required and must be a string');
    }

    if (!config.provider || typeof config.provider !== 'string') {
      throw AIError.invalidInput('Provider is required and must be a string');
    }

    // Validate provider is one of the supported values
    const supportedProviders = ['google', 'openai'];
    if (!supportedProviders.includes(config.provider)) {
      throw AIError.invalidInput(`Unsupported provider: ${config.provider}. Supported providers: ${supportedProviders.join(', ')}`);
    }

    // Validate numeric parameters if present
    this.validateNumericParameter('temperature', config.temperature, 0, 2);
    this.validateNumericParameter('topP', config.topP, 0, 1);
    this.validateNumericParameter('topK', config.topK, 1, 100);
    this.validateNumericParameter('maxOutputTokens', config.maxOutputTokens, 1, 100000);

    // Validate reasoning parameter
    if (config.reasoning !== undefined) {
      if (typeof config.reasoning !== 'object' || config.reasoning === null) {
        throw AIError.invalidInput('Reasoning parameter must be an object');
      }
      if (config.reasoning.effort !== undefined) {
        const validEfforts = ['minimal', 'low', 'medium', 'high'];
        if (!validEfforts.includes(config.reasoning.effort)) {
          throw AIError.invalidInput(`Invalid reasoning effort: ${config.reasoning.effort}. Valid values: ${validEfforts.join(', ')}`);
        }
      }
    }

    // Validate verbosity parameter
    if (config.verbosity !== undefined) {
      const validVerbosity = ['low', 'medium', 'high'];
      if (!validVerbosity.includes(config.verbosity)) {
        throw AIError.invalidInput(`Invalid verbosity: ${config.verbosity}. Valid values: ${validVerbosity.join(', ')}`);
      }
    }
  }

  // Helper to validate numeric parameters
  private validateNumericParameter(name: string, value: number | undefined, min: number, max: number): void {
    if (value === undefined) return;
    
    if (typeof value !== 'number' || isNaN(value)) {
      throw AIError.invalidInput(`${name} must be a valid number`);
    }

    if (value < min || value > max) {
      throw AIError.invalidInput(`${name} must be between ${min} and ${max}, got ${value}`);
    }
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