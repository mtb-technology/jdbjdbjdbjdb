import type { DossierData, BouwplanData } from "@shared/schema";
import type { StageResults, ConceptReportVersions } from "@shared/types/report-data";
import { extractSnapshotContent } from "@shared/types/report-data";

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
 * const stage1Prompt = promptBuilder.build("1a_informatiecheck", stageConfig, () =>
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
 * // Voor Stage 1a (Informatiecheck Analyse)
 * const stage1Prompt = promptBuilder.build("1a_informatiecheck", stageConfig, () =>
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
   * Extract data for Stage 1a: Informatiecheck
   *
   * Bij een RE-RUN wordt de vorige analyse meegenomen zodat de AI:
   * - Weet wat er al was geanalyseerd
   * - Nieuwe info kan toevoegen aan het bestaande beeld
   * - Een accumulerende "sessie" bouwt over meerdere runs
   */
  buildInformatieCheckData(dossier: DossierData, previousStageResults?: StageResults): string {
    const currentDossierData = dossier.rawText || JSON.stringify({
      klant: dossier.klant,
      situatie: dossier.klant?.situatie || ''
    }, null, 2);

    // Check if this is a re-run (previous 1a result exists)
    const previousAnalysis = previousStageResults?.['1a_informatiecheck'];

    if (previousAnalysis) {
      // RE-RUN: Include previous analysis as context
      return `### VORIGE ANALYSE (uit eerdere run):
${previousAnalysis}

### NIEUWE/AANVULLENDE INFORMATIE:
Analyseer het volledige dossier opnieuw, inclusief eventuele nieuwe bijlages die zijn toegevoegd.
Bouw voort op de vorige analyse - als informatie die eerder ontbrak nu WEL aanwezig is, markeer dit als opgelost.

### HUIDIG DOSSIER:
${currentDossierData}`;
    }

    // First run: just the dossier data
    return currentDossierData;
  }

  /**
   * Extract data for Stage 1b: Informatie Email (only runs if 1a returns INCOMPLEET)
   * Passes the 1a analysis result to the email generator
   */
  buildInformatieEmailData(previousStageResults: StageResults): string {
    return previousStageResults?.['1a_informatiecheck'] || '{}';
  }

  /**
   * Extract data for Stage 2: Complexiteitscheck
   */
  buildComplexiteitsCheckData(previousStageResults: StageResults): string {
    return previousStageResults?.['1a_informatiecheck'] || '{}';
  }

  /**
   * Extract data for Stage 3: Generatie
   */
  buildGeneratieData(previousStageResults: StageResults): string {
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
  buildChangeSummaryData(conceptReportVersions: ConceptReportVersions): string {
    const versions = Object.entries(conceptReportVersions)
      .filter(([key]) => !['latest', 'history'].includes(key))
      .map(([stage, content]) => {
        const extractedContent = extractSnapshotContent(content);
        return {
          stage,
          contentLength: extractedContent?.length ?? 0,
          preview: extractedContent?.substring(0, 200) ?? ''
        };
      });

    return JSON.stringify({ versions }, null, 2);
  }

  /**
   * Extract data for Editor Stage (5)
   */
  buildEditorData(
    previousStageResults: StageResults,
    conceptReportVersions: ConceptReportVersions
  ): string {
    // Get all reviewer feedback
    const reviewerFeedback = {
      '4a_BronnenSpecialist': previousStageResults?.['4a_BronnenSpecialist'],
      '4b_FiscaalTechnischSpecialist': previousStageResults?.['4b_FiscaalTechnischSpecialist'],
      '4c_ScenarioGatenAnalist': previousStageResults?.['4c_ScenarioGatenAnalist'],
      '4e_DeAdvocaat': previousStageResults?.['4e_DeAdvocaat'],
      '4f_HoofdCommunicatie': previousStageResults?.['4f_HoofdCommunicatie']
    };

    // Get latest concept report - use extractSnapshotContent for type safety
    const latestSnapshot = conceptReportVersions?.latest;
    let latestConcept = '';

    if (latestSnapshot && typeof latestSnapshot === 'object' && 'pointer' in latestSnapshot && latestSnapshot.pointer) {
      latestConcept = extractSnapshotContent(conceptReportVersions[latestSnapshot.pointer]) ?? '';
    }
    if (!latestConcept) {
      latestConcept = extractSnapshotContent(conceptReportVersions?.['3_generatie']) ?? '';
    }

    console.log('[Editor Data] Concept report length:', latestConcept.length);
    console.log('[Editor Data] Reviewer feedback keys:', Object.keys(reviewerFeedback).filter(k => reviewerFeedback[k as keyof typeof reviewerFeedback]));

    return JSON.stringify({
      reviewer_feedback: reviewerFeedback,
      latest_concept_report: latestConcept
    }, null, 2);
  }

  /**
   * Extract data for Stage 7: Fiscale Briefing
   *
   * Combines all available context to generate an executive summary:
   * - Dossier data (client info, fiscal data)
   * - Bouwplan (analysis from Stage 2)
   * - Final report (from Stage 3 + reviewer modifications)
   * - All reviewer feedback (4a-4f)
   *
   * This gives the AI everything it needs to create a comprehensive briefing
   * that explains the case, strategy, decisions, and review findings.
   *
   * IMPORTANT: Reviewer feedback contains OBSERVATIONS that were SUCCESSFULLY
   * processed by Express Mode. They are NOT errors or failures. The feedback
   * describes what each specialist found and suggested - these suggestions
   * have already been incorporated into the final report.
   */
  buildFiscaleBriefingData(
    dossier: DossierData,
    bouwplan: BouwplanData | null,
    conceptReport: string | null,
    stageResults: StageResults
  ): object {
    // For briefing, we KEEP rawText if structured data is minimal
    // This ensures we can still brief on early-stage cases
    const { rawText, ...structuredDossier } = dossier;

    // Check if structured data has meaningful content
    const hasStructuredContent =
      (dossier?.klant?.situatie?.length || 0) > 50 ||
      (dossier?.fiscale_gegevens?.vermogen || 0) > 0;

    // Debug: Log what data we're working with
    console.log('📋 [FiscaleBriefing] Dossier data received:', {
      hasKlant: !!dossier?.klant,
      klantNaam: dossier?.klant?.naam || 'MISSING',
      hasSituatie: !!dossier?.klant?.situatie,
      situatieLength: dossier?.klant?.situatie?.length || 0,
      hasFiscaleGegevens: !!dossier?.fiscale_gegevens,
      vermogen: dossier?.fiscale_gegevens?.vermogen,
      inkomsten: dossier?.fiscale_gegevens?.inkomsten,
      hasRawText: !!rawText,
      rawTextLength: rawText?.length || 0,
      hasStructuredContent,
      willIncludeRawText: !hasStructuredContent && !!rawText
    });

    // Determine workflow phase based on available data
    const hasReport = !!conceptReport && conceptReport.trim().length > 0;
    const hasBouwplan = !!bouwplan;
    const hasStage1 = !!stageResults?.['1a_informatiecheck'];
    const hasStage2 = !!stageResults?.['2_complexiteitscheck'];

    // Define all possible reviewers with their descriptions
    const reviewerDefinitions = {
      '4a_BronnenSpecialist': {
        naam: 'Bronnen Specialist',
        focus: 'Controle van bronverwijzingen en citaten'
      },
      '4b_FiscaalTechnischSpecialist': {
        naam: 'Fiscaal Technisch Specialist',
        focus: 'Technische fiscale correctheid van berekeningen en regelgeving'
      },
      '4c_ScenarioGatenAnalist': {
        naam: 'Scenario & Gaten Analist',
        focus: 'Blinde vlekken, impliciete aannames, alternatieve scenarios'
      },
      '4e_DeAdvocaat': {
        naam: 'De Advocaat (Juridisch)',
        focus: 'Juridische risicos, garantietaal, claims'
      },
      '4f_HoofdCommunicatie': {
        naam: 'Hoofd Communicatie',
        focus: 'Schrijfstijl, toon, leesbaarheid'
      }
    };

    // Build reviewer summary with status
    const reviewerSummary: Record<string, {
      naam: string;
      focus: string;
      status: 'uitgevoerd' | 'niet_uitgevoerd';
      feedback: string | null;
      toelichting: string;
    }> = {};

    for (const [stageId, def] of Object.entries(reviewerDefinitions)) {
      const feedback = stageResults?.[stageId] || null;
      reviewerSummary[stageId] = {
        naam: def.naam,
        focus: def.focus,
        status: feedback ? 'uitgevoerd' : 'niet_uitgevoerd',
        feedback: feedback,
        toelichting: feedback
          ? 'Review is succesvol uitgevoerd. De bevindingen hieronder zijn observaties/suggesties die REEDS VERWERKT zijn in het eindrapport.'
          : 'Deze review stap is niet uitgevoerd (optioneel of overgeslagen).'
      };
    }

    // Count how many reviewers actually ran
    const aantalUitgevoerd = Object.values(reviewerSummary).filter(r => r.status === 'uitgevoerd').length;

    // Determine workflow phase and description
    let workflowFase: 'intake' | 'analyse' | 'concept' | 'reviewed';
    let workflowBeschrijving: string;

    if (hasReport && aantalUitgevoerd > 0) {
      workflowFase = 'reviewed';
      workflowBeschrijving = 'Express Mode heeft het rapport automatisch gegenereerd en door meerdere AI reviewers geleid. Elke reviewer heeft feedback gegeven die DIRECT VERWERKT is in het eindrapport. De feedback hieronder zijn dus HISTORISCHE observaties - het rapport is al bijgewerkt.';
    } else if (hasReport) {
      workflowFase = 'concept';
      workflowBeschrijving = 'Er is een concept rapport gegenereerd (Stap 3). De review stappen zijn nog niet uitgevoerd. Baseer je briefing op het dossier, bouwplan en concept rapport.';
    } else if (hasBouwplan || hasStage2) {
      workflowFase = 'analyse';
      workflowBeschrijving = 'De analyse fase (Stap 2) is voltooid. Er is een bouwplan opgesteld maar nog geen rapport gegenereerd. Baseer je briefing op het dossier en het bouwplan/analyse. Geef aan welke velden je niet kunt invullen omdat er nog geen rapport is.';
    } else {
      workflowFase = 'intake';
      workflowBeschrijving = 'Dit is een VROEGE briefing na Stap 1 (informatiecheck). Er is alleen dossier informatie beschikbaar. Maak een eerste intake briefing gebaseerd op de beschikbare klantgegevens. Geef duidelijk aan welke secties nog niet ingevuld kunnen worden.';
    }

    // Build dossier context - include rawText if structured data is minimal
    const dossierContext = hasStructuredContent
      ? structuredDossier  // Structured data is good, no need for raw text
      : {
          ...structuredDossier,
          // Include raw intake text for early-stage briefings
          originele_intake_tekst: rawText || null,
          _opmerking: 'Gestructureerde data is minimaal. Gebruik de originele_intake_tekst voor context.'
        };

    return {
      // Client and case context
      dossier_context: dossierContext,

      // Analysis structure from Stage 2 (may be null in early phases)
      bouwplan_analyse: bouwplan || null,

      // The final report content (null if not yet generated)
      gegenereerd_rapport: conceptReport || null,

      // Important context for the briefing AI
      workflow_uitleg: {
        fase: workflowFase,
        beschrijving: workflowBeschrijving,
        beschikbare_data: {
          dossier: true,
          dossier_gestructureerd: hasStructuredContent,
          dossier_raw_text: !hasStructuredContent && !!rawText,
          bouwplan: hasBouwplan,
          rapport: hasReport,
          stage1_compleet: hasStage1,
          stage2_compleet: hasStage2
        },
        reviewers_uitgevoerd: aantalUitgevoerd,
        reviewers_totaal: Object.keys(reviewerDefinitions).length
      },

      // Reviewer feedback with clear context (empty if no reviews done)
      reviewer_feedback: aantalUitgevoerd > 0 ? reviewerSummary : null
    };
  }
}
