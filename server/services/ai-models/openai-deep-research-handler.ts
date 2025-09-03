import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import type { AiConfig } from "@shared/schema";

export class OpenAIDeepResearchHandler extends BaseAIHandler {
  constructor(apiKey: string, modelName: string) {
    super(`OpenAI Deep Research (${modelName})`, apiKey);
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
      maxOutputTokens: config.maxOutputTokens,
      reasoning: config.reasoning,
      verbosity: config.verbosity,
      useWebSearch: options?.useWebSearch,
      note: "Deep Research models use Responses API"
    });

    try {
      const requestConfig: any = {
        model: config.model,
        reasoning: { summary: "auto" },
        input: [
          { 
            role: "user", 
            content: [{ 
              type: "input_text", 
              text: finalPrompt 
            }] 
          }
        ]
      };

      // Add parameters for deep research models
      if (config.maxOutputTokens) {
        requestConfig.max_output_tokens = config.maxOutputTokens;
      }
      
      // Deep research models support reasoning but not temperature
      if (config.reasoning?.effort) {
        requestConfig.reasoning = { 
          ...requestConfig.reasoning,
          effort: config.reasoning.effort 
        };
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
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout

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
        throw new Error(`Deep Research API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      const duration = Date.now() - startTime;

      // Extract content from Deep Research Responses API format
      let content = "";
      
      // Try different extraction methods
      if (result?.output_text && typeof result.output_text === 'string') {
        content = result.output_text;
      } else if (result?.output && Array.isArray(result.output) && result.output.length > 0) {
        // Look for content in the output array
        for (let i = result.output.length - 1; i >= 0; i--) {
          const item = result.output[i];
          
          // Look for message type with content
          if (item?.type === 'message' && item?.content) {
            if (Array.isArray(item.content)) {
              for (const contentItem of item.content) {
                if (contentItem?.text && typeof contentItem.text === 'string') {
                  content = contentItem.text;
                  break;
                }
              }
            } else if (typeof item.content === 'string') {
              content = item.content;
            }
            if (content) break;
          }
          
          // Look for reasoning summary
          if (item?.type === 'reasoning' && item?.summary && Array.isArray(item.summary)) {
            for (const summaryItem of item.summary) {
              if (summaryItem?.type === 'summary_text' && summaryItem?.text && summaryItem.text.length > 50) {
                content = summaryItem.text;
                break;
              }
            }
            if (content) break;
          }
        }
      }

      // Always log the structure for debugging until we fix this issue
      console.log(`🔍 [${jobId}] Deep Research response structure:`, JSON.stringify(result, null, 2).substring(0, 1500));

      if (!content) {
        
        if (result?.status === 'incomplete') {
          const reason = result?.incomplete_details?.reason || 'unknown';
          throw new Error(`Incomplete Deep Research response: ${reason}. Try increasing max_output_tokens.`);
        }
        
        throw new Error(`Empty response from Deep Research model - no usable content found`);
      }

      const apiResponse: AIModelResponse = {
        content,
        duration,
        usage: result.usage,
        metadata: {
          model: config.model,
          status: result.status,
          incompleteDetails: result.incomplete_details
        }
      };

      this.logSuccess(jobId, apiResponse);
      return apiResponse;

    } catch (error: any) {
      this.logError(jobId, error);
      
      if (error.name === 'AbortError') {
        throw new Error(`Deep Research model timed out after 10 minutes`);
      }
      
      throw new Error(`Deep Research API fout: ${error.message}`);
    }
  }

  validateParameters(config: AiConfig): void {
    // Deep Research models don't support temperature, topP, or topK
    if (config.temperature !== undefined && config.temperature !== 1) {
      console.warn(`⚠️ Temperature wordt genegeerd voor Deep Research model ${config.model}`);
    }
    if (config.topP !== undefined && config.topP !== 1) {
      console.warn(`⚠️ TopP wordt genegeerd voor Deep Research model ${config.model}`);
    }
    if (config.topK !== undefined) {
      console.warn(`⚠️ TopK wordt genegeerd voor Deep Research model ${config.model} (alleen voor Google AI)`);
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens < 100) {
      throw new Error(`MaxOutputTokens moet minstens 100 zijn voor Deep Research models`);
    }
  }

  getSupportedParameters(): string[] {
    return ['maxOutputTokens', 'reasoning', 'verbosity', 'useWebSearch'];
  }
}