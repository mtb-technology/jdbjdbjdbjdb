// Decomposed stage implementations with streaming support

import type { DossierData, BouwplanData } from "@shared/schema";
import { StreamingAIService } from "./streaming-ai-service";
import { StreamingSessionManager } from "./streaming-session-manager";
import { BRONNEN_SPECIALIST_SUBSTEPS, type SubstepDefinition } from "@shared/streaming-types";
import { SourceValidator } from "../source-validator";
import type { AiConfig } from "@shared/schema";

export class DecomposedStages {
  private streamingAI: StreamingAIService;
  private sessionManager: StreamingSessionManager;
  private sourceValidator: SourceValidator;

  constructor() {
    this.streamingAI = new StreamingAIService();
    this.sessionManager = StreamingSessionManager.getInstance();
    this.sourceValidator = new SourceValidator();
  }

  // Execute 4a_BronnenSpecialist with streaming substeps
  async execute4aBronnenSpecialist(
    reportId: string,
    dossierData: DossierData,
    bouwplanData: BouwplanData,
    stageResults: Record<string, string>,
    conceptReportVersions: Record<string, string>,
    customInput?: string
  ): Promise<{ stageOutput: string; conceptReport: string; prompt: string }> {
    const stageId = '4a_BronnenSpecialist';
    console.log(`🏗️ [${reportId}] Starting decomposed 4a_BronnenSpecialist execution`);

    // Create streaming session
    const session = this.sessionManager.createSession(reportId, stageId, BRONNEN_SPECIALIST_SUBSTEPS);

    try {
      // Get AI config for this stage
      const aiConfig: AiConfig = {
        provider: "google",
        model: "gemini-2.5-pro",
        temperature: 0.1,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 16384
      };
      
      let accumulatedResults = '';
      let sourcesList: string[] = [];
      let validatedSources: any[] = [];
      let evidenceTable = '';
      
      // Substep 1: Plan Queries
      console.log(`📋 [${reportId}-${stageId}] Executing substep: plan_queries`);
      const queryPlan = await this.streamingAI.executeStreamingCall(
        reportId,
        stageId,
        'plan_queries',
        this.buildQueryPlanPrompt(dossierData, bouwplanData, stageResults),
        aiConfig,
        { useWebSearch: false }
      );

      // Extract queries from plan
      sourcesList = this.extractSourcesFromPlan(queryPlan);
      accumulatedResults += `## Query Planning\n${queryPlan}\n\n`;

      // Substep 2: Fetch Sources
      console.log(`🔍 [${reportId}-${stageId}] Executing substep: fetch_sources`);
      const fetchedSources = await this.streamingAI.executeNonAIOperation(
        reportId,
        stageId,
        'fetch_sources',
        async () => {
          const results = [];
          for (const source of sourcesList.slice(0, 5)) { // Limit to 5 sources
            try {
              const isValid = await this.sourceValidator.validateSource(source);
              results.push({ url: source, valid: isValid });
            } catch (error: any) {
              results.push({ url: source, valid: false, error: error?.message || 'Unknown error' });
            }
          }
          return JSON.stringify(results, null, 2);
        },
        30 // estimated duration
      );

      validatedSources = JSON.parse(fetchedSources);
      accumulatedResults += `## Source Fetching Results\n\`\`\`json\n${fetchedSources}\n\`\`\`\n\n`;

      // Substep 3: Validate Sources
      console.log(`✅ [${reportId}-${stageId}] Executing substep: validate_sources`);
      const sourceValidation = await this.streamingAI.executeStreamingCall(
        reportId,
        stageId,
        'validate_sources',
        this.buildSourceValidationPrompt(validatedSources, dossierData),
        aiConfig,
        { useWebSearch: false }
      );

      accumulatedResults += `## Source Validation\n${sourceValidation}\n\n`;

      // Substep 4: Extract Evidence
      console.log(`📊 [${reportId}-${stageId}] Executing substep: extract_evidence`);
      const evidenceExtraction = await this.streamingAI.executeStreamingCall(
        reportId,
        stageId,
        'extract_evidence',
        this.buildEvidenceExtractionPrompt(sourceValidation, dossierData),
        aiConfig,
        { useWebSearch: false }
      );

      evidenceTable = evidenceExtraction;
      accumulatedResults += `## Evidence Extraction\n${evidenceExtraction}\n\n`;

      // Substep 5: Synthesize Review
      console.log(`📝 [${reportId}-${stageId}] Executing substep: synthesize_review`);
      const reviewSynthesis = await this.streamingAI.executeStreamingCall(
        reportId,
        stageId,
        'synthesize_review',
        this.buildReviewSynthesisPrompt(accumulatedResults, dossierData, stageResults['3_generatie'] || ''),
        aiConfig,
        { useWebSearch: false }
      );

      const finalOutput = reviewSynthesis;
      const conceptReport = conceptReportVersions['latest'] || stageResults['3_generatie'] || '';

      // Complete stage
      this.sessionManager.completeStage(reportId, stageId, finalOutput, conceptReport, 'Generated from decomposed substeps');

      console.log(`🎉 [${reportId}-${stageId}] Decomposed stage completed successfully`);

      return {
        stageOutput: finalOutput,
        conceptReport,
        prompt: 'Decomposed 4a_BronnenSpecialist execution completed'
      };

    } catch (error: any) {
      console.error(`❌ [${reportId}-${stageId}] Decomposed stage failed:`, error);
      this.sessionManager.errorStage(reportId, stageId, error.message, true);
      throw error;
    }
  }

  // Build query plan prompt
  private buildQueryPlanPrompt(dossier: DossierData, bouwplan: BouwplanData, stageResults: Record<string, string>): string {
    return `Je bent een bronnen specialist die een plan maakt voor het valideren van fiscale bronnen.

DOSSIER INFORMATIE:
${JSON.stringify(dossier, null, 2)}

RAPPORT TOT DUSVER:
${stageResults['3_generatie'] || 'Geen rapport beschikbaar'}

OPDRACHT:
Maak een gestructureerd plan voor het vinden en valideren van betrouwbare Nederlandse fiscale bronnen die relevant zijn voor deze casus.

Genereer een lijst van 3-5 specifieke zoekopdrachten en potentiële bronnen die onderzocht moeten worden.

Geef terug als JSON in dit formaat:
{
  "zoekopdrachten": ["opdracht 1", "opdracht 2", "opdracht 3"],
  "prioriteit_bronnen": ["belastingdienst.nl/onderwerp", "wetten.overheid.nl/onderwerp"],
  "zoektermen": ["term1", "term2", "term3"]
}`;
  }

  // Extract sources from query plan
  private extractSourcesFromPlan(plan: string): string[] {
    const sources: string[] = [];
    
    try {
      const parsed = JSON.parse(plan);
      if (parsed.prioriteit_bronnen) {
        sources.push(...parsed.prioriteit_bronnen.map((s: string) => `https://${s}`));
      }
    } catch (error) {
      console.warn('Could not parse query plan JSON, using defaults');
    }

    // Add default sources if none found
    if (sources.length === 0) {
      sources.push(
        'https://www.belastingdienst.nl/',
        'https://wetten.overheid.nl/',
        'https://www.rijksoverheid.nl/'
      );
    }

    return sources;
  }

  // Build source validation prompt
  private buildSourceValidationPrompt(sources: any[], dossier: DossierData): string {
    return `Je bent een bronnen specialist die de betrouwbaarheid van fiscale bronnen beoordeelt.

GEVONDEN BRONNEN:
${JSON.stringify(sources, null, 2)}

DOSSIER CONTEXT:
${JSON.stringify(dossier, null, 2)}

OPDRACHT:
Beoordeel elke bron op:
1. Betrouwbaarheid (officieel Nederlandse overheid?)
2. Relevantie voor deze fiscale casus
3. Actualiteit en geldigheid

Geef voor elke bron een score (1-10) en uitleg.`;
  }

  // Build evidence extraction prompt
  private buildEvidenceExtractionPrompt(validation: string, dossier: DossierData): string {
    return `Je bent een fiscaal analist die bewijsmateriaal extraheert uit bronvalidatie.

BRONVALIDATIE:
${validation}

DOSSIER:
${JSON.stringify(dossier, null, 2)}

OPDRACHT:
Maak een gestructureerde tabel met:
- Bron
- Relevante regel/artikel
- Bewijs/citaat
- Impact op de casus

Format als professionele tabel in Markdown.`;
  }

  // Build review synthesis prompt
  private buildReviewSynthesisPrompt(evidence: string, dossier: DossierData, currentReport: string): string {
    return `Je bent een senior bronnen specialist die een finale review schrijft.

VERZAMELDE BEWIJSMATERIAAL:
${evidence}

HUIDIG RAPPORT:
${currentReport}

DOSSIER:
${JSON.stringify(dossier, null, 2)}

OPDRACHT:
Schrijf een professionele bronnen specialist review die:
1. De kwaliteit van gebruikte bronnen beoordeelt
2. Eventuele lacunes in bronmateriaal identificeert  
3. Aanbevelingen geeft voor verbetering
4. Een eindoordeel geeft over de betrouwbaarheid

Schrijf in professionele consultancy stijl.`;
  }

  // Cancel stage execution
  async cancelStage(reportId: string, stageId: string): Promise<void> {
    await this.streamingAI.cancelOperation(reportId, stageId);
  }

  // Retry failed substep
  async retrySubstep(reportId: string, stageId: string, substepId: string): Promise<void> {
    console.log(`🔄 [${reportId}-${stageId}] Retrying substep: ${substepId}`);
    
    // This would need to be implemented with the specific substep logic
    // For now, we'll just reset the substep status
    const session = this.sessionManager.getSession(reportId, stageId);
    if (session) {
      const substep = session.progress.substeps.find(s => s.substepId === substepId);
      if (substep) {
        substep.status = 'pending';
        substep.percentage = 0;
      }
    }
  }
}