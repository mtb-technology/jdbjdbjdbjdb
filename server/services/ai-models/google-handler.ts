import { GoogleGenAI } from "@google/genai";
import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import { AIError, ERROR_CODES } from "@shared/errors";
import type { AiConfig } from "@shared/schema";
import { ResearchOrchestrator } from "../research/research-orchestrator";
import { logger } from "../logger";

export class GoogleAIHandler extends BaseAIHandler {
  private client: GoogleGenAI;
  private orchestrator?: ResearchOrchestrator;
  private handlerApiKey: string;
  private skipDeepResearch: boolean; // Prevent circular dependency

  constructor(apiKey: string, skipDeepResearch: boolean = false) {
    super("Google AI", apiKey);
    this.handlerApiKey = apiKey;
    this.skipDeepResearch = skipDeepResearch;
    // Use v1alpha API for Gemini 3 support
    // Set timeout to 15 minutes for grounding/long operations
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: 'v1alpha',
        timeout: 900000  // 15 minutes in milliseconds
      }
    });
    // Orchestrator is created lazily when deep research is actually used
    // This avoids unnecessary initialization and misleading log messages
  }

  async callInternal(
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters & { signal?: AbortSignal; visionAttachments?: Array<{ mimeType: string; data: string; filename: string }>; responseFormat?: 'json' | 'text'; systemInstruction?: string }
  ): Promise<AIModelResponse> {
    const startTime = Date.now();
    const jobId = options?.jobId;

    // DEBUG: Log incoming config to verify deep research flag
    logger.debug(jobId || 'google-handler', 'GoogleAIHandler received config', {
      model: config.model,
      useDeepResearch: (config as any).useDeepResearch,
      skipDeepResearch: this.skipDeepResearch,
      willUseDeepResearch: !this.skipDeepResearch && (config as any).useDeepResearch,
      hasVisionAttachments: options?.visionAttachments?.length || 0
    });

    // Check if deep research is requested (and not skipped)
    if (!this.skipDeepResearch && (config as any).useDeepResearch) {
      return this.executeDeepResearch(prompt, config, options);
    }

    this.validateParameters(config);

    const finalPrompt = this.formatPromptWithSearch(prompt, options?.useWebSearch || false);

    this.logStart(jobId, {
      model: config.model,
      useGrounding: options?.useGrounding,
      promptLength: finalPrompt.length,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      maxOutputTokens: config.maxOutputTokens,
      thinkingLevel: config.thinkingLevel,
      visionAttachments: options?.visionAttachments?.length || 0
    });

    try {
      // Note: Google AI SDK doesn't support AbortSignal directly
      // Timeout cancellation is handled by the base class timeout mechanism

      // Build generation config
      const generationConfig: any = {
        temperature: config.temperature,
        topP: config.topP,
        topK: config.topK,
        maxOutputTokens: config.maxOutputTokens,
      };

      // Add JSON response format if requested - forces model to output valid JSON
      if (options?.responseFormat === 'json') {
        generationConfig.responseMimeType = 'application/json';
        logger.debug(jobId || 'google-handler', 'JSON response mode enabled (responseMimeType: application/json)');
      }

      // Add thinking_config for Gemini 3 models (as per API docs)
      if (config.thinkingLevel) {
        generationConfig.thinking_config = {
          thinking_level: config.thinkingLevel
        };
      }

      // Add Google Search grounding if enabled
      let tools: any[] | undefined;
      if (options?.useGrounding) {
        tools = [{
          googleSearch: {} // Modern approach for all current models including Gemini 3
        }];
        logger.debug(jobId || 'google-handler', 'Google Search grounding enabled');
      }

      // Google AI SDK requires "models/" prefix for model names
      const modelName = config.model.startsWith('models/')
        ? config.model
        : `models/${config.model}`;

      // Build content parts - support multimodal (text + PDFs/images)
      let contentParts: any[] | string;

      if (options?.visionAttachments && options.visionAttachments.length > 0) {
        // Multimodal request: include PDFs/images as inline data
        logger.info(jobId || 'google-handler', `Adding ${options.visionAttachments.length} vision attachment(s) to request`);

        contentParts = [
          // Text prompt first
          { text: finalPrompt },
          // Then all attachments as inline data
          ...options.visionAttachments.map(att => ({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data // base64 encoded
            }
          }))
        ];

        // Log what we're sending
        options.visionAttachments.forEach(att => {
          logger.debug(jobId || 'google-handler', `Attachment: ${att.filename}`, { mimeType: att.mimeType, sizeKB: Math.round(att.data.length / 1024) });
        });
      } else {
        // Text-only request
        contentParts = finalPrompt;
      }

      const requestConfig: any = {
        model: modelName,
        contents: contentParts,
        config: generationConfig
      };

      // Add system instruction if provided
      if (options?.systemInstruction) {
        requestConfig.config.systemInstruction = options.systemInstruction;
        logger.debug(jobId || 'google-handler', 'System instruction added', { length: options.systemInstruction.length });
      }

      // Add tools if grounding is enabled
      if (tools) {
        requestConfig.config.tools = tools;
      }

      const response = await this.client.models.generateContent(requestConfig);

      const duration = Date.now() - startTime;
      const content = response.candidates?.[0]?.content?.parts?.[0]?.text || 
                     response.text || "";
      
      const finishReason = response.candidates?.[0]?.finishReason;
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

      // Handle MAX_TOKENS - partial content may still be useful
      if (finishReason === 'MAX_TOKENS' && content && content.trim().length > 10) {
        logger.warn(jobId || 'google-handler', 'Google AI hit token limit, but returning partial content');
      } else if (!content || content.trim() === '') {
        throw AIError.invalidResponse(`Google AI returned empty response (${finishReason || 'unknown reason'})`, { finishReason, model: config.model });
      }

      // Log grounding sources if available
      if (groundingMetadata?.groundingChunks && groundingMetadata.groundingChunks.length > 0) {
        logger.info(jobId || 'google-handler', `Grounding found ${groundingMetadata.groundingChunks.length} sources`);
      }

      const result: AIModelResponse = {
        content,
        duration,
        usage: response.usageMetadata,
        groundingMetadata, // Pass through grounding data for source extraction
        metadata: {
          finishReason,
          model: config.model
        }
      };

      this.logSuccess(jobId, result);
      return result;

    } catch (error: any) {
      if (error instanceof AIError) {
        throw error;
      }

      // ✅ LOG FULL ERROR DETAILS for debugging
      logger.error(jobId || 'google-handler', 'Google AI call failed', {
        errorType: error.constructor?.name,
        message: error.message,
        status: error.status,
        code: error.code,
        details: error.details
      }, error instanceof Error ? error : undefined);

      // Enhanced rate limit detection for Google API
      const errorMessage = error.message || error.toString() || '';
      const is429Error = error.status === 429;
      const isRateLimitMessage = errorMessage.toLowerCase().includes('rate limit') ||
                                 errorMessage.toLowerCase().includes('quota') ||
                                 errorMessage.toLowerCase().includes('resource_exhausted');

      if (is429Error || isRateLimitMessage) {
        logger.error(jobId || 'google-handler', 'Google API Rate Limit Detected', {
          status: error.status,
          message: errorMessage.substring(0, 200),
          model: config.model,
          recommendation: 'Wait 5-10 minutes before retrying. Rate limits indicate API quota exhaustion.'
        });

        // Rate limits are NOT retryable - fail immediately with clear error
        throw new AIError(
          `Rate limit exceeded for Google AI`,
          ERROR_CODES.AI_RATE_LIMITED,
          error.status || 429,
          {
            isRetryable: false, // NOT retryable - fail fast
            details: {
              statusCode: error.status,
              responseText: errorMessage,
              provider: 'Google AI',
              model: config.model,
              suggestedWaitTime: '5-10 minutes'
            }
          }
        );
      }

      // Convert HTTP errors
      if (error.status) {
        throw AIError.fromHttpError(error.status, error.message, 'Google AI');
      }

      // Convert network errors
      if (error.code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) {
        throw AIError.networkError('Google AI', error);
      }

      throw new AIError(error.message || 'Unknown Google AI error', 'EXTERNAL_API_ERROR' as any);
    }
  }

  validateParameters(config: AiConfig): void {
    // Google AI supports all standard parameters
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw AIError.validationFailed(`Temperature must be between 0 and 2 for Google AI, got ${config.temperature}`);
    }
    if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
      throw AIError.validationFailed(`TopP must be between 0 and 1 for Google AI, got ${config.topP}`);
    }
    if (config.topK !== undefined && (config.topK < 1 || config.topK > 40)) {
      throw AIError.validationFailed(`TopK must be between 1 and 40 for Google AI, got ${config.topK}`);
    }
    if (config.maxOutputTokens !== undefined) {
      if (config.maxOutputTokens < 100) {
        throw AIError.validationFailed(`MaxOutputTokens must be at least 100 for Google AI, got ${config.maxOutputTokens}`);
      }
      // Gemini models have different output limits:
      // - Gemini 2.5 Pro/Flash: 65,535 tokens
      // - Gemini 3 Pro/Flash: 65,536 tokens (64K)
      // Auto-cap to 65535 for compatibility with all models
      const MAX_OUTPUT_TOKENS = 65535;
      if (config.maxOutputTokens > MAX_OUTPUT_TOKENS) {
        logger.debug('google-handler', `maxOutputTokens ${config.maxOutputTokens} exceeds limit, capping to ${MAX_OUTPUT_TOKENS}`);
        config.maxOutputTokens = MAX_OUTPUT_TOKENS;
      }
    }
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding', 'thinkingLevel', 'useDeepResearch', 'maxQuestions', 'parallelExecutors', 'polishPrompt'];
  }

  /**
   * Execute deep research using GPT Researcher pattern
   * Routes to ResearchOrchestrator for multi-agent workflow
   */
  private async executeDeepResearch(
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters & { signal?: AbortSignal }
  ): Promise<AIModelResponse> {
    const startTime = Date.now();
    const jobId = options?.jobId;

    logger.info(jobId || 'deep-research', 'Deep Research Mode activated');

    // Extract research configuration
    const researchConfig = {
      maxQuestions: (config as any).maxQuestions || 5,
      parallelExecutors: (config as any).parallelExecutors || 3,
      useGrounding: true, // Always use grounding for deep research
      thinkingLevel: (config as any).thinkingLevel || 'high',
      temperature: config.temperature || 1.0,
      maxOutputTokens: config.maxOutputTokens || 32768,
      timeout: 1800000, // 30 minutes
      polishPrompt: (config as any).polishPrompt, // Pass through polish instructions from stage config
      reportDepth: options?.reportDepth || 'balanced',
      reportLanguage: options?.reportLanguage || 'nl' // Pass through language selection
    };

    logger.info(jobId || 'deep-research', `Using reportDepth: ${researchConfig.reportDepth}, reportLanguage: ${researchConfig.reportLanguage}`);

    // Re-create orchestrator with custom config
    this.orchestrator = new ResearchOrchestrator(this.handlerApiKey, researchConfig);

    // Progress tracking - use provided callback or fallback to logger
    const progressCallback = (progress: any) => {
      if (options?.onProgress) {
        options.onProgress(progress);
      }
      if (jobId) {
        logger.debug(jobId, `Research progress: ${progress.stage} - ${progress.progress}%`);
      }
    };

    try {
      const report = await this.orchestrator.conductDeepResearch(prompt, progressCallback);

      // Format response using the handler's formatter
      const formattedResponse = this.formatDeepResearchReport(report);

      return {
        content: formattedResponse,
        duration: Date.now() - startTime,
        metadata: {
          questionsGenerated: report.metadata.questionsGenerated,
          sourcesConsulted: report.metadata.sourcesConsulted,
          findings: report.findings.length,
          model: report.metadata.model
        }
      };

    } catch (error) {
      logger.error(jobId || 'deep-research', 'Deep research failed', {}, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Format research report for consumption by the application
   * Now returns the final synthesized report directly (no wrapper sections)
   */
  private formatDeepResearchReport(report: any): string {
    // The synthesis now contains the final polished report
    // Just return it directly - it's already properly formatted
    return report.synthesis;
  }
}