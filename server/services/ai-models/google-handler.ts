import { GoogleGenAI } from "@google/genai";
import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import type { AiConfig } from "@shared/schema";

export class GoogleAIHandler extends BaseAIHandler {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    super("Google AI", apiKey);
    this.client = new GoogleGenAI({ apiKey });
  }

  async call(
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters & { jobId?: string }
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
        throw new Error(`Lege response van Google AI (${finishReason || 'unknown reason'})`);
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
      this.logError(jobId, error);
      throw new Error(`Google AI API fout: ${error.message}`);
    }
  }

  validateParameters(config: AiConfig): void {
    // Google AI supports all standard parameters
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw new Error(`Temperature moet tussen 0 en 2 zijn voor Google AI`);
    }
    if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
      throw new Error(`TopP moet tussen 0 en 1 zijn voor Google AI`);
    }
    if (config.topK !== undefined && (config.topK < 1 || config.topK > 40)) {
      throw new Error(`TopK moet tussen 1 en 40 zijn voor Google AI`);
    }
    if (config.maxOutputTokens !== undefined && (config.maxOutputTokens < 100 || config.maxOutputTokens > 32768)) {
      throw new Error(`MaxOutputTokens moet tussen 100 en 32768 zijn voor Google AI`);
    }
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useGrounding'];
  }
}