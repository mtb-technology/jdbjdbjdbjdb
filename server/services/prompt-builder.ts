import type { DossierData, BouwplanData } from "@shared/schema";

/**
 * StagePromptConfig interface - configuratie per stage
 *
 * Dit definieert WAT een stage moet doen (de prompt) en HOE (grounding, web search).
 */
export interface StagePromptConfig {
  /** De AI instructies voor deze stage (bv. "Je bent een BronnenSpecialist...") */
  prompt: string;
  /** Gebruik Google Search Grounding voor fact-checking (alleen Google/Gemini) */
  useGrounding?: boolean;
  /** Gebruik web search voor real-time informatie (alleen OpenAI) */
  useWebSearch?: boolean;
}

/**
 * ## PromptBuilder - De "Instructie Fabriek" voor AI Specialists
 *
 * **Design Pattern**: Template Method Pattern
 *
 * **Probleem**: Elke AI stage heeft een unieke prompt EN unieke data nodig.
 * Dit leidde tot gedupliceerde code in ReportGenerator met copy-paste prompts.
 *
 * **Oplossing**: Centraliseer de prompt-building logica in één class.
 *
 * ### Hoe het werkt:
 *
 * ```typescript
 * // Oud (gedupliceerde code):
 * const stage1Prompt = `${stageConfig.prompt}\n\n### Datum: ${currentDate}\n\n${dossierDataJSON}`;
 * const stage2Prompt = `${stageConfig.prompt}\n\n### Datum: ${currentDate}\n\n${stage1Results}`;
 * // ... herhaalt voor elke stage
 *
 * // Nieuw (DRY):
 * const stage1Prompt = promptBuilder.build("1_informatiecheck", stageConfig, () =>
 *   promptBuilder.buildInformatieCheckData(dossier)
 * );
 * ```
 *
 * ### Structuur van een Prompt:
 *
 * Elke prompt bestaat uit **twee delen**:
 *
 * 1. **System Prompt** (de instructies):
 *    ```
 *    Je bent een Bronnen Specialist. Jouw taak is...
 *    [Uit stageConfig.prompt]
 *
 *    ### Datum: dinsdag 10 november 2025
 *    ```
 *
 * 2. **User Input** (de data):
 *    ```json
 *    {
 *      "taal": "nl",
 *      "concept_rapport_tekst": "...",
 *      "dossier_context": { ... }
 *    }
 *    ```
 *
 * ### Voordelen:
 * - **DRY**: Geen gedupliceerde datum-formatting
 * - **Consistentie**: Elke stage volgt hetzelfde patroon
 * - **Testbaarheid**: Data extractors zijn geïsoleerde pure functions
 * - **Onderhoudbaarheid**: Wijzig de template op 1 plek
 * - **Type Safety**: TypeScript zorgt dat je de juiste data meegeeft
 *
 * @example
 * ```typescript
 * const promptBuilder = new PromptBuilder();
 *
 * // Voor Stage 1 (Informatiecheck)
 * const stage1Prompt = promptBuilder.build("1_informatiecheck", stageConfig, () =>
 *   promptBuilder.buildInformatieCheckData(dossier)
 * );
 *
 * // Voor reviewer stages (4a-4f)
 * const reviewerPrompt = promptBuilder.build("4a_BronnenSpecialist", stageConfig, () =>
 *   promptBuilder.buildReviewerData(conceptReport, dossier, bouwplan)
 * );
 * ```
 */
export class PromptBuilder {
  /**
   * **Template Method**: Bouw een prompt voor elke stage
   *
   * Dit is de KERN van de PromptBuilder. Het combineert:
   * 1. Stage configuratie (de instructies vanuit database)
   * 2. Data extractor (stage-specifieke data formatting)
   * 3. Datum (voor context)
   *
   * @param stageName - Voor logging (niet gebruikt in output)
   * @param stageConfig - De stage configuratie vanuit promptConfigs tabel
   * @param dataExtractor - Een functie die de relevante data voor deze stage extraheert
   * @returns Object met `systemPrompt` (instructies) en `userInput` (data)
   *
   * @example
   * ```typescript
   * const prompt = builder.build("4a_BronnenSpecialist", stageConfig, () =>
   *   builder.buildReviewerData(conceptReport, dossier, bouwplan)
   * );
   * // Returns:
   * // {
   * //   systemPrompt: "Je bent een Bronnen Specialist...\n\n### Datum: ...",
   * //   userInput: '{"taal":"nl","concept_rapport_tekst":"..."}'
   * // }
   * ```
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
   * **Convenience Method**: Bouw een gecombineerde prompt (system + user in één string)
   *
   * Sommige legacy stages (6_change_summary, editor) verwachten één string
   * in plaats van gescheiden system/user prompts.
   *
   * @param stageName - Voor logging
   * @param stageConfig - De stage configuratie
   * @param dataExtractor - Data extractor functie
   * @returns Single string met system prompt + user input
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
   *
   * ⚠️ DOUBLE-WRAPPING DETECTION: This method detects if data is already JSON-stringified
   * to prevent the same bug pattern that caused issues in feedback processing.
   */
  private stringifyData<T>(data: T): string {
    if (typeof data === 'string') {
      // ✅ FIX: Detect if string is already JSON to prevent double-wrapping
      const trimmed = data.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          JSON.parse(trimmed);
          console.warn('⚠️ [PromptBuilder] WARNING: Data appears to be pre-stringified JSON!');
          console.warn('   This may cause double-wrapping bugs. Pass objects instead of strings.');
          console.warn('   String preview:', trimmed.substring(0, 100) + '...');
        } catch {
          // Not valid JSON, safe to use as plain string
        }
      }
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
   * **KRITIEK**: Extract data voor Reviewer Stages (4a-4f)
   *
   * Dit is een van de BELANGRIJKSTE functies in het hele systeem.
   * Het bepaalt wat elke specialist ZI ET tijdens hun review.
   *
   * ### Wat krijgt een reviewer te zien?
   *
   * 1. **Het concept rapport** (de tekst die moet worden gereviewd)
   * 2. **Dossier context** (wie is de klant, wat is de vraag?)
   * 3. **Bouwplan context** (welke structuur moet het rapport hebben?)
   *
   * ### Waarom is dit kritiek?
   *
   * **FOUT** (oud systeem):
   * ```typescript
   * // Gaf de STAGE RESULTS door (JSON data over het rapport)
   * // Specialist zag NIET de actual tekst!
   * reviewerInput = previousStageResults['3_generatie']
   * ```
   *
   * **CORRECT** (huidig systeem):
   * ```typescript
   * // Geeft het CONCEPT RAPPORT door (de daadwerkelijke tekst)
   * reviewerInput = conceptReportVersions['3_generatie'].content
   * ```
   *
   * ### Format:
   *
   * Reviewers krijgen JSON met drie secties:
   * ```json
   * {
   *   "taal": "nl",
   *   "concept_rapport_tekst": "# Fiscaal Advies\n\n[De daadwerkelijke rapport tekst van 5000+ woorden]",
   *   "dossier_context": {
   *     "klant": { "naam": "...", "situatie": "..." },
   *     "fiscale_gegevens": { ... }
   *   },
   *   "bouwplan_context": {
   *     "taal": "nl",
   *     "structuur": { ... }
   *   }
   * }
   * ```
   *
   * @param conceptReport - Het concept rapport tekst (van Stage 3 of vorige specialist)
   * @param dossier - De klant data (voor context)
   * @param bouwplan - De rapport structuur (voor conformance checking)
   * @returns JSON string met concept + context
   */
  buildReviewerData(
    conceptReport: string,
    dossier: DossierData,
    bouwplan: BouwplanData
  ): string {
    // ✅ KRITIEK: Verwijder rawText uit dossier context
    // rawText is alleen nodig in Stage 1, daarna niet meer
    const { rawText, ...cleanDossier } = dossier;

    try {
      // Try to parse concept report as JSON first
      const jsonConcept = JSON.parse(conceptReport);
      return JSON.stringify({
        ...jsonConcept,
        dossier_context: cleanDossier,
        bouwplan_context: bouwplan
      }, null, 2);
    } catch {
      // Fallback: treat as plain text report
      return JSON.stringify({
        concept_rapport_tekst: conceptReport,
        dossier_context: cleanDossier,
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
      '4e_DeAdvocaat': previousStageResults?.['4e_DeAdvocaat'],
      '4f_HoofdCommunicatie': previousStageResults?.['4f_HoofdCommunicatie']
    };

    // Get latest concept report - prioritize 'latest', then '3_generatie', then any other key
    const latestConcept = conceptReportVersions?.['latest']
      || conceptReportVersions?.['3_generatie']
      || Object.values(conceptReportVersions).find(v => v)
      || '';

    console.log('[Editor Data] Concept report length:', latestConcept.length);
    console.log('[Editor Data] Reviewer feedback keys:', Object.keys(reviewerFeedback).filter(k => reviewerFeedback[k as keyof typeof reviewerFeedback]));

    return JSON.stringify({
      reviewer_feedback: reviewerFeedback,
      latest_concept_report: latestConcept
    }, null, 2);
  }
}
