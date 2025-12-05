import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import { AIError } from "@shared/errors";
import type { AiConfig } from "@shared/schema";

export class OpenAIGPT5Handler extends BaseAIHandler {
  constructor(apiKey: string) {
    super("OpenAI GPT-5", apiKey);
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
        requestConfig.text = { verbosity: config.verbosity };
      }

      // Add web search tool if requested
      if (options?.useWebSearch) {
        requestConfig.tools = [{ type: "web_search" }];
      }

      // Make direct API call to /v1/responses endpoint
      // Use the base class AbortSignal for unified timeout handling
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestConfig),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Could not read error response');
        throw AIError.fromHttpError(response.status, errorText, 'GPT-5');
      }

      const result = await response.json();
      const duration = Date.now() - startTime;

      // Extract content from GPT-5 Responses API format
      let content = "";
      
      // Try different extraction methods based on the response structure
      if (result?.output_text && typeof result.output_text === 'string') {
        content = result.output_text;
      } else if (result?.output && Array.isArray(result.output) && result.output.length > 0) {
        // Check each output item for content
        for (const outputItem of result.output) {
          // Skip reasoning and web_search_call types, look for message/text content
          if (outputItem?.type === 'reasoning' || outputItem?.type === 'web_search_call') {
            continue;
          }
          
          // Look for message type
          if (outputItem?.type === 'message') {
            if (Array.isArray(outputItem?.content) && outputItem.content.length > 0) {
              const firstContent = outputItem.content[0];
              if (firstContent?.text) {
                content = firstContent.text;
                break;
              } else if (typeof firstContent === 'string') {
                content = firstContent;
                break;
              }
            } else if (typeof outputItem?.content === 'string') {
              content = outputItem.content;
              break;
            }
          }
          
          // Look for direct text content
          if (outputItem?.text && typeof outputItem.text === 'string') {
            content = outputItem.text;
            break;
          }
          
          // Look for content field
          if (outputItem?.content && typeof outputItem.content === 'string') {
            content = outputItem.content;
            break;
          }
        }
        
        // If still no content, try the last item regardless of type
        if (!content && result.output.length > 0) {
          const lastOutput = result.output[result.output.length - 1];
          if (Array.isArray(lastOutput?.content) && lastOutput.content.length > 0) {
            const firstContent = lastOutput.content[0];
            if (firstContent?.text) {
              content = firstContent.text;
            } else if (typeof firstContent === 'string') {
              content = firstContent;
            }
          } else if (typeof lastOutput?.content === 'string') {
            content = lastOutput.content;
          } else if (lastOutput?.text) {
            content = lastOutput.text;
          }
        }
      }

      if (!content) {
        // Log full structure for debugging
        console.error(`[${jobId}] GPT-5 response structure:`, JSON.stringify(result).substring(0, 1000));
        
        // Try to extract ANY text from the response as last resort
        const responseStr = JSON.stringify(result);
        const textMatch = responseStr.match(/"text":\s*"([^"]+)"/i);
        if (textMatch && textMatch[1]) {
          content = textMatch[1];
          console.warn(`[${jobId}] Extracted content from GPT-5 response using fallback regex`);
        } else if (result?.status === 'incomplete') {
          const reason = result?.incomplete_details?.reason || 'unknown';
          throw AIError.invalidResponse(`GPT-5: Incomplete response: ${reason}. Try increasing max_output_tokens.`);
        } else {
          // Return a minimal valid response instead of throwing
          content = `GPT-5 response processing error. Status: ${result?.status || 'unknown'}. Please retry.`;
          console.error(`[${jobId}] GPT-5 empty response - using fallback message`);
        }
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
      if (error instanceof AIError) {
        throw error;
      }
      
      // AbortError is now handled by base class timeout mechanism
      // Convert network errors
      if (error.code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) {
        throw AIError.networkError('GPT-5', error);
      }
      
      throw new AIError(error.message || 'Unknown GPT-5 error', 'EXTERNAL_API_ERROR' as any);
    }
  }

  validateParameters(config: AiConfig): void {
    // GPT-5 doesn't support temperature or topP
    if (config.temperature !== undefined && config.temperature !== 1) {
      console.warn(`⚠️ Temperature is ignored for GPT-5`);
    }
    if (config.topP !== undefined && config.topP !== 1) {
      console.warn(`⚠️ TopP is ignored for GPT-5`);
    }
    if (config.topK !== undefined) {
      console.warn(`⚠️ TopK is ignored for GPT-5 (only supported by Google AI)`);
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens < 100) {
      throw AIError.validationFailed(`MaxOutputTokens must be at least 100 for GPT-5, got ${config.maxOutputTokens}`);
    }
  }

  getSupportedParameters(): string[] {
    return ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'];
  }
}