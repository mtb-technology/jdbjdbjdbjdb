import OpenAI from "openai";
import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import type { AiConfig } from "@shared/schema";

export class OpenAIStandardHandler extends BaseAIHandler {
  private client: OpenAI;

  constructor(apiKey: string) {
    super("OpenAI Standard", apiKey);
    this.client = new OpenAI({ apiKey });
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
      promptLength: finalPrompt.length,
      temperature: config.temperature,
      topP: config.topP,
      maxOutputTokens: config.maxOutputTokens
    });

    try {
      const chatConfig: any = {
        model: config.model,
        messages: [{ role: "user", content: finalPrompt }],
        temperature: config.temperature,
        top_p: config.topP,
        max_tokens: config.maxOutputTokens,
      };

      // Add optional OpenAI-specific parameters
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
        throw new Error(`Lege response van ${config.model}`);
      }

      const result: AIModelResponse = {
        content,
        duration,
        usage: response.usage,
        metadata: {
          model: config.model,
          finishReason: response.choices[0]?.finish_reason
        }
      };

      this.logSuccess(jobId, result);
      return result;

    } catch (error: any) {
      this.logError(jobId, error);
      throw new Error(`OpenAI Standard API fout: ${error.message}`);
    }
  }

  validateParameters(config: AiConfig): void {
    // Standard OpenAI models support all standard parameters
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw new Error(`Temperature moet tussen 0 en 2 zijn voor OpenAI`);
    }
    if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
      throw new Error(`TopP moet tussen 0 en 1 zijn voor OpenAI`);
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens < 1) {
      throw new Error(`MaxOutputTokens moet groter dan 0 zijn voor OpenAI`);
    }
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'maxOutputTokens', 'reasoning', 'verbosity'];
  }
}