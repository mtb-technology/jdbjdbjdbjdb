import OpenAI from "openai";
import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import { AIError } from "@shared/errors";
import type { AiConfig } from "@shared/schema";

export class OpenAIReasoningHandler extends BaseAIHandler {
  private client: OpenAI;

  constructor(apiKey: string) {
    super("OpenAI Reasoning", apiKey);
    this.client = new OpenAI({ apiKey });
  }

  async callInternal(
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters
  ): Promise<AIModelResponse> {
    const startTime = Date.now();
    const jobId = options?.jobId;

    this.validateParameters(config);
    
    const finalPrompt = this.formatPromptWithSearch(prompt, options?.useWebSearch || false);
    
    this.logStart(jobId, {
      model: config.model,
      promptLength: finalPrompt.length,
      maxOutputTokens: config.maxOutputTokens,
      reasoning: config.reasoning,
      verbosity: config.verbosity,
      note: "Reasoning models don't support temperature/topP"
    });

    try {
      const chatConfig: any = {
        model: config.model,
        messages: [{ role: "user", content: finalPrompt }],
        max_tokens: config.maxOutputTokens,
      };

      // Reasoning models (o3/o3-mini) support reasoning and verbosity but not temperature/topP
      if (config.reasoning?.effort) {
        chatConfig.reasoning = { effort: config.reasoning.effort };
      }
      if (config.verbosity) {
        chatConfig.verbosity = config.verbosity;
      }

      const response = await this.client.chat.completions.create(chatConfig);
      const duration = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "";

      if (!content) {
        throw AIError.invalidResponse('OpenAI Reasoning', `Empty response from ${config.model}`);
      }

      const result: AIModelResponse = {
        content,
        duration,
        usage: response.usage,
        metadata: {
          model: config.model,
          finishReason: response.choices[0]?.finish_reason,
          isReasoningModel: true
        }
      };

      this.logSuccess(jobId, result);
      return result;

    } catch (error: any) {
      if (error instanceof AIError) {
        throw error;
      }
      
      // Convert HTTP errors
      if (error.status) {
        throw AIError.fromHttpError(error.status, error.message, 'OpenAI Reasoning');
      }
      
      // Convert network errors
      if (error.code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) {
        throw AIError.networkError('OpenAI Reasoning', error);
      }
      
      throw new AIError(error.message || 'Unknown OpenAI Reasoning error', 'EXTERNAL_API_ERROR' as any);
    }
  }

  validateParameters(config: AiConfig): void {
    // Reasoning models (o3/o3-mini) don't support temperature or topP
    if (config.temperature !== undefined && config.temperature !== 1) {
      console.warn(`⚠️ Temperature wordt genegeerd voor reasoning model ${config.model}`);
    }
    if (config.topP !== undefined && config.topP !== 1) {
      console.warn(`⚠️ TopP wordt genegeerd voor reasoning model ${config.model}`);
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens < 1) {
      throw new Error(`MaxOutputTokens moet groter dan 0 zijn voor reasoning models`);
    }
  }

  getSupportedParameters(): string[] {
    return ['maxOutputTokens', 'reasoning', 'verbosity'];
  }
}