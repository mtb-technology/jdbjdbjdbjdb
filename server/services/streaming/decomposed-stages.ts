// Decomposed stage implementations with streaming support

import type { DossierData, BouwplanData } from "@shared/schema";
import { StreamingAIService } from "./streaming-ai-service";
import { StreamingSessionManager } from "./streaming-session-manager";
import { BRONNEN_SPECIALIST_SUBSTEPS, type SubstepDefinition } from "@shared/streaming-types";
import { SourceValidator } from "../source-validator";
import type { AiConfig } from "@shared/schema";
import { storage } from "../../storage";

export class DecomposedStages {
  private streamingAI: StreamingAIService;
  private sessionManager: StreamingSessionManager;
  private sourceValidator: SourceValidator;

  constructor() {
    this.streamingAI = new StreamingAIService();
    this.sessionManager = StreamingSessionManager.getInstance();
    this.sourceValidator = new SourceValidator();
  }

  // Execute any stage with streaming substeps
  async executeStreamingStage(
    reportId: string,
    stageId: string,
    dossierData: DossierData,
    bouwplanData: BouwplanData,
    stageResults: Record<string, string>,
    conceptReportVersions: Record<string, string>,
    customInput?: string
  ): Promise<{ stageOutput: string; conceptReport: string; prompt: string }> {
    console.log(`🏗️ [${reportId}] Starting decomposed ${stageId} execution`);

    // Get substeps based on stage type
    const substeps = this.getSubstepsForStage(stageId);
    
    // Create streaming session
    const session = this.sessionManager.createSession(reportId, stageId, substeps);

    try {
      // Get AI config for this stage
      const aiConfig: AiConfig = await this.getAIConfigForStage(stageId);
      
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

      // BELANGRIJK: Reviewers (4a-4g) produceren FEEDBACK, geen nieuwe rapport versie
      // De conceptReport blijft LEEG voor reviewers - hun output gaat alleen in stageResults
      const conceptReport = ''; // Reviewers updaten het rapport NIET

      // Complete stage
      this.sessionManager.completeStage(reportId, stageId, finalOutput, conceptReport, 'Generated from decomposed substeps');

      console.log(`🎉 [${reportId}-${stageId}] Decomposed stage completed successfully`);

      // Get the actual prompt from configuration instead of status message
      let actualPrompt = '';
      try {
        const promptConfig = await storage.getActivePromptConfig();
        const stageConfig: any = promptConfig?.config?.[stageId as keyof typeof promptConfig.config] || {};

        if (stageConfig?.prompt) {
          actualPrompt = stageConfig.prompt;
          console.log(`✅ [${reportId}-${stageId}] Using actual prompt from configuration (${actualPrompt.length} chars)`);
        } else {
          console.warn(`⚠️ [${reportId}-${stageId}] No prompt found in configuration for ${stageId}`);
          // Fallback: use a generic message
          actualPrompt = `Review stage ${stageId} - Prompts kunnen worden geconfigureerd in Instellingen`;
        }
      } catch (error) {
        console.error(`❌ [${reportId}-${stageId}] Failed to get prompt from configuration:`, error);
        actualPrompt = `Review stage ${stageId}`;
      }

      return {
        stageOutput: finalOutput,
        conceptReport,
        prompt: actualPrompt
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

  // Get substeps configuration for each stage
  private getSubstepsForStage(stageId: string): SubstepConfig[] {
    const substepConfigs: Record<string, SubstepConfig[]> = {
      '4a_BronnenSpecialist': BRONNEN_SPECIALIST_SUBSTEPS,
      '4b_FiscaalTechnischSpecialist': [
        { id: '1_technical_analysis', label: 'Technische Analyse', estimatedDuration: 45000, progress: 0 },
        { id: '2_regulation_review', label: 'Regelgeving Review', estimatedDuration: 60000, progress: 0 },
        { id: '3_calculation_check', label: 'Berekeningen Controleren', estimatedDuration: 30000, progress: 0 },
        { id: '4_compliance_verification', label: 'Compliance Verificatie', estimatedDuration: 40000, progress: 0 },
        { id: '5_technical_synthesis', label: 'Technische Synthese', estimatedDuration: 35000, progress: 0 }
      ],
      '4c_SeniorSpecialist': [
        { id: '1_strategic_review', label: 'Strategische Review', estimatedDuration: 50000, progress: 0 },
        { id: '2_risk_assessment', label: 'Risico Analyse', estimatedDuration: 45000, progress: 0 },
        { id: '3_precedent_analysis', label: 'Jurisprudentie Analyse', estimatedDuration: 55000, progress: 0 },
        { id: '4_senior_recommendations', label: 'Senior Aanbevelingen', estimatedDuration: 40000, progress: 0 },
        { id: '5_final_validation', label: 'Finale Validatie', estimatedDuration: 30000, progress: 0 }
      ],
      '4d_KwaliteitsReviewer': [
        { id: '1_quality_check', label: 'Kwaliteitscontrole', estimatedDuration: 35000, progress: 0 },
        { id: '2_consistency_review', label: 'Consistentie Review', estimatedDuration: 40000, progress: 0 },
        { id: '3_accuracy_verification', label: 'Nauwkeurigheid Verificatie', estimatedDuration: 45000, progress: 0 },
        { id: '4_final_polish', label: 'Finale Afwerking', estimatedDuration: 25000, progress: 0 },
        { id: '5_quality_approval', label: 'Kwaliteits Goedkeuring', estimatedDuration: 20000, progress: 0 }
      ],
      '1_informatiecheck': [
        { id: '1_data_extraction', label: 'Data Extractie', estimatedDuration: 30000, progress: 0 },
        { id: '2_validation_check', label: 'Validatie Controle', estimatedDuration: 25000, progress: 0 },
        { id: '3_completeness_review', label: 'Volledigheids Review', estimatedDuration: 35000, progress: 0 },
        { id: '4_information_synthesis', label: 'Informatie Synthese', estimatedDuration: 40000, progress: 0 }
      ],
      '2_bouwplananalyse': [
        { id: '1_structure_analysis', label: 'Structuur Analyse', estimatedDuration: 40000, progress: 0 },
        { id: '2_requirement_mapping', label: 'Vereisten Mapping', estimatedDuration: 35000, progress: 0 },
        { id: '3_template_selection', label: 'Template Selectie', estimatedDuration: 25000, progress: 0 },
        { id: '4_blueprint_creation', label: 'Bouwplan Creatie', estimatedDuration: 45000, progress: 0 }
      ],
      '3_generatie': [
        { id: '1_content_planning', label: 'Content Planning', estimatedDuration: 35000, progress: 0 },
        { id: '2_draft_generation', label: 'Concept Generatie', estimatedDuration: 90000, progress: 0 },
        { id: '3_structure_formatting', label: 'Structuur Formattering', estimatedDuration: 30000, progress: 0 },
        { id: '4_initial_review', label: 'Initiële Review', estimatedDuration: 25000, progress: 0 }
      ],
      '5_eindredactie': [
        { id: '1_final_edit', label: 'Finale Redactie', estimatedDuration: 40000, progress: 0 },
        { id: '2_style_consistency', label: 'Stijl Consistentie', estimatedDuration: 30000, progress: 0 },
        { id: '3_formatting_polish', label: 'Formattering Polish', estimatedDuration: 25000, progress: 0 },
        { id: '4_publication_prep', label: 'Publicatie Voorbereiding', estimatedDuration: 35000, progress: 0 }
      ]
    };

    return substepConfigs[stageId] || BRONNEN_SPECIALIST_SUBSTEPS;
  }

  // Get AI configuration for each stage
  private async getAIConfigForStage(stageId: string): Promise<AiConfig> {
    // First try to get configuration from database/storage
    try {
      const promptConfig = await storage.getActivePromptConfig();
      const stageConfig: any = promptConfig?.config?.[stageId as keyof typeof promptConfig.config] || {};
      const globalConfig: any = promptConfig?.config || {};

      const stageAiConfig = stageConfig?.aiConfig;
      const globalAiConfig = globalConfig?.aiConfig;

      // If we have a configured model in the database, use it
      if (stageAiConfig || globalAiConfig) {
        const model = stageAiConfig?.model || globalAiConfig?.model || 'gpt-4o';
        const aiConfig: AiConfig = {
          provider: stageAiConfig?.provider || globalAiConfig?.provider || (model.startsWith('gpt') ? 'openai' : 'google'),
          model: model as any,
          temperature: stageAiConfig?.temperature ?? globalAiConfig?.temperature ?? 0.1,
          topP: stageAiConfig?.topP ?? globalAiConfig?.topP ?? 0.95,
          topK: stageAiConfig?.topK ?? globalAiConfig?.topK ?? 20,
          maxOutputTokens: stageAiConfig?.maxOutputTokens || globalAiConfig?.maxOutputTokens || 8192,
          reasoning: stageAiConfig?.reasoning || globalAiConfig?.reasoning,
          verbosity: stageAiConfig?.verbosity || globalAiConfig?.verbosity
        };

        console.log(`✅ Using stored AI config for ${stageId}:`, {
          provider: aiConfig.provider,
          model: aiConfig.model,
          maxOutputTokens: aiConfig.maxOutputTokens
        });

        return aiConfig;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load AI config from storage for ${stageId}, using fallbacks:`, error);
    }

    // Fallback to hardcoded defaults if no database config available
    const aiConfigs: Record<string, AiConfig> = {
      '4a_BronnenSpecialist': {
        provider: "google",
        model: "gemini-2.5-pro",
        temperature: 0.1,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 16384
      },
      '4b_FiscaalTechnischSpecialist': {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.2,
        topP: 0.9,
        topK: 20,
        maxOutputTokens: 8192
      },
      '4c_SeniorSpecialist': {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.1,
        topP: 0.85,
        topK: 20,
        maxOutputTokens: 12288
      },
      '4d_KwaliteitsReviewer': {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.3,
        topP: 0.9,
        topK: 20,
        maxOutputTokens: 6144
      },
      '1_informatiecheck': {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        topP: 0.9,
        topK: 30,
        maxOutputTokens: 4096
      },
      '2_bouwplananalyse': {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.1,
        topP: 0.8,
        topK: 20,
        maxOutputTokens: 8192
      },
      '3_generatie': {
        provider: "openai",
        model: "gpt-4o",
        temperature: 0.3,
        topP: 0.9,
        topK: 20,
        maxOutputTokens: 16384
      },
      '5_eindredactie': {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.2,
        topP: 0.95,
        topK: 20,
        maxOutputTokens: 8192
      }
    };

    const fallbackConfig = aiConfigs[stageId] || aiConfigs['4a_BronnenSpecialist'];
    console.log(`🔄 Using fallback AI config for ${stageId}:`, {
      provider: fallbackConfig.provider,
      model: fallbackConfig.model
    });

    return fallbackConfig;
  }
}