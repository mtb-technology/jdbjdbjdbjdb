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
  Source,
  ReportDepth
} from './types';

/**
 * Depth-specific configuration for research output
 */
interface DepthSettings {
  executorWords: { min: number; max: number };
  publisherSummaryWords: { min: number; max: number };
  publisherAnalysisWords: { min: number; max: number };
  publisherImplicationsWords: { min: number; max: number };
  publisherConclusionWords: { min: number; max: number };
  publisherTotalWords: number;
  finalReportWords: { min: number; max: number };
  thinkingLevel: 'high' | 'medium' | 'low';
}

const DEPTH_SETTINGS: Record<ReportDepth, DepthSettings> = {
  concise: {
    // Target: 3-5 pagina's (~1500-2500 woorden)
    executorWords: { min: 400, max: 600 },
    publisherSummaryWords: { min: 200, max: 400 },
    publisherAnalysisWords: { min: 600, max: 1000 },
    publisherImplicationsWords: { min: 200, max: 400 },
    publisherConclusionWords: { min: 150, max: 250 },
    publisherTotalWords: 1500,
    finalReportWords: { min: 1500, max: 2500 },
    thinkingLevel: 'low'
  },
  balanced: {
    // Target: 6-10 pagina's (~3000-5000 woorden)
    executorWords: { min: 600, max: 1000 },
    publisherSummaryWords: { min: 400, max: 600 },
    publisherAnalysisWords: { min: 1200, max: 2000 },
    publisherImplicationsWords: { min: 400, max: 700 },
    publisherConclusionWords: { min: 250, max: 400 },
    publisherTotalWords: 3000,
    finalReportWords: { min: 3000, max: 5000 },
    thinkingLevel: 'medium'
  },
  comprehensive: {
    // Target: 10-15 pagina's (~5000-7500 woorden)
    executorWords: { min: 1000, max: 1500 },
    publisherSummaryWords: { min: 600, max: 1000 },
    publisherAnalysisWords: { min: 2000, max: 3000 },
    publisherImplicationsWords: { min: 700, max: 1200 },
    publisherConclusionWords: { min: 400, max: 600 },
    publisherTotalWords: 5000,
    finalReportWords: { min: 5000, max: 7500 },
    thinkingLevel: 'high'
  }
};

export class ResearchOrchestrator {
  private handler: GoogleAIHandler;
  private config: ResearchConfig;
  private depthSettings: DepthSettings;
  private languageInstruction: string;

  constructor(apiKey: string, config: Partial<ResearchConfig> = {}) {
    // Pass true to skip deep research (prevent circular dependency)
    this.handler = new GoogleAIHandler(apiKey, true);
    const reportDepth = config.reportDepth || 'balanced';
    this.depthSettings = DEPTH_SETTINGS[reportDepth];

    this.config = {
      maxQuestions: 5,
      parallelExecutors: 3,
      useGrounding: true,
      thinkingLevel: this.depthSettings.thinkingLevel,
      temperature: 1.0,
      maxOutputTokens: 8192,
      timeout: 1800000, // 30 minutes
      reportDepth,
      reportLanguage: 'nl',
      ...config
    };

    // Simple language instruction prefix for English reports
    this.languageInstruction = this.config.reportLanguage === 'en'
      ? '**IMPORTANT: Write ALL output in English.**\n\n'
      : '';

    console.log(`[ResearchOrchestrator] Initialized with depth: ${reportDepth}, language: ${this.config.reportLanguage}`);
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

      // PHASE 3: PUBLISHER - Synthesize research findings
      progressCallback?.({
        stage: 'publishing',
        message: 'Synthetiseren van onderzoeksresultaten...',
        progress: 85
      });

      const researchReport = await this.publishReport(query, findings);
      totalTokens += 4000; // Estimate for synthesis

      // PHASE 4: FINAL SYNTHESIS - Generate final report using original prompt
      progressCallback?.({
        stage: 'finalizing',
        message: 'Genereren van eindrapport volgens promptinstructies...',
        progress: 92
      });

      const finalReport = await this.generateFinalReport(query, researchReport, findings);
      totalTokens += 8000; // Estimate for final report

      const duration = Date.now() - startTime;

      progressCallback?.({
        stage: 'complete',
        message: 'Deep research voltooid',
        progress: 100,
        findings
      });

      return {
        ...finalReport,
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
    const plannerPrompt = `${this.languageInstruction}Je bent een expert onderzoeksplanner. Analyseer de volgende onderzoeksvraag en genereer ${this.config.maxQuestions} specifieke, gefocuste deelvragen die samen een volledig antwoord kunnen geven.

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
    const { min: minWords, max: maxWords } = this.depthSettings.executorWords;

    const researchPrompt = `${this.languageInstruction}Je bent een fiscaal onderzoeker die onderzoek doet voor een professioneel adviesrapport. Beantwoord de volgende onderzoeksvraag.

ONDERZOEKSVRAAG:
${question.question}

VERWACHTE SCOPE:
${question.expectedScope}

**VEREISTE DIEPGANG - Geef een antwoord van ${minWords}-${maxWords} woorden met:**

1. **DIRECTE BEANTWOORDING**
   - Kernantwoord op de vraag
   - Relevante wettelijke bepalingen (artikelnummers, regelingen)
   - Actuele tarieven, percentages, drempels

2. **CONTEXT**
   - Achtergrond en doel van de regeling
   - Voorwaarden en uitzonderingen
   - Recente wijzigingen in wetgeving (2024-2025)

3. **PRAKTISCHE TOEPASSING**
   - Concrete voorbeelden met cijfers waar relevant
   - Valkuilen en aandachtspunten

4. **BRONNEN**
   - Noem expliciet elke bron die je gebruikt
   - Geef waar mogelijk URLs of referenties

**BELANGRIJK:** Dit onderzoek wordt gebruikt voor een professioneel fiscaal adviesrapport. Wees specifiek en concreet.`;

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

    const ds = this.depthSettings;
    const publisherPrompt = `${this.languageInstruction}Je bent een expert onderzoeksverslaggever gespecialiseerd in fiscale rapportages. Synthetiseer de volgende onderzoeksbevindingen in een professioneel onderzoeksrapport.

ORIGINELE ONDERZOEKSVRAAG:
${originalQuery}

ONDERZOEKSBEVINDINGEN:
${findingsContext}

**INSTRUCTIES VOOR HET ONDERZOEKSRAPPORT:**

Dit tussenrapport dient als basis voor het eindrapport.

**VEREISTE STRUCTUUR EN DIEPGANG:**

1. **SAMENVATTING** (${ds.publisherSummaryWords.min}-${ds.publisherSummaryWords.max} woorden)
   - Kernantwoord op de hoofdvraag met concrete conclusies
   - Belangrijkste bevindingen per deelgebied
   - Concrete cijfers, percentages en bedragen waar beschikbaar

2. **ANALYSE PER ONDERWERP** (${ds.publisherAnalysisWords.min}-${ds.publisherAnalysisWords.max} woorden)
   - Behandel elke bevinding in een eigen subsectie
   - Wettelijke basis (artikelen, regelingen)
   - Concrete voorbeelden uit de casus
   - Vergelijk alternatieven waar relevant

3. **PRAKTISCHE IMPLICATIES** (${ds.publisherImplicationsWords.min}-${ds.publisherImplicationsWords.max} woorden)
   - Concrete actiepunten
   - Benodigde documentatie
   - Valkuilen en aandachtspunten

4. **BRONVERMELDING**
   - Inline citaties bij claims [Bron: naam]
   - Bronnenlijst aan het einde

5. **CONCLUSIE** (${ds.publisherConclusionWords.min}-${ds.publisherConclusionWords.max} woorden)
   - Directe beantwoording van de vraag
   - Prioritering van aanbevelingen

**SCHRIJFSTIJL:**
- Professioneel en helder Nederlands
- Gebruik tabellen voor vergelijkingen waar nuttig
- Vermijd vage termen - wees SPECIFIEK
- Het rapport moet MINSTENS ${ds.publisherTotalWords} woorden bevatten`;

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

  /**
   * FINAL SYNTHESIS: Generate the final report using original prompt instructions
   * This takes the research findings and generates a proper report following the prompt format
   */
  private async generateFinalReport(
    originalQuery: string,
    researchReport: Omit<ResearchReport, 'metadata'>,
    findings: ResearchFinding[]
  ): Promise<Omit<ResearchReport, 'metadata'>> {
    // Build context from research findings
    const researchContext = findings
      .map((f, idx) => {
        const sourcesText = f.sources.length > 0
          ? `\nBronnen: ${f.sources.map(s => s.title).join(', ')}`
          : '';
        return `### Onderzoeksresultaat ${idx + 1}: ${f.question}\n${f.answer}${sourcesText}`;
      })
      .join('\n\n');

    // The final synthesis prompt - uses the original query (which contains the prompt instructions)
    // and enriches it with research findings
    const { min: minWords, max: maxWords } = this.depthSettings.finalReportWords;
    const depthLabel = this.config.reportDepth === 'concise' ? 'beknopt' :
                       this.config.reportDepth === 'comprehensive' ? 'uitgebreid' : 'gebalanceerd';

    const finalPrompt = `${this.languageInstruction}${originalQuery}

---
## AANVULLENDE ONDERZOEKSRESULTATEN (gebruik deze informatie bij het schrijven van het rapport)

De volgende informatie is verzameld via onderzoek met actuele bronnen. Integreer deze bevindingen in het rapport waar relevant:

${researchContext}

---
## BRONVERMELDING

${researchReport.sources.map((s, i) => `${i + 1}. ${s.title}${s.url ? ` - ${s.url}` : ''}`).join('\n')}

---

**BELANGRIJKE INSTRUCTIE:** Schrijf nu een ${depthLabel} rapport volgens de instructies hierboven. Dit is een professioneel fiscaal adviesrapport.

**VEREISTE DIEPGANG EN LENGTE:**
- Het rapport moet ${minWords}-${maxWords} woorden bevatten
- Gebruik de onderzoeksresultaten waar relevant
- Elk fiscaal standpunt moet worden onderbouwd met wettelijke basis

**STRUCTUUR-EISEN:**
1. De structuur van de originele prompt volgen
2. De onderzoeksresultaten integreren in de relevante secties
3. Professioneel en samenhangend geschreven
4. Eindigen met een apart hoofdstuk "Bronnen"

${this.config.polishPrompt ? `---
## POLIJST INSTRUCTIES (pas dit toe op het eindrapport)

${this.config.polishPrompt}

---
` : ''}Begin direct met het rapport (geen meta-commentaar over het proces). Eindig ALTIJD met:

### Bronnen
[Lijst van alle geraadpleegde bronnen met URL waar beschikbaar]`;

    console.log(`[ResearchOrchestrator] Generating final report with enriched context...`);

    const response = await this.handler.callInternal(
      finalPrompt,
      {
        provider: 'google',
        model: 'gemini-3-pro-preview',
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 32768,
        thinkingLevel: this.config.thinkingLevel || 'high'
      },
      {
        timeout: 300000, // 5 minutes
        jobId: `final-synthesis-${Date.now()}`,
        useGrounding: false // No grounding needed, we already have research
      }
    );

    console.log(`[ResearchOrchestrator] Final report generated: ${response.content.length} chars`);

    return {
      query: originalQuery,
      summary: this.extractSummary(response.content),
      findings,
      synthesis: response.content, // This is now the final polished report
      sources: researchReport.sources
    };
  }
}
