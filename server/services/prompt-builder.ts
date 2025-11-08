import type { DossierData, BouwplanData } from "@shared/schema";

/**
 * StagePromptConfig interface
 */
export interface StagePromptConfig {
  prompt: string;
  useGrounding?: boolean;
  useWebSearch?: boolean;
}

/**
 * PromptBuilder - Template Method Pattern voor Stage Prompts
 *
 * Centraliseert de duplicated prompt-building logica door een uniforme
 * structuur te bieden voor alle stages:
 * - systemPrompt = stageConfig.prompt + datum
 * - userInput = stage-specifieke data extractie
 *
 * Voordelen:
 * - DRY: Geen gedupliceerde datum-formatting
 * - Consistentie: Elke stage volgt hetzelfde patroon
 * - Testbaarheid: Geïsoleerde functies per stage
 * - Onderhoudbaarheid: Wijzig de template op 1 plek
 */
export class PromptBuilder {
  /**
   * Build a prompt for any stage using the Template Method Pattern
   */
  build<TData>(
    stageName: string,
    stageConfig: StagePromptConfig,
    dataExtractor: () => TData
  ): { systemPrompt: string; userInput: string } {
    const currentDate = this.formatCurrentDate();
    const systemPrompt = this.buildSystemPrompt(stageConfig.prompt, currentDate);
    const userInput = this.stringifyData(dataExtractor());

    return { systemPrompt, userInput };
  }

  /**
   * Build a combined prompt (system + user in one string)
   * Used for stages like 6_change_summary and editor
   */
  buildCombined<TData>(
    stageName: string,
    stageConfig: StagePromptConfig,
    dataExtractor: () => TData
  ): string {
    const result = this.build(stageName, stageConfig, dataExtractor);
    return `${result.systemPrompt}\n\n### USER INPUT:\n${result.userInput}`;
  }

  /**
   * Format current date in Dutch locale
   */
  private formatCurrentDate(): string {
    return new Date().toLocaleDateString('nl-NL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Build system prompt with consistent formatting
   */
  private buildSystemPrompt(basePrompt: string, currentDate: string): string {
    return `${basePrompt}\n\n### Datum: ${currentDate}`;
  }

  /**
   * Stringify data for userInput (handles strings, objects, etc.)
   */
  private stringifyData<T>(data: T): string {
    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'object' && data !== null) {
      return JSON.stringify(data, null, 2);
    }

    return String(data);
  }

  // ===== STAGE-SPECIFIC DATA EXTRACTORS =====

  /**
   * Extract data for Stage 1: Informatiecheck
   */
  buildInformatieCheckData(dossier: DossierData): string {
    return dossier.rawText || JSON.stringify({
      klant: dossier.klant,
      situatie: dossier.klant?.situatie || ''
    }, null, 2);
  }

  /**
   * Extract data for Stage 2: Complexiteitscheck
   */
  buildComplexiteitsCheckData(previousStageResults: Record<string, string>): string {
    return previousStageResults?.['1_informatiecheck'] || '{}';
  }

  /**
   * Extract data for Stage 3: Generatie
   */
  buildGeneratieData(previousStageResults: Record<string, string>): string {
    return previousStageResults?.['2_complexiteitscheck'] || '{}';
  }

  /**
   * Extract data for Reviewer Stages (4a-4f)
   */
  buildReviewerData(
    previousStageResults: Record<string, string>,
    dossier: DossierData,
    bouwplan: BouwplanData
  ): string {
    const step3Output = previousStageResults?.['3_generatie'] || '{}';

    try {
      // Try to parse as JSON first
      const jsonStep3 = JSON.parse(step3Output);
      return JSON.stringify({
        ...jsonStep3,
        dossier_context: dossier,
        bouwplan_context: bouwplan
      }, null, 2);
    } catch {
      // Fallback: create structured JSON
      return JSON.stringify({
        taal: "nl",
        concept_rapport_tekst: step3Output,
        dossier_context: dossier,
        bouwplan_context: bouwplan
      }, null, 2);
    }
  }

  /**
   * Extract data for Change Summary Stage (6)
   */
  buildChangeSummaryData(conceptReportVersions: Record<string, string>): string {
    const versions = Object.entries(conceptReportVersions)
      .filter(([key]) => !['latest', 'history'].includes(key))
      .map(([stage, content]) => ({
        stage,
        contentLength: typeof content === 'string' ? content.length : JSON.stringify(content).length,
        preview: typeof content === 'string'
          ? content.substring(0, 200)
          : JSON.stringify(content).substring(0, 200)
      }));

    return JSON.stringify({ versions }, null, 2);
  }

  /**
   * Extract data for Editor Stage (5)
   */
  buildEditorData(
    previousStageResults: Record<string, string>,
    conceptReportVersions: Record<string, string>
  ): string {
    // Get all reviewer feedback
    const reviewerFeedback = {
      '4a_BronnenSpecialist': previousStageResults?.['4a_BronnenSpecialist'],
      '4b_FiscaalTechnischSpecialist': previousStageResults?.['4b_FiscaalTechnischSpecialist'],
      '4c_ScenarioGatenAnalist': previousStageResults?.['4c_ScenarioGatenAnalist'],
      '4d_DeVertaler': previousStageResults?.['4d_DeVertaler'],
      '4e_DeAdvocaat': previousStageResults?.['4e_DeAdvocaat'],
      '4f_DeKlantpsycholoog': previousStageResults?.['4f_DeKlantpsycholoog']
    };

    // Get latest concept version
    const latestConceptKey = Object.keys(conceptReportVersions)
      .filter(key => !['latest', 'history'].includes(key))
      .pop();

    const latestConcept = latestConceptKey
      ? conceptReportVersions[latestConceptKey]
      : '';

    return JSON.stringify({
      reviewer_feedback: reviewerFeedback,
      latest_concept_report: latestConcept
    }, null, 2);
  }
}
