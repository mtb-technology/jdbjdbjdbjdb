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
      const timeoutMs = (config.maxOutputTokens && config.maxOutputTokens > 8192) ? 600000 : 300000; // 5-10 min based on token count
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

      let result;
      try {
        result = await response.json();
      } catch (jsonError: any) {
        throw new Error(`Failed to parse Deep Research response as JSON: ${jsonError.message}`);
      }
      const duration = Date.now() - startTime;

      // Debug: log the full response structure
      console.log(`🔍 [${jobId}] Deep Research response structure:`, {
        hasOutput: !!result?.output,
        outputLength: Array.isArray(result?.output) ? result.output.length : 0,
        outputTypes: Array.isArray(result?.output) ? result.output.map((item: any) => item?.type) : [],
        hasOutputText: !!result?.output_text,
        status: result?.status
      });
      
      // Extract content from Deep Research Responses API format
      let content = "";
      let messageContent = "";
      let reasoningContent = "";
      
      // First, scan for actual message content (the AI's real response)
      if (result?.output && Array.isArray(result.output) && result.output.length > 0) {
        for (let i = result.output.length - 1; i >= 0; i--) {
          const item: any = result.output[i];
          
          // Prioritize message type with content (this is the actual AI response)
          if (item?.type === 'message' && item?.content) {
            console.log(`📝 [${jobId}] Found message item:`, {
              hasContent: !!item.content,
              contentType: Array.isArray(item.content) ? 'array' : typeof item.content,
              contentLength: Array.isArray(item.content) ? item.content.length : (typeof item.content === 'string' ? item.content.length : 0)
            });
            
            if (Array.isArray(item.content)) {
              for (const contentItem of item.content) {
                if (contentItem?.text && typeof contentItem.text === 'string') {
                  messageContent = contentItem.text;
                  console.log(`✅ [${jobId}] Extracted message text (${messageContent.length} chars)`);
                  break;
                }
              }
            } else if (typeof item.content === 'string') {
              messageContent = item.content;
              console.log(`✅ [${jobId}] Used direct string content (${messageContent.length} chars)`);
            }
            if (messageContent) break;
          }
          
          // Collect reasoning summary as fallback
          if (item?.type === 'reasoning' && item?.summary && Array.isArray(item.summary)) {
            for (const summaryItem of item.summary) {
              if (summaryItem?.type === 'summary_text' && summaryItem?.text && summaryItem.text.length > 50) {
                reasoningContent = summaryItem.text;
                break;
              }
            }
          }
        }
      }
      
      // Check if we have direct output_text
      const outputText = result?.output_text && typeof result.output_text === 'string' ? result.output_text : "";
      
      // Try alternative parsing if no message content found
      if (!messageContent && result?.choices && Array.isArray(result.choices) && result.choices.length > 0) {
        const choice = result.choices[0];
        if (choice?.message?.content) {
          messageContent = choice.message.content;
          console.log(`🔄 [${jobId}] Found content in choices format (${messageContent.length} chars)`);
        }
      }
      
      // Try yet another format - direct content field
      if (!messageContent && result?.content && typeof result.content === 'string') {
        messageContent = result.content;
        console.log(`🔄 [${jobId}] Found content in direct format (${messageContent.length} chars)`);
      }
      
      // For Deep Research, try to get the final result instead of reasoning
      if (!messageContent && result?.result && typeof result.result === 'string') {
        messageContent = result.result;
        console.log(`🔄 [${jobId}] Found content in result format (${messageContent.length} chars)`);
      }
      
      // Prioritize message content over reasoning and output_text
      if (messageContent) {
        content = messageContent;
        console.log(`📄 [${jobId}] Using message content (${messageContent.length} chars)`);
      } else if (outputText) {
        content = outputText;
        console.log(`📄 [${jobId}] Using output_text (${outputText.length} chars)`);
      } else if (reasoningContent) {
        content = reasoningContent;
        console.log(`⚠️ [${jobId}] Falling back to reasoning content (${reasoningContent.length} chars)`);
        console.log(`🚨 [${jobId}] This might be wrong - reasoning instead of final output!`);
      }
      
      // Additional JSON detection for reviewer stages
      if (content && jobId && content.includes('"score"') && content.includes('"positief"')) {
        // Try to extract just the JSON from the content
        const jsonMatch = content.match(/\{[\s\S]*?"suggesties"[\s\S]*?\}/);
        if (jsonMatch) {
          content = jsonMatch[0];
          console.log(`🎯 [${jobId}] Extracted JSON from content (${content.length} chars)`);
        }
      }

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