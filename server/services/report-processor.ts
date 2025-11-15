import {
  StageId,
  ConceptReportSnapshot,
  ConceptReportVersions,
  ReportProcessorInput,
  ReportProcessorOutput,
  PromptConfig,
  AiConfig
} from '@shared/schema';
import { storage } from '../storage';
import { getActivePromptConfig } from '../storage';

// Temporary AI handler interface - will integrate with existing AI system
interface AIHandler {
  generateContent(params: {
    prompt: string;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
  }): Promise<{ content: string }>;
}

/**
 * ## ReportProcessor - De "Chirurgische Redacteur"
 *
 * **Verantwoordelijkheid**: Transform specialist feedback into updated concept report versions
 *
 * Dit is het **HART van de versioning system**. Het lost het centrale probleem op:
 * "Hoe merge ik feedback van een specialist met het bestaande rapport?"
 *
 * ### Het Probleem:
 *
 * ```
 * Concept Rapport v1 (5000 woorden) + Feedback Specialist (200 woorden)
 *   ↓
 * Hoe krijg ik Concept Rapport v2?
 * ```
 *
 * **Naïeve oplossing** (FOUT):
 * ```typescript
 * newConcept = oldConcept + "\n\n" + feedback  // Append aan einde
 * ```
 * → Resultaat: Rommelig rapport met feedback onderaan (niet geïntegreerd)
 *
 * **Intelligente oplossing** (CORRECT - wat deze class doet):
 * ```typescript
 * newConcept = await AI.merge(oldConcept, feedback, mergeStrategy)
 * ```
 * → Resultaat: Feedback is GEÏNTEGREERD in de juiste secties
 *
 * ### Hoe het werkt:
 *
 * #### Stap 1: Haal Base Concept Op
 * ```typescript
 * const baseConcept = conceptReportVersions["3_generatie"].content;
 * // Of: conceptReportVersions["4a_BronnenSpecialist"].content (voor re-processing)
 * ```
 *
 * #### Stap 2: AI Merge
 * ```typescript
 * const mergePrompt = `
 * HUIDIGE RAPPORT: ${baseConcept}
 * FEEDBACK: ${feedback}
 * INSTRUCTIE: Integreer de feedback in het rapport (strategy: merge)
 * `;
 * const newConcept = await AI.generateContent(mergePrompt);
 * ```
 *
 * #### Stap 3: Save Snapshot
 * ```typescript
 * conceptReportVersions["4a_BronnenSpecialist"] = {
 *   v: 2,
 *   content: newConcept,
 *   from: "3_generatie",
 *   processedFeedback: feedback
 * };
 * ```
 *
 * ### Merge Strategies:
 *
 * - **merge** (default): Intelligente integratie door hele rapport
 * - **sectional**: Vervang alleen relevante secties
 * - **append**: Voeg toe aan einde van secties
 * - **replace**: Vervang volledig (gebruik voorzichtig!)
 *
 * ### Kritieke Features:
 *
 * 1. **Re-processing Support**:
 *    - Als een stage al een versie heeft, gebruik DIE als base (niet de predecessor)
 *    - Bijvoorbeeld: 4a al gedaan → re-run 4a → base = 4a v1 (niet 3_generatie)
 *
 * 2. **Version Chaining**:
 *    - Elke versie weet waar het vandaan komt (`from` veld)
 *    - Dit maakt step-back mogelijk
 *
 * 3. **Fallback Handling**:
 *    - Als AI merge faalt → gebruik simple append strategie
 *    - Rapport blijft altijd bruikbaar (nooit data loss)
 *
 * @see {@link ConceptReportVersions} voor version structure
 * @see {@link PromptBuilder.buildReviewerData} voor wat reviewers zien
 */
export class ReportProcessor {
  constructor(private aiHandler: AIHandler) {}

  /**
   * Process feedback from a review stage into a new concept report version
   */
  async process(input: ReportProcessorInput): Promise<ReportProcessorOutput> {
    console.log(`🔄 [ReportProcessor] Processing feedback for stage ${input.stageId}`);
    
    try {
      const newConcept = await this.mergeWithAI(input);
      
      return {
        newConcept,
        summary: `Feedback from ${input.stageId} successfully processed and integrated`
      };
    } catch (error: any) {
      console.error(`❌ [ReportProcessor] Failed to process feedback for ${input.stageId}:`, error);
      
      // Fallback to simple append strategy if AI fails
      return this.fallbackMerge(input);
    }
  }

  /**
   * AI-powered intelligent merging of feedback with existing concept report
   */
  private async mergeWithAI(input: ReportProcessorInput): Promise<string> {
    // Get active prompt config for editor prompt and AI settings
    const promptConfig = await getActivePromptConfig();
    const editorConfig = promptConfig.editor;
    const aiConfig = editorConfig?.aiConfig || promptConfig.aiConfig;

    // Build prompt using editor prompt from config
    const prompt = await this.buildMergePrompt(input, editorConfig?.prompt);

    // Use AI config from editor or fallback to global config
    const response = await this.aiHandler.generateContent({
      prompt,
      temperature: aiConfig?.temperature ?? 0.1,
      topP: aiConfig?.topP ?? 0.9,
      maxOutputTokens: aiConfig?.maxOutputTokens ?? 32768
    });

    if (!response.content) {
      throw new Error('AI response was empty');
    }

    return response.content;
  }

  /**
   * Build the AI prompt for merging feedback into concept report
   * Uses the "editor" prompt from config - THROWS if not configured (NO FALLBACKS!)
   */
  private async buildMergePrompt(input: ReportProcessorInput, editorPrompt?: string): Promise<string> {
    const { baseConcept, feedback, stageId, strategy } = input;

    // CRITICAL: NO FALLBACK PROMPTS - Quality depends on proper configuration
    if (!editorPrompt || editorPrompt.trim().length === 0) {
      throw new Error(
        `❌ FATAL: Editor prompt not configured in Settings. ` +
        `Ga naar Settings en configureer de "Editor (Chirurgische Redacteur)" prompt. ` +
        `Feedback processing is geblokkeerd tot dit is opgelost.`
      );
    }

    // Check for placeholder text
    if (editorPrompt.includes('PLACEHOLDER') || editorPrompt.toLowerCase().includes('voer hier')) {
      throw new Error(
        `❌ FATAL: Editor prompt bevat nog placeholder tekst. ` +
        `Ga naar Settings en vervang de placeholder in "Editor (Chirurgische Redacteur)" met een echte prompt. ` +
        `Feedback processing is geblokkeerd tot dit is opgelost.`
      );
    }

    // Replace placeholders in editor prompt
    return editorPrompt
      .replace(/\{baseConcept\}/g, baseConcept)
      .replace(/\{feedback\}/g, feedback)
      .replace(/\{stageId\}/g, stageId)
      .replace(/\{strategy\}/g, strategy);
  }

  /**
   * Get strategy-specific processing rules
   */
  private getStrategyRules(strategy: string): string {
    switch (strategy) {
      case 'sectional':
        return 'Vervang alleen de relevante secties met feedback, laat andere secties intact';
      case 'replace':
        return 'Vervang het volledige rapport met de feedback (gebruik voorzichtig!)';
      case 'append':
        return 'Voeg feedback toe aan het einde van relevante secties';
      case 'merge':
      default:
        return 'Integreer feedback intelligent door het hele rapport, verbeter bestaande content waar nodig';
    }
  }

  /**
   * Fallback merge strategy when AI fails
   */
  private fallbackMerge(input: ReportProcessorInput): ReportProcessorOutput {
    const { baseConcept, feedback, stageId } = input;
    
    const fallbackContent = `${baseConcept}

## ⚠️ FEEDBACK VERWERKING (${stageId})
*Let op: Automatische verwerking gefaald - handmatige integratie nodig*

${feedback}

---`;

    return {
      newConcept: fallbackContent,
      summary: `Fallback merge applied for ${stageId} - manual integration recommended`
    };
  }

  /**
   * Create a new concept report snapshot with version tracking
   */
  async createSnapshot(
    reportId: string,
    stageId: StageId,
    newContent: string,
    fromStage?: StageId,
    processedFeedback?: string
  ): Promise<ConceptReportSnapshot> {
    // Get current report to determine version number
    const report = await storage.getReport(reportId);
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    const currentVersions = report.conceptReportVersions as ConceptReportVersions || {};

    // FIXED: Check CURRENT stage version first (for re-processing same stage)
    // If current stage already has a version, increment from that
    // Otherwise, use predecessor stage version
    const currentStageVersion = this.getStageVersion(currentVersions, stageId);
    const previousVersion = currentStageVersion || (fromStage ? this.getStageVersion(currentVersions, fromStage) : null);
    const nextVersion = previousVersion ? previousVersion.v + 1 : 1;

    const snapshot: ConceptReportSnapshot = {
      v: nextVersion,
      content: newContent,
      from: fromStage,
      createdAt: new Date().toISOString(),
      processedFeedback
    };

    console.log(`📸 [ReportProcessor] Created snapshot v${nextVersion} for ${stageId} (from: ${fromStage || 'none'}, currentStageHadV${currentStageVersion?.v || 0})`);
    return snapshot;
  }

  /**
   * Update concept report versions with new snapshot and latest pointer
   */
  async updateConceptVersions(
    reportId: string,
    stageId: StageId,
    snapshot: ConceptReportSnapshot
  ): Promise<ConceptReportVersions> {
    const report = await storage.getReport(reportId);
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    const currentVersions = report.conceptReportVersions as ConceptReportVersions || {};

    // Check if this exact stageId+version combination already exists in history
    const existingHistory = currentVersions.history || [];
    const existingEntryIndex = existingHistory.findIndex(
      (entry: any) => entry.stageId === stageId && entry.v === snapshot.v
    );

    let updatedHistory;
    if (existingEntryIndex >= 0) {
      // Update existing entry's timestamp instead of creating duplicate
      updatedHistory = [...existingHistory];
      updatedHistory[existingEntryIndex] = {
        stageId,
        v: snapshot.v,
        timestamp: new Date().toISOString()
      };
      console.log(`🔄 [ReportProcessor] Updated existing history entry for ${stageId} v${snapshot.v}`);
    } else {
      // Add new entry
      updatedHistory = [
        ...existingHistory,
        {
          stageId,
          v: snapshot.v,
          timestamp: new Date().toISOString()
        }
      ];
      console.log(`➕ [ReportProcessor] Added new history entry for ${stageId} v${snapshot.v}`);
    }

    // Create updated versions with the snapshot properly assigned per stage
    const updatedVersions: ConceptReportVersions = {
      ...currentVersions,
      latest: {
        pointer: stageId,
        v: snapshot.v
      },
      history: updatedHistory
    };
    
    // *** CRITICAL FIX: Actually persist the snapshot per stage ***
    this.setStageSnapshot(updatedVersions, stageId, snapshot);

    // Persist to database
    await storage.updateReport(reportId, {
      conceptReportVersions: updatedVersions as any
    });

    console.log(`✅ [ReportProcessor] Updated concept versions - latest: ${stageId} v${snapshot.v}`);
    return updatedVersions;
  }

  /**
   * Get the predecessor stage for version chaining
   */
  getPredecessorStage(stageId: StageId): StageId | null {
    const stageOrder: StageId[] = [
      "3_generatie",
      "4a_BronnenSpecialist", 
      "4b_FiscaalTechnischSpecialist",
      "4c_ScenarioGatenAnalist",
      "4d_DeVertaler",
      "4e_DeAdvocaat",
      "4f_DeKlantpsycholoog",
      "5_eindredactie"
    ];

    const currentIndex = stageOrder.indexOf(stageId);
    return currentIndex > 0 ? stageOrder[currentIndex - 1] : null;
  }

  /**
   * **MAIN ENTRY POINT**: Complete end-to-end processing workflow
   *
   * Dit is de "all-in-one" functie die alle stappen van feedback processing doet.
   * Gebruik deze wanneer je een reviewer stage (4a-4f) hebt afgerond en de feedback wilt mergen.
   *
   * ### De Complete Flow:
   *
   * ```
   * 1. Bepaal base concept (predecessor of huidige versie voor re-processing)
   *    ↓
   * 2. AI merge: feedback + base → nieuwe versie
   *    ↓
   * 3. Maak snapshot met versie nummer
   *    ↓
   * 4. Update conceptReportVersions in database
   *    ↓
   * 5. Return nieuwe concept + metadata
   * ```
   *
   * ### Re-processing Logic (KRITIEK):
   *
   * **Scenario 1: Eerste keer stage uitvoeren**
   * ```typescript
   * // 4a wordt voor het eerst uitgevoerd
   * base = conceptReportVersions["3_generatie"].content  // Predecessor
   * newVersion = 2
   * ```
   *
   * **Scenario 2: Stage opnieuw uitvoeren** (bv. betere prompt)
   * ```typescript
   * // 4a wordt opnieuw uitgevoerd (v1 bestaat al)
   * base = conceptReportVersions["4a_BronnenSpecialist"].content  // Huidige versie!
   * newVersion = 3  // Increment vanaf huidige versie (was v2)
   * ```
   *
   * Dit voorkomt data loss en zorgt dat elke run builds op de vorige.
   *
   * @param reportId - Het rapport dat geupdate moet worden
   * @param stageId - Welke stage heeft de feedback gegenereerd (bv. "4a_BronnenSpecialist")
   * @param feedback - De AI output van de reviewer stage
   * @param strategy - Hoe de feedback te mergen (default: "merge" - intelligente integratie)
   * @returns Object met nieuwe concept, snapshot metadata, en updated versions
   *
   * @example
   * ```typescript
   * // Na Stage 4a (BronnenSpecialist) uitvoering:
   * const result = await reportProcessor.processStage(
   *   reportId,
   *   "4a_BronnenSpecialist",
   *   aiGeneratedFeedback,
   *   "merge"
   * );
   *
   * console.log(`Nieuwe versie: v${result.snapshot.v}`);
   * console.log(`Concept lengte: ${result.newConcept.length} chars`);
   * ```
   */
  async processStage(
    reportId: string,
    stageId: StageId,
    feedback: string,
    strategy: 'sectional' | 'replace' | 'append' | 'merge' = 'merge'
  ): Promise<{
    newConcept: string;
    snapshot: ConceptReportSnapshot;
    updatedVersions: ConceptReportVersions;
  }> {
    console.log(`🏭 [ReportProcessor] Complete processing for ${stageId} on report ${reportId}`);

    // 1. Get base concept from predecessor stage
    const report = await storage.getReport(reportId);
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    const currentVersions = report.conceptReportVersions as ConceptReportVersions || {};

    let baseConcept: string;
    let predecessorStage: StageId | null = null; // Declare outside if-else for use in snapshot creation

    // CRITICAL FIX: Check if THIS stage already has a version (re-processing)
    // If so, use that version as base. Otherwise, use predecessor.
    const currentStageVersion = this.getStageVersion(currentVersions, stageId);

    if (currentStageVersion) {
      // Re-processing same stage - use current stage's latest version
      baseConcept = currentStageVersion.content;
      // Even when re-processing, we still need to know the predecessor for snapshot metadata
      predecessorStage = this.getPredecessorStage(stageId);
      console.log(`📌 [ReportProcessor] Re-processing ${stageId} - using existing v${currentStageVersion.v} as base`);
    } else {
      // First time processing this stage - use predecessor
      predecessorStage = this.getPredecessorStage(stageId);

      if (predecessorStage) {
        const predecessorVersion = this.getStageVersion(currentVersions, predecessorStage);
        if (predecessorVersion) {
          baseConcept = predecessorVersion.content;
          console.log(`📌 [ReportProcessor] First-time processing ${stageId} - using predecessor ${predecessorStage} v${predecessorVersion.v} as base`);
        } else {
          throw new Error(`Predecessor stage ${predecessorStage} not found or has no content`);
        }
      } else if (stageId === '3_generatie') {
        baseConcept = report.generatedContent || '';
      } else {
        throw new Error(`Cannot find base concept for stage ${stageId} - no predecessor found`);
      }
    }

    // 2. Process feedback with AI
    const processingResult = await this.process({
      baseConcept,
      feedback,
      stageId,
      strategy
    });

    // 3. Create snapshot
    const snapshot = await this.createSnapshot(
      reportId,
      stageId,
      processingResult.newConcept,
      predecessorStage || undefined,
      feedback
    );

    // 4. Update versions
    const updatedVersions = await this.updateConceptVersions(reportId, stageId, snapshot);

    console.log(`🎉 [ReportProcessor] Stage ${stageId} processing complete`);

    return {
      newConcept: processingResult.newConcept,
      snapshot,
      updatedVersions
    };
  }
  
  /**
   * Helper method for type-safe access to stage versions
   */
  private getStageVersion(versions: ConceptReportVersions, stageId: StageId): ConceptReportSnapshot | null {
    switch (stageId) {
      case '3_generatie': return versions['3_generatie'] || null;
      case '4a_BronnenSpecialist': return versions['4a_BronnenSpecialist'] || null;
      case '4b_FiscaalTechnischSpecialist': return versions['4b_FiscaalTechnischSpecialist'] || null;
      case '4c_ScenarioGatenAnalist': return versions['4c_ScenarioGatenAnalist'] || null;
      case '4d_DeVertaler': return versions['4d_DeVertaler'] || null;
      case '4e_DeAdvocaat': return versions['4e_DeAdvocaat'] || null;
      case '4f_DeKlantpsycholoog': return versions['4f_DeKlantpsycholoog'] || null;
      case '5_eindredactie': return versions['5_eindredactie'] || null;
      default: return null;
    }
  }
  
  /**
   * *** CRITICAL METHOD *** 
   * Type-safe method to set stage snapshot in concept versions
   * This was the missing piece that prevented step-back functionality!
   */
  private setStageSnapshot(versions: ConceptReportVersions, stageId: StageId, snapshot: ConceptReportSnapshot): void {
    switch (stageId) {
      case '3_generatie': versions['3_generatie'] = snapshot; break;
      case '4a_BronnenSpecialist': versions['4a_BronnenSpecialist'] = snapshot; break;
      case '4b_FiscaalTechnischSpecialist': versions['4b_FiscaalTechnischSpecialist'] = snapshot; break;
      case '4c_ScenarioGatenAnalist': versions['4c_ScenarioGatenAnalist'] = snapshot; break;
      case '4d_DeVertaler': versions['4d_DeVertaler'] = snapshot; break;
      case '4e_DeAdvocaat': versions['4e_DeAdvocaat'] = snapshot; break;
      case '4f_DeKlantpsycholoog': versions['4f_DeKlantpsycholoog'] = snapshot; break;
      case '5_eindredactie': versions['5_eindredactie'] = snapshot; break;
      default: 
        console.warn(`⚠️ [ReportProcessor] Cannot set snapshot for unknown stage: ${stageId}`);
    }
    
    console.log(`💾 [ReportProcessor] Persisted snapshot v${snapshot.v} for stage ${stageId}`);
  }
}