/**
 * Gemini 3 Pro Deep Research Handler
 *
 * Wraps the ResearchOrchestrator for use with AI Model Factory
 */

import { BaseAIHandler, AIModelResponse, AIModelParameters } from './base-handler';
import { ResearchOrchestrator } from '../research/research-orchestrator';
import type { AiConfig } from '@shared/schema';

export class Gemini3DeepResearchHandler extends BaseAIHandler {
  private orchestrator: ResearchOrchestrator;
  private handlerApiKey: string;

  constructor(apiKey: string) {
    super('Gemini 3 Deep Research', apiKey);
    this.handlerApiKey = apiKey;
    this.orchestrator = new ResearchOrchestrator(apiKey);
  }

  // Implement abstract methods from BaseAIHandler
  public validateParameters(config: AiConfig): void {
    // Validation is handled by Zod schema in shared/schema.ts
  }

  public getSupportedParameters(): string[] {
    return ['temperature', 'topP', 'topK', 'maxOutputTokens', 'thinkingLevel', 'useGrounding', 'maxQuestions', 'parallelExecutors'];
  }

  public async callInternal(
    prompt: string,
    config: AiConfig,
    options?: AIModelParameters & { signal?: AbortSignal }
  ): Promise<AIModelResponse> {
    const startTime = Date.now();

    // Extract research configuration from options
    const researchConfig = {
      maxQuestions: (config as any).maxQuestions || 5,
      parallelExecutors: (config as any).parallelExecutors || 3,
      useGrounding: options?.useGrounding !== false,
      thinkingLevel: (config as any).thinkingLevel || 'high',
      temperature: config.temperature || 1.0,
      maxOutputTokens: config.maxOutputTokens || 8192,
      timeout: 1800000
    };

    // Re-create orchestrator with custom config
    this.orchestrator = new ResearchOrchestrator(this.handlerApiKey, researchConfig);

    // Progress tracking for SSE
    const progressCallback = (progress: any) => {
      if (options?.jobId) {
        console.log(`[${options.jobId}] Research progress: ${progress.stage} - ${progress.progress}%`);
      }
    };

    try {
      const report = await this.orchestrator.conductDeepResearch(prompt, progressCallback);

      // Format response to match AIModelResponse
      const formattedResponse = this.formatReport(report);

      return {
        content: formattedResponse,
        duration: Date.now() - startTime,
        metadata: {
          questionsGenerated: report.metadata.questionsGenerated,
          sourcesConsulted: report.metadata.sourcesConsulted,
          findings: report.findings.length,
          model: report.metadata.model
        }
      };

    } catch (error) {
      console.error('[Gemini3DeepResearchHandler] Deep research failed:', error);
      throw error;
    }
  }

  /**
   * Format research report for consumption by the application
   */
  private formatReport(report: any): string {
    const sections: string[] = [];

    // Header
    sections.push(`# DEEP RESEARCH RAPPORT\n`);
    sections.push(`**Onderzoeksvraag:** ${report.query}\n`);
    sections.push(`**Datum:** ${new Date().toLocaleDateString('nl-NL')}\n`);
    sections.push(`**Bronnen geraadpleegd:** ${report.metadata.sourcesConsulted}\n`);
    sections.push(`---\n`);

    // Summary
    sections.push(`## SAMENVATTING\n`);
    sections.push(`${report.summary}\n`);
    sections.push(`---\n`);

    // Main synthesis
    sections.push(`## ONDERZOEKSRESULTATEN\n`);
    sections.push(`${report.synthesis}\n`);
    sections.push(`---\n`);

    // Detailed findings (optional - for debugging/transparency)
    if (report.findings && report.findings.length > 0) {
      sections.push(`## GEDETAILLEERDE BEVINDINGEN\n`);
      report.findings.forEach((finding: any, idx: number) => {
        sections.push(`### ${idx + 1}. ${finding.question}\n`);
        sections.push(`${finding.answer}\n`);
        if (finding.sources && finding.sources.length > 0) {
          sections.push(`\n**Bronnen:**\n`);
          finding.sources.slice(0, 3).forEach((source: any) => {
            sections.push(`- [${source.title}](${source.url || '#'})\n`);
          });
        }
        sections.push(`\n`);
      });
      sections.push(`---\n`);
    }

    // All sources
    if (report.sources && report.sources.length > 0) {
      sections.push(`## BRONVERMELDING\n`);
      const uniqueSources = report.sources.slice(0, 20); // Limit to top 20
      uniqueSources.forEach((source: any, idx: number) => {
        sections.push(`${idx + 1}. **${source.title}**\n`);
        if (source.url) {
          sections.push(`   ${source.url}\n`);
        }
        if (source.snippet) {
          sections.push(`   _${source.snippet.substring(0, 150)}..._\n`);
        }
        sections.push(`\n`);
      });
    }

    // Metadata footer
    sections.push(`---\n`);
    sections.push(`_Gegenereerd met Gemini 3 Pro Deep Research_\n`);
    sections.push(`_Duur: ${Math.round(report.metadata.duration / 1000)}s | `);
    sections.push(`Vragen: ${report.metadata.questionsGenerated} | `);
    sections.push(`Tokens: ~${report.metadata.totalTokensUsed}_\n`);

    return sections.join('');
  }
}
