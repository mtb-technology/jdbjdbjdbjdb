import { 
  StageId, 
  ConceptReportSnapshot,
  ConceptReportVersions,
  ReportProcessorInput,
  ReportProcessorOutput 
} from '@shared/schema';
import { storage } from '../storage';

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
 * ReportProcessor Service
 * 
 * Core service responsible for transforming specialist feedback into new concept report versions.
 * This ensures consistent processing across both streaming and normal workflows.
 * 
 * Key responsibilities:
 * - Process feedback from review stages (4a-4g) into concept report updates
 * - Maintain version history with proper snapshots per stage
 * - Enable step-back functionality by preserving exact state at each stage
 * - Provide AI-powered intelligent merging of feedback with existing content
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
    const prompt = this.buildMergePrompt(input);
    
    const response = await this.aiHandler.generateContent({
      prompt,
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 8192
    });

    if (!response.content) {
      throw new Error('AI response was empty');
    }

    return response.content;
  }

  /**
   * Build the AI prompt for merging feedback into concept report
   */
  private buildMergePrompt(input: ReportProcessorInput): string {
    const { baseConcept, feedback, stageId, strategy } = input;

    return `Je bent een expert rapportverwerker die feedback van specialisten verwerkt in fiscale adviezen.

**HUIDIGE CONCEPT RAPPORT:**
${baseConcept}

**FEEDBACK VAN ${stageId.toUpperCase()}:**
${feedback}

**INSTRUCTIE:**
Verwerk de feedback hierboven in het concept rapport volgens deze strategie: ${strategy}

**VERWERKINGSREGELS:**
1. ${this.getStrategyRules(strategy)}
2. Behoud de professionele toon en structuur van het rapport
3. Integreer feedback naadloos zonder duplicatie
4. Zorg voor logische flow en consistentie
5. Behoud alle bestaande bronverwijzingen en voeg nieuwe toe waar nodig

**UITVOER:**
Geef alleen het volledige, bijgewerkte concept rapport terug - geen uitleg of meta-tekst.`;
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
    const previousVersion = fromStage ? this.getStageVersion(currentVersions, fromStage) : null;
    const nextVersion = previousVersion ? previousVersion.v + 1 : 1;

    const snapshot: ConceptReportSnapshot = {
      v: nextVersion,
      content: newContent,
      from: fromStage,
      createdAt: new Date().toISOString(),
      processedFeedback
    };

    console.log(`📸 [ReportProcessor] Created snapshot v${nextVersion} for ${stageId} (from: ${fromStage || 'none'})`);
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
    
    // Create updated versions with the snapshot properly assigned per stage
    const updatedVersions: ConceptReportVersions = {
      ...currentVersions,
      latest: {
        pointer: stageId,
        v: snapshot.v
      },
      history: [
        ...(currentVersions.history || []),
        {
          stageId,
          v: snapshot.v,
          timestamp: new Date().toISOString()
        }
      ]
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
   * Complete end-to-end processing: feedback -> AI merge -> snapshot -> persist
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
    const predecessorStage = this.getPredecessorStage(stageId);
    
    let baseConcept: string;
    if (predecessorStage) {
      // Type-safe access to concept versions
      const predecessorVersion = this.getStageVersion(currentVersions, predecessorStage);
      if (predecessorVersion) {
        baseConcept = predecessorVersion.content;
      } else {
        throw new Error(`Predecessor stage ${predecessorStage} not found or has no content`);
      }
    } else if (stageId === '3_generatie') {
      baseConcept = report.generatedContent || '';
    } else {
      throw new Error(`Cannot find base concept for stage ${stageId} - predecessor ${predecessorStage} not found`);
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