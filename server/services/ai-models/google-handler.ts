import { GoogleGenAI } from "@google/genai";
import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import { AIError, ERROR_CODES } from "@shared/errors";
import type { AiConfig } from "@shared/schema";

export class GoogleAIHandler extends BaseAIHandler {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    super("Google AI", apiKey);
    this.client = new GoogleGenAI({ apiKey });
  }

  async callInternal(
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters & { signal?: AbortSignal }
  ): Promise<AIModelResponse> {
    const startTime = Date.now();
    const jobId = options?.jobId;

    this.validateParameters(config);
    
    const finalPrompt = this.formatPromptWithSearch(prompt, options?.useWebSearch || false);
    
    this.logStart(jobId, {
      model: config.model,
      useGrounding: options?.useGrounding,
      promptLength: finalPrompt.length,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      maxOutputTokens: config.maxOutputTokens
    });

    try {
      // Note: Google AI SDK doesn't support AbortSignal directly
      // Timeout cancellation is handled by the base class timeout mechanism
      const response = await this.client.models.generateContent({
        model: config.model,
        contents: finalPrompt,
        config: {
          temperature: config.temperature,
          topP: config.topP,
          topK: config.topK,
          maxOutputTokens: config.maxOutputTokens,
        }
      });

      const duration = Date.now() - startTime;
      const content = response.candidates?.[0]?.content?.parts?.[0]?.text || 
                     response.text || "";
      
      const finishReason = response.candidates?.[0]?.finishReason;
      
      // Handle MAX_TOKENS - partial content may still be useful
      if (finishReason === 'MAX_TOKENS' && content && content.trim().length > 10) {
        console.warn(`[${jobId}] Google AI hit token limit, but returning partial content`);
      } else if (!content || content.trim() === '') {
        throw AIError.invalidResponse('Google AI', `Empty response (${finishReason || 'unknown reason'})`);
      }

      const result: AIModelResponse = {
        content,
        duration,
        usage: response.usageMetadata,
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

      // Enhanced rate limit detection for Google API
      const errorMessage = error.message || error.toString() || '';
      const is429Error = error.status === 429;
      const isRateLimitMessage = errorMessage.toLowerCase().includes('rate limit') ||
                                 errorMessage.toLowerCase().includes('quota') ||
                                 errorMessage.toLowerCase().includes('resource_exhausted');

      if (is429Error || isRateLimitMessage) {
        console.error(`🚨 [${jobId}] Google API Rate Limit Detected:`, {
          status: error.status,
          message: errorMessage.substring(0, 200),
          model: config.model,
          recommendation: 'Wait 5-10 minutes before retrying. Rate limits indicate API quota exhaustion.'
        });

        // Rate limits are NOT retryable - fail immediately with clear error
        throw new AIError(
          `Rate limit exceeded for Google AI`,
          ERROR_CODES.AI_RATE_LIMITED,
          false, // NOT retryable - fail fast
          undefined,
          {
            statusCode: error.status,
            responseText: errorMessage,
            provider: 'Google AI',
            model: config.model,
            suggestedWaitTime: '5-10 minutes'
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
      // ✅ AUTO-CAP: Gemini 2.5 Pro has hard limit of 65,535. If user requests more, cap with warning
      if (config.maxOutputTokens > 65535) {
        console.warn(`⚠️ [GoogleAI] maxOutputTokens ${config.maxOutputTokens} exceeds Gemini 2.5 Pro limit. Auto-capping to 65,535`);
        config.maxOutputTokens = 65535;
      }
    }
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'];
  }
}