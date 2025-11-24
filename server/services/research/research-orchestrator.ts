/**
 * Deep Research Orchestrator
 *
 * Implements the GPT Researcher pattern with Gemini 3 Pro:
 * 1. PLANNER: Generate focused research questions
 * 2. EXECUTOR: Parallel research with Google Search grounding
 * 3. PUBLISHER: Synthesize comprehensive report
 */

import { GoogleAIHandler } from '../ai-models/google-handler';
import type {
  ResearchQuestion,
  ResearchFinding,
  ResearchReport,
  ResearchConfig,
  ResearchProgress,
  Source
} from './types';

export class ResearchOrchestrator {
  private handler: GoogleAIHandler;
  private config: ResearchConfig;

  constructor(apiKey: string, config: Partial<ResearchConfig> = {}) {
    this.handler = new GoogleAIHandler(apiKey);
    this.config = {
      maxQuestions: 5,
      parallelExecutors: 3,
      useGrounding: true,
      thinkingLevel: 'high',
      temperature: 1.0,
      maxOutputTokens: 8192,
      timeout: 1800000, // 30 minutes
      ...config
    };
  }

  /**
   * Conduct deep research on a query
   * Returns comprehensive report with citations
   */
  async conductDeepResearch(
    query: string,
    progressCallback?: (progress: ResearchProgress) => void
  ): Promise<ResearchReport> {
    const startTime = Date.now();
    let totalTokens = 0;

    try {
      // PHASE 1: PLANNER - Generate research questions
      progressCallback?.({
        stage: 'planning',
        message: 'Analyseren van de vraag en genereren van onderzoeksplan...',
        progress: 10
      });

      const questions = await this.planResearch(query);
      totalTokens += 2000; // Estimate

      progressCallback?.({
        stage: 'planning',
        message: `${questions.length} onderzoeksvragen gegenereerd`,
        progress: 20
      });

      // PHASE 2: EXECUTOR - Parallel research execution
      progressCallback?.({
        stage: 'executing',
        message: 'Uitvoeren van onderzoek met Google Search grounding...',
        progress: 30
      });

      const findings = await this.executeResearch(questions, (current, total) => {
        const execProgress = 30 + (60 * current / total);
        progressCallback?.({
          stage: 'executing',
          message: `Onderzoek ${current}/${total}: ${questions[current - 1]?.question}`,
          progress: execProgress,
          currentQuestion: questions[current - 1]?.question
        });
      });

      findings.forEach(f => totalTokens += f.tokensUsed);

      progressCallback?.({
        stage: 'executing',
        message: `${findings.length} bevindingen verzameld`,
        progress: 90
      });

      // PHASE 3: PUBLISHER - Synthesize final report
      progressCallback?.({
        stage: 'publishing',
        message: 'Synthetiseren van eindrapport...',
        progress: 92
      });

      const report = await this.publishReport(query, findings);
      totalTokens += 4000; // Estimate for synthesis

      const duration = Date.now() - startTime;

      progressCallback?.({
        stage: 'complete',
        message: 'Deep research voltooid',
        progress: 100,
        findings
      });

      return {
        ...report,
        metadata: {
          questionsGenerated: questions.length,
          sourcesConsulted: findings.reduce((sum, f) => sum + f.sources.length, 0),
          totalTokensUsed: totalTokens,
          duration,
          model: 'gemini-3-pro-preview',
          timestamp: new Date()
        }
      };

    } catch (error) {
      console.error('[ResearchOrchestrator] Deep research failed:', error);
      throw error;
    }
  }

  /**
   * PLANNER: Generate focused research questions
   * Uses Gemini 3 Pro with high thinking to decompose query
   */
  private async planResearch(query: string): Promise<ResearchQuestion[]> {
    const plannerPrompt = `Je bent een expert onderzoeksplanner. Analyseer de volgende onderzoeksvraag en genereer ${this.config.maxQuestions} specifieke, gefocuste deelvragen die samen een volledig antwoord kunnen geven.

ONDERZOEKSVRAAG:
${query}

Genereer ${this.config.maxQuestions} deelvragen die:
1. Specifiek en gericht zijn
2. Verschillende aspecten van de hoofdvraag dekken
3. Beantwoordbaar zijn met web research
4. Samen een compleet beeld geven

Geef je antwoord als JSON array:
[
  {
    "id": "q1",
    "question": "Specifieke deelvraag hier",
    "priority": "high",
    "expectedScope": "Wat voor informatie verwacht je te vinden"
  },
  ...
]

Geef ALLEEN de JSON array, geen andere tekst.`;

    const response = await this.handler.callInternal(
      plannerPrompt,
      {
        provider: 'google',
        model: 'gemini-3-pro-preview',
        temperature: this.config.temperature || 1.0,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096,
        thinkingLevel: this.config.thinkingLevel || 'high'
      },
      {
        timeout: 120000, // 2 minutes for planning
        jobId: `planner-${Date.now()}`
      }
    );

    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonText = response.content.trim();
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      const questions: ResearchQuestion[] = JSON.parse(jsonText);

      console.log(`[ResearchOrchestrator] Planner generated ${questions.length} questions`);
      return questions.slice(0, this.config.maxQuestions);

    } catch (parseError) {
      console.error('[ResearchOrchestrator] Failed to parse planner output:', parseError);
      console.error('Raw response:', response.content.substring(0, 500));

      // Fallback: Create a single question from the original query
      return [{
        id: 'q1',
        question: query,
        priority: 'high',
        expectedScope: 'Comprehensive answer to the main query'
      }];
    }
  }

  /**
   * EXECUTOR: Parallel research execution with grounding
   * Each question is researched independently with Google Search
   */
  private async executeResearch(
    questions: ResearchQuestion[],
    progressCallback?: (current: number, total: number) => void
  ): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = [];
    const parallelLimit = this.config.parallelExecutors || 3;

    // Process questions in batches for parallel execution
    for (let i = 0; i < questions.length; i += parallelLimit) {
      const batch = questions.slice(i, i + parallelLimit);
      const batchPromises = batch.map(q => this.researchQuestion(q));

      const batchResults = await Promise.all(batchPromises);
      findings.push(...batchResults);

      // Progress update after each batch
      progressCallback?.(findings.length, questions.length);
    }

    return findings;
  }

  /**
   * Research a single question with Google Search grounding
   */
  private async researchQuestion(question: ResearchQuestion): Promise<ResearchFinding> {
    const startTime = Date.now();

    const researchPrompt = `Beantwoord de volgende onderzoeksvraag grondig en gedetailleerd. Gebruik de beschikbare web informatie om een compleet en accuraat antwoord te geven.

ONDERZOEKSVRAAG:
${question.question}

VERWACHTE SCOPE:
${question.expectedScope}

Geef een uitgebreid antwoord met:
1. Directe beantwoording van de vraag
2. Relevante details en context
3. Specifieke feiten en cijfers waar mogelijk
4. Bronvermeldingen waar van toepassing

Wees specifiek en uitgebreid - dit is onderzoek voor een professioneel rapport.`;

    try {
      const response = await this.handler.callInternal(
        researchPrompt,
        {
          provider: 'google',
          model: 'gemini-3-pro-preview',
          temperature: this.config.temperature || 1.0,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: this.config.maxOutputTokens || 8192,
          thinkingLevel: 'medium' // Medium for faster execution
        },
        {
          useGrounding: this.config.useGrounding !== false,
          timeout: 300000, // 5 minutes per question
          jobId: `executor-${question.id}-${Date.now()}`
        }
      );

      // Extract sources from grounding metadata
      const sources = this.extractSources(response);

      // Estimate confidence based on response length and source count
      const confidence = Math.min(
        0.5 + (sources.length * 0.1) + (response.content.length > 500 ? 0.3 : 0.1),
        1.0
      );

      return {
        questionId: question.id,
        question: question.question,
        answer: response.content,
        sources,
        confidence,
        timestamp: new Date(),
        tokensUsed: response.content.length / 3 // Rough estimate
      };

    } catch (error) {
      console.error(`[ResearchOrchestrator] Failed to research question ${question.id}:`, error);

      // Return partial finding on error
      return {
        questionId: question.id,
        question: question.question,
        answer: `Onderzoek voor deze vraag is mislukt: ${error instanceof Error ? error.message : 'Unknown error'}`,
        sources: [],
        confidence: 0,
        timestamp: new Date(),
        tokensUsed: 0
      };
    }
  }

  /**
   * Extract sources from grounding metadata
   */
  private extractSources(response: any): Source[] {
    const sources: Source[] = [];

    // Check for grounding metadata in response
    if (response.groundingMetadata?.groundingChunks) {
      for (const chunk of response.groundingMetadata.groundingChunks) {
        if (chunk.web) {
          sources.push({
            url: chunk.web.uri,
            title: chunk.web.title || 'Web Source',
            snippet: chunk.web.snippet || '',
            relevanceScore: chunk.web.score
          });
        }
      }
    }

    // Also check metadata field
    if (response.metadata?.sources) {
      for (const source of response.metadata.sources) {
        sources.push({
          url: source.url,
          title: source.title || 'Source',
          snippet: source.snippet || ''
        });
      }
    }

    return sources;
  }

  /**
   * PUBLISHER: Synthesize comprehensive report from findings
   * Uses Gemini 3 Pro with high thinking for synthesis
   */
  private async publishReport(
    originalQuery: string,
    findings: ResearchFinding[]
  ): Promise<Omit<ResearchReport, 'metadata'>> {
    // Combine all findings into context
    const findingsContext = findings
      .map((f, idx) => {
        const sourcesText = f.sources.length > 0
          ? `\nBronnen:\n${f.sources.map(s => `- ${s.title}${s.url ? ` (${s.url})` : ''}: ${s.snippet}`).join('\n')}`
          : '';

        return `### BEVINDING ${idx + 1}
Vraag: ${f.question}
Antwoord: ${f.answer}
Betrouwbaarheid: ${(f.confidence * 100).toFixed(0)}%${sourcesText}`;
      })
      .join('\n\n');

    const publisherPrompt = `Je bent een expert onderzoeksverslaggever. Synthetiseer de volgende onderzoeksbevindingen in een samenhangend, professioneel rapport.

ORIGINELE ONDERZOEKSVRAAG:
${originalQuery}

ONDERZOEKSBEVINDINGEN:
${findingsContext}

Schrijf een uitgebreid onderzoeksrapport met:

1. **SAMENVATTING** (2-3 alinea's)
   - Kernantwoord op de hoofdvraag
   - Belangrijkste bevindingen
   - Algemene conclusies

2. **GEDETAILLEERDE ANALYSE**
   - Integreer alle bevindingen in een coherent verhaal
   - Behandel alle belangrijke aspecten uit de deelvragen
   - Gebruik specifieke feiten en cijfers uit de bevindingen
   - Toon verbanden en patronen tussen verschillende bevindingen

3. **BRONVERMELDING**
   - Refereer naar bronnen waar relevant
   - Gebruik inline citaties (bijv. [Bron: ...])

4. **CONCLUSIE**
   - Beantwoord de originele vraag direct en volledig
   - Noem eventuele beperkingen of onzekerheden

Schrijf in professionele, heldere Nederlandse taal. Het rapport moet zelfstandig leesbaar zijn zonder de originele bevindingen te kennen.`;

    const response = await this.handler.callInternal(
      publisherPrompt,
      {
        provider: 'google',
        model: 'gemini-3-pro-preview',
        temperature: 0.7, // Lower for more focused synthesis
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 32768, // Large output for comprehensive report
        thinkingLevel: this.config.thinkingLevel || 'high'
      },
      {
        timeout: 300000, // 5 minutes for synthesis
        jobId: `publisher-${Date.now()}`
      }
    );

    // Collect all unique sources
    const allSources: Source[] = [];
    const seenUrls = new Set<string>();

    findings.forEach(f => {
      f.sources.forEach(source => {
        const key = source.url || source.title;
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          allSources.push(source);
        }
      });
    });

    return {
      query: originalQuery,
      summary: this.extractSummary(response.content),
      findings,
      synthesis: response.content,
      sources: allSources
    };
  }

  /**
   * Extract summary section from report
   */
  private extractSummary(reportText: string): string {
    // Try to extract SAMENVATTING section
    const summaryMatch = reportText.match(/\*\*SAMENVATTING\*\*\s*([\s\S]*?)(?=\n\*\*|$)/i);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }

    // Fallback: Use first 500 characters
    return reportText.substring(0, 500) + '...';
  }
}
