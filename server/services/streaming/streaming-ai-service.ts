import type { AiConfig } from "@shared/schema";
import { AIModelFactory, type AIModelParameters } from "../ai-models/ai-model-factory";
import { StreamingSessionManager } from "./streaming-session-manager";
import type { StreamingEvent } from "@shared/streaming-types";

export class StreamingAIService {
  private modelFactory: AIModelFactory;
  private sessionManager: StreamingSessionManager;

  constructor() {
    this.modelFactory = AIModelFactory.getInstance();
    this.sessionManager = StreamingSessionManager.getInstance();
  }

  // Execute AI call with token streaming support
  async executeStreamingCall(
    reportId: string,
    stageId: string,
    substepId: string,
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters
  ): Promise<string> {
    console.log(`🌊 [${reportId}-${stageId}] Starting streaming AI call for ${substepId}`);
    
    // Start substep
    this.sessionManager.startSubstep(reportId, stageId, substepId);

    try {
      // Check if model supports streaming
      const modelInfo = this.modelFactory.getModelInfo(config.model);
      const supportsStreaming = this.supportsTokenStreaming(config.model);

      if (supportsStreaming) {
        return await this.executeWithTokenStreaming(reportId, stageId, substepId, prompt, config, options);
      } else {
        return await this.executeWithProgressTracking(reportId, stageId, substepId, prompt, config, options);
      }
    } catch (error: any) {
      this.sessionManager.errorSubstep(reportId, stageId, substepId, error.message);
      throw error;
    }
  }

  // Execute with token-by-token streaming (like ChatGPT)
  private async executeWithTokenStreaming(
    reportId: string,
    stageId: string,
    substepId: string,
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters
  ): Promise<string> {
    // For now, implement progressive updates until we add true streaming
    // This simulates token streaming with periodic updates
    let accumulatedContent = '';
    const totalEstimatedTokens = Math.ceil(prompt.length / 4); // rough estimate
    
    this.sessionManager.updateSubstepProgress(reportId, stageId, substepId, 10, 'Initiating AI request...');

    const response = await this.modelFactory.callModel(config, prompt, {
      ...options,
      jobId: `${reportId}-${substepId}`,
      timeout: options?.timeout || 600000
    });

    // Simulate streaming by breaking response into chunks
    const chunks = this.chunkResponse(response.content, 20);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      accumulatedContent += chunk;
      
      // Stream token event
      this.sessionManager.streamToken(reportId, stageId, chunk, accumulatedContent);
      
      // Update progress
      const progress = Math.round(((i + 1) / chunks.length) * 90) + 10;
      this.sessionManager.updateSubstepProgress(
        reportId, 
        stageId, 
        substepId, 
        progress, 
        `Generating... (${i + 1}/${chunks.length} chunks)`
      );

      // Small delay to simulate streaming
      await this.delay(100);
    }

    this.sessionManager.completeSubstep(reportId, stageId, substepId, response.content);
    return response.content;
  }

  // Execute with progress tracking (non-streaming models)
  private async executeWithProgressTracking(
    reportId: string,
    stageId: string,
    substepId: string,
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters
  ): Promise<string> {
    // Update progress periodically
    this.sessionManager.updateSubstepProgress(reportId, stageId, substepId, 10, 'Initiating AI request...');

    // Start progress monitoring
    const progressInterval = setInterval(() => {
      const session = this.sessionManager.getSession(reportId, stageId);
      const substep = session?.progress.substeps.find(s => s.substepId === substepId);
      if (substep && substep.status === 'running' && substep.percentage < 90) {
        const newProgress = Math.min(substep.percentage + 5, 90);
        this.sessionManager.updateSubstepProgress(
          reportId, 
          stageId, 
          substepId, 
          newProgress, 
          'Processing...'
        );
      }
    }, 2000);

    try {
      const response = await this.modelFactory.callModel(config, prompt, {
        ...options,
        jobId: `${reportId}-${substepId}`,
        timeout: options?.timeout || 600000
      });

      clearInterval(progressInterval);
      this.sessionManager.completeSubstep(reportId, stageId, substepId, response.content);
      return response.content;
    } catch (error) {
      clearInterval(progressInterval);
      throw error;
    }
  }

  // Execute non-AI operations (like source fetching)
  async executeNonAIOperation(
    reportId: string,
    stageId: string,
    substepId: string,
    operation: () => Promise<string>,
    estimatedDuration: number = 30
  ): Promise<string> {
    console.log(`⚙️ [${reportId}-${stageId}] Starting non-AI operation: ${substepId}`);
    
    this.sessionManager.startSubstep(reportId, stageId, substepId);

    // Progress simulation for operations without natural progress indicators
    const progressInterval = setInterval(() => {
      const session = this.sessionManager.getSession(reportId, stageId);
      const substep = session?.progress.substeps.find(s => s.substepId === substepId);
      if (substep && substep.status === 'running' && substep.percentage < 95) {
        const newProgress = Math.min(substep.percentage + 15, 95);
        this.sessionManager.updateSubstepProgress(
          reportId, 
          stageId, 
          substepId, 
          newProgress, 
          'Processing...'
        );
      }
    }, Math.max(estimatedDuration * 100, 2000)); // Update every 2s or proportionally

    try {
      const result = await operation();
      clearInterval(progressInterval);
      this.sessionManager.completeSubstep(reportId, stageId, substepId, result);
      return result;
    } catch (error: any) {
      clearInterval(progressInterval);
      this.sessionManager.errorSubstep(reportId, stageId, substepId, error.message);
      throw error;
    }
  }

  // Check if model supports token streaming
  private supportsTokenStreaming(model: string): boolean {
    // For Phase 1, we'll simulate streaming for all models
    // In Phase 2, we can implement real streaming for supported models
    return model.includes('gpt') || model.includes('gemini');
  }

  // Chunk response for simulated streaming
  private chunkResponse(content: string, maxChunks: number): string[] {
    if (content.length <= maxChunks) {
      return [content];
    }

    const chunks: string[] = [];
    const chunkSize = Math.ceil(content.length / maxChunks);
    
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }
    
    return chunks;
  }

  // Utility delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cancel ongoing operation
  async cancelOperation(reportId: string, stageId: string): Promise<void> {
    console.log(`🛑 [${reportId}-${stageId}] Cancelling streaming operation`);
    this.sessionManager.cancelSession(reportId, stageId);
  }

  // Retry failed substep
  async retrySubstep(
    reportId: string,
    stageId: string,
    substepId: string,
    operation: () => Promise<string>
  ): Promise<string> {
    console.log(`🔄 [${reportId}-${stageId}] Retrying substep: ${substepId}`);
    
    // Reset substep status
    const session = this.sessionManager.getSession(reportId, stageId);
    if (session) {
      const substep = session.progress.substeps.find(s => s.substepId === substepId);
      if (substep) {
        substep.status = 'pending';
        substep.percentage = 0;
        substep.message = undefined;
        substep.startTime = undefined;
        substep.endTime = undefined;
      }
    }

    return await operation();
  }
}