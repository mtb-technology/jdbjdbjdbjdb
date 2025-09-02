import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import type { AiConfig } from "@shared/schema";

export class OpenAIGPT5Handler extends BaseAIHandler {
  constructor(apiKey: string) {
    super("OpenAI GPT-5", apiKey);
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
      model: "gpt-5",
      promptLength: finalPrompt.length,
      maxOutputTokens: config.maxOutputTokens || 32000,
      reasoning: config.reasoning,
      verbosity: config.verbosity,
      useWebSearch: options?.useWebSearch,
      note: "GPT-5 uses Responses API and doesn't support temperature"
    });

    try {
      const requestConfig: any = {
        model: "gpt-5",
        input: finalPrompt,  // GPT-5 accepts direct string input
        max_output_tokens: config.maxOutputTokens || 32000  // Higher default for complex reports
      };

      // GPT-5 doesn't support temperature but supports reasoning and verbosity
      if (config.reasoning?.effort) {
        requestConfig.reasoning = { effort: config.reasoning.effort };
      }
      if (config.verbosity) {
        requestConfig.verbosity = config.verbosity;
      }

      // Add web search tool if requested
      if (options?.useWebSearch) {
        requestConfig.tools = [{ type: "web_search" }];
      }

      // Make direct API call to /v1/responses endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestConfig),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Could not read error response');
        throw new Error(`GPT-5 API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      const duration = Date.now() - startTime;

      // Extract content from GPT-5 Responses API format
      let content = "";
      
      // Try different extraction methods based on the response structure
      if (result?.output_text && typeof result.output_text === 'string') {
        content = result.output_text;
      } else if (result?.output && Array.isArray(result.output) && result.output.length > 0) {
        // Look for the message type in output array
        const messageOutput = result.output.find((item: any) => item?.type === 'message') || 
                            result.output[result.output.length - 1];
        
        if (Array.isArray(messageOutput?.content) && messageOutput.content.length > 0) {
          const firstContent = messageOutput.content[0];
          if (firstContent?.text) {
            content = firstContent.text;
          } else if (typeof firstContent === 'string') {
            content = firstContent;
          }
        } else if (typeof messageOutput?.content === 'string') {
          content = messageOutput.content;
        } else if (messageOutput?.text) {
          content = messageOutput.text;
        }
      }

      if (!content) {
        // Log full structure for debugging
        console.error(`[${jobId}] GPT-5 response structure:`, JSON.stringify(result).substring(0, 500));
        
        if (result?.status === 'incomplete') {
          const reason = result?.incomplete_details?.reason || 'unknown';
          throw new Error(`Incomplete GPT-5 response: ${reason}. Try increasing max_output_tokens.`);
        }
        
        throw new Error(`Empty response from GPT-5 - no usable content found`);
      }

      const apiResponse: AIModelResponse = {
        content,
        duration,
        usage: result.usage,
        metadata: {
          model: "gpt-5",
          status: result.status,
          incompleteDetails: result.incomplete_details
        }
      };

      this.logSuccess(jobId, apiResponse);
      return apiResponse;

    } catch (error: any) {
      this.logError(jobId, error);
      
      if (error.name === 'AbortError') {
        throw new Error(`GPT-5 timed out after 5 minutes`);
      }
      
      throw new Error(`GPT-5 API fout: ${error.message}`);
    }
  }

  validateParameters(config: AiConfig): void {
    // GPT-5 doesn't support temperature or topP
    if (config.temperature !== undefined && config.temperature !== 1) {
      console.warn(`⚠️ Temperature wordt genegeerd voor GPT-5`);
    }
    if (config.topP !== undefined && config.topP !== 1) {
      console.warn(`⚠️ TopP wordt genegeerd voor GPT-5`);
    }
    if (config.topK !== undefined) {
      console.warn(`⚠️ TopK wordt genegeerd voor GPT-5 (alleen voor Google AI)`);
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens < 100) {
      throw new Error(`MaxOutputTokens moet minstens 100 zijn voor GPT-5`);
    }
  }

  getSupportedParameters(): string[] {
    return ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'];
  }
}