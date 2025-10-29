import { BaseAIHandler, AIModelResponse, AIModelParameters } from "./base-handler";
import { AIError } from "@shared/errors";
import type { AiConfig } from "@shared/schema";

/**
 * Google Deep Research Handler
 *
 * Implements Google's Gemini Pro 2.5 Deep Research agent with two-step API pattern:
 * 1. Initial query to create research task
 * 2. "Start Research" to execute and stream results
 *
 * Based on: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/deep-research
 */
export class GoogleDeepResearchHandler extends BaseAIHandler {
  private projectId: string;
  private location: string;
  private endpoint: string;

  constructor(apiKey: string, projectId?: string, location: string = 'us-central1') {
    super("Google Deep Research", apiKey);
    this.projectId = projectId || this.extractProjectIdFromKey(apiKey);
    this.location = location;
    this.endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}`;
  }

  private extractProjectIdFromKey(apiKey: string): string {
    // For service account keys, extract project ID
    // For API keys, use environment variable or throw error
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      return process.env.GOOGLE_CLOUD_PROJECT;
    }
    throw new Error('GOOGLE_CLOUD_PROJECT environment variable required for Deep Research');
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
      promptLength: finalPrompt.length,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      useWebSearch: true, // Deep Research always uses web search
      note: "Google Deep Research uses two-step API: query → Start Research"
    });

    try {
      // Step 1: Create research task
      const researchTaskId = await this.createResearchTask(finalPrompt, config, options?.signal);

      console.log(`🔬 [${jobId}] Created Deep Research task: ${researchTaskId}`);

      // Step 2: Execute research and stream results
      const researchResult = await this.executeResearch(researchTaskId, config, options?.signal);

      const duration = Date.now() - startTime;

      const result: AIModelResponse = {
        content: researchResult.content,
        duration,
        usage: researchResult.usage,
        metadata: {
          model: config.model,
          researchTaskId,
          questionsAsked: researchResult.questionsAsked,
          citationsCount: researchResult.citations?.length || 0,
          hasAudioSummary: !!researchResult.audioSummary
        }
      };

      this.logSuccess(jobId, result);
      return result;

    } catch (error: any) {
      if (error instanceof AIError) {
        throw error;
      }

      // Handle network errors
      if (error.code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) {
        throw AIError.networkError('Google Deep Research', error);
      }

      throw new AIError(error.message || 'Unknown Google Deep Research error', 'EXTERNAL_API_ERROR' as any);
    }
  }

  /**
   * Step 1: Create research task
   */
  private async createResearchTask(
    query: string,
    config: AiConfig,
    signal?: AbortSignal
  ): Promise<string> {
    const url = `${this.endpoint}/publishers/google/models/${config.model}:generateContent`;

    const requestBody = {
      contents: [{
        role: "user",
        parts: [{
          text: query
        }]
      }],
      generationConfig: {
        temperature: config.temperature || 0.1,
        topP: config.topP || 0.95,
        topK: config.topK || 20,
        maxOutputTokens: config.maxOutputTokens || 8192
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error response');
      throw AIError.fromHttpError(response.status, errorText, 'Google Deep Research (Task Creation)');
    }

    const result = await response.json();

    // Extract task ID from response
    // The actual field name depends on Google's API response structure
    const taskId = result.name || result.id || result.taskId;

    if (!taskId) {
      throw AIError.invalidResponse('Google Deep Research', 'No task ID in response');
    }

    return taskId;
  }

  /**
   * Step 2: Execute research and collect streaming results
   */
  private async executeResearch(
    taskId: string,
    config: AiConfig,
    signal?: AbortSignal
  ): Promise<{
    content: string;
    usage?: any;
    questionsAsked: number;
    citations: any[];
    audioSummary?: string;
  }> {
    const url = `${this.endpoint}/operations/${taskId}:startResearch`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        streamResults: true
      }),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error response');
      throw AIError.fromHttpError(response.status, errorText, 'Google Deep Research (Execution)');
    }

    // Parse streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw AIError.invalidResponse('Google Deep Research', 'No response body');
    }

    const decoder = new TextDecoder();
    let finalContent = '';
    let questionsAsked = 0;
    const citations: any[] = [];
    let audioSummary: string | undefined;
    let usage: any;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix

            // Handle different event types based on Google's Deep Research API
            if (data.type === 'research_question') {
              questionsAsked++;
              console.log(`❓ Research question ${questionsAsked}: ${data.question}`);
            } else if (data.type === 'research_answer') {
              finalContent += data.answer + '\n\n';
              console.log(`✅ Research answer: ${data.answer.slice(0, 100)}...`);
            } else if (data.type === 'citation') {
              citations.push(data);
            } else if (data.type === 'audio_summary') {
              audioSummary = data.url;
            } else if (data.type === 'usage') {
              usage = data.usage;
            } else if (data.candidates) {
              // Standard Gemini response format
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                finalContent += text;
              }
            }
          } catch (parseError) {
            console.warn(`Failed to parse streaming chunk: ${line}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalContent || finalContent.trim() === '') {
      throw AIError.invalidResponse('Google Deep Research', 'Empty research result');
    }

    return {
      content: finalContent.trim(),
      usage,
      questionsAsked,
      citations,
      audioSummary
    };
  }

  validateParameters(config: AiConfig): void {
    // Google Deep Research supports standard Gemini parameters
    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 2)) {
      throw AIError.validationFailed(`Temperature must be between 0 and 2 for Google Deep Research, got ${config.temperature}`);
    }
    if (config.topP !== undefined && (config.topP < 0 || config.topP > 1)) {
      throw AIError.validationFailed(`TopP must be between 0 and 1 for Google Deep Research, got ${config.topP}`);
    }
    if (config.topK !== undefined && (config.topK < 1 || config.topK > 40)) {
      throw AIError.validationFailed(`TopK must be between 1 and 40 for Google Deep Research, got ${config.topK}`);
    }
    if (config.maxOutputTokens !== undefined && (config.maxOutputTokens < 100 || config.maxOutputTokens > 65536)) {
      throw AIError.validationFailed(`MaxOutputTokens must be between 100 and 65536 for Google Deep Research, got ${config.maxOutputTokens}`);
    }
  }

  getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'topK', 'maxOutputTokens', 'useWebSearch'];
  }
}
